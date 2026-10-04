import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import AuthOtp from '../models/AuthOtp.js';
import User from '../models/User.js';
import { auth } from '../middleware/auth.js';
import { verifyTurnstile } from '../utils/turnstile.js';
import { sendOtp, otpDevLogEnabled, availableChannels } from '../utils/otpDelivery.js';

const r = express.Router();

const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, role: u.role });
const isProduction = process.env.NODE_ENV === 'production';
const OTP_TTL_MS = 10 * 60 * 1000;
const OTP_RESEND_DELAY_MS = 60 * 1000;
const OTP_MAX_ATTEMPTS = 5;

const token = (u) =>
  jwt.sign({ id: u._id, role: u.role, name: u.name, email: u.email }, process.env.JWT_SECRET, {
    expiresIn: '7d',
  });

async function requireTurnstile(req, res) {
  const cfToken = req.body?.turnstileToken || req.body?.['cf-turnstile-response'];
  const ip = req.headers['cf-connecting-ip'] || req.ip;
  const result = await verifyTurnstile(cfToken, ip);
  if (!result.ok) {
    res.status(400).json({ message: result.message });
    return false;
  }
  return true;
}

const otpHash = (email, purpose, code) =>
  createHmac('sha256', process.env.JWT_SECRET).update(`${email}:${purpose}:${code}`).digest('hex');

// Tells the register screen which delivery methods are actually configured
r.get('/otp-options', (req, res) => res.json(availableChannels()));

// ---------------------------------------------------------------------------
// LOGIN: email + password only (no OTP). OTP is used only for
//   1) registering a new account  and  2) "Forgot password".
// Because there is no second factor, failed attempts are rate-limited.
// ---------------------------------------------------------------------------
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILS = 10;
const loginFailures = new Map(); // "ip|email" -> { count, first }

function loginLocked(key) {
  const entry = loginFailures.get(key);
  if (!entry) return false;
  if (Date.now() - entry.first > LOGIN_WINDOW_MS) {
    loginFailures.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILS;
}

function recordLoginFailure(key) {
  if (loginFailures.size > 5000) loginFailures.clear();
  const entry = loginFailures.get(key);
  if (!entry || Date.now() - entry.first > LOGIN_WINDOW_MS) loginFailures.set(key, { count: 1, first: Date.now() });
  else entry.count += 1;
}

r.post('/login', async (req, res) => {
  try {
    if (!(await requireTurnstile(req, res))) return;
    const email = String(req.body.email || '').trim().toLowerCase();
    const password = req.body.password;
    if (!email || typeof password !== 'string' || !password) {
      return res.status(400).json({ message: 'Email and password are required' });
    }
    const key = `${req.ip}|${email}`;
    if (loginLocked(key)) {
      return res.status(429).json({ message: 'Too many failed sign-in attempts. Try again in 15 minutes or use "Forgot password?".' });
    }
    const user = await User.findOne({ email });
    if (!user || !(await bcrypt.compare(password, user.password))) {
      recordLoginFailure(key);
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    loginFailures.delete(key);
    return res.json({ token: token(user), user: publicUser(user) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// ---------------------------------------------------------------------------
// REGISTER: step 1 - validate the details and send the OTP to the email/phone the new user typed.
// ---------------------------------------------------------------------------
r.post('/request-otp', async (req, res) => {
  try {
    if (!(await requireTurnstile(req, res))) return;
    const channel = req.body.channel === 'sms' ? 'sms' : 'email';
    const purpose = 'register';
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }
    if (!availableChannels()[channel]) {
      return res.status(400).json({
        message: channel === 'sms' ? 'SMS verification is not available right now. Please choose email.' : 'Email verification is not configured on the server.',
      });
    }

    const existingChallenge = await AuthOtp.findOne({ email, purpose });
    if (existingChallenge && Date.now() - existingChallenge.createdAt.getTime() < OTP_RESEND_DELAY_MS) {
      return res.status(429).json({ message: 'Please wait a minute before requesting another code' });
    }

    const { name, password } = req.body;
    const phone = String(req.body.phone || '').replace(/[\s()-]/g, '');
    if (typeof name !== 'string' || !name.trim() || typeof password !== 'string') {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (channel === 'sms' && !phone) {
      return res.status(400).json({ message: 'Phone number is required for SMS verification' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must contain at least 6 characters' });
    }
    if (phone && !/^\+[1-9]\d{7,14}$/.test(phone)) {
      return res.status(400).json({ message: 'Enter the phone number in international format, for example +919876543210' });
    }
    if (await User.findOne({ email })) {
      return res.status(409).json({ message: 'Email already registered. Please sign in.' });
    }
    if (phone && (await User.findOne({ phone }))) {
      return res.status(409).json({ message: 'Phone number already registered' });
    }
    const registration = {
      name: name.trim(),
      ...(phone ? { phone } : {}),
      passwordHash: await bcrypt.hash(password, 10),
    };
    const destination = channel === 'sms' ? phone : email;

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
    const challenge = await AuthOtp.findOneAndUpdate(
      { email, purpose },
      {
        email,
        purpose,
        channel,
        otpHash: otpHash(email, purpose, code),
        registration,
        attempts: 0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    let delivery;
    try {
      delivery = await sendOtp({ channel, destination, code, purpose: 'register' });
    } catch (error) {
      await AuthOtp.deleteOne({ _id: challenge._id });
      console.error('OTP delivery failed:', error);
      const hint = channel === 'email' ? 'email' : 'SMS';
      return res.status(502).json({
        message: `Could not send the verification code by ${hint}. Please check the address and try again, or contact support.`,
        ...(isProduction ? {} : { detail: error.message }),
      });
    }
    const maskedDestination =
      channel === 'email'
        ? destination.replace(/^(.{2})[^@]*(@.*)$/, '$1***$2')
        : `${destination.slice(0, -4).replace(/./g, '*')}${destination.slice(-4)}`;
    return res.json({
      message: `Verification code sent by ${channel === 'email' ? 'email' : 'SMS'}`,
      destination: maskedDestination,
      channel,
      ...(delivery?.devLogged && otpDevLogEnabled()
        ? { devNote: delivery.deliveryError ? `Dev mode: real delivery failed (${delivery.deliveryError}). The code is printed in the backend terminal.` : 'Dev mode: the code is printed in the backend terminal.' }
        : {}),
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// REGISTER: step 2 - check the code, create the account and sign the user in.
r.post('/verify-otp', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const purpose = 'register';
    const code = String(req.body.code || '');
    if (!/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: 'Enter the six-digit verification code' });
    }
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
    const challenge = await AuthOtp.findOne({ email, purpose });
    if (!challenge || challenge.expiresAt <= new Date()) {
      if (challenge) await AuthOtp.deleteOne({ _id: challenge._id });
      return res.status(400).json({ message: 'Verification code expired. Request a new code.' });
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many incorrect codes. Request a new code.' });
    }
    const candidate = Buffer.from(otpHash(email, purpose, code), 'hex');
    const expected = Buffer.from(challenge.otpHash, 'hex');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      await AuthOtp.updateOne({ _id: challenge._id, attempts: { $lt: OTP_MAX_ATTEMPTS } }, { $inc: { attempts: 1 } });
      return res.status(400).json({ message: 'Incorrect verification code' });
    }

    const reg = challenge.registration;
    if (!reg) return res.status(400).json({ message: 'Registration data missing. Please register again.' });
    const consumed = await AuthOtp.findOneAndDelete({ _id: challenge._id, otpHash: challenge.otpHash });
    if (!consumed) return res.status(400).json({ message: 'Verification code already used. Request a new code.' });

    if (await User.findOne({ $or: [{ email }, ...(reg.phone ? [{ phone: reg.phone }] : [])] })) {
      return res.status(409).json({ message: 'Email or phone number is already registered' });
    }
    let user;
    try {
      user = await User.create({
        name: reg.name,
        email,
        ...(reg.phone ? { phone: reg.phone } : {}),
        password: reg.passwordHash,
      });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ message: 'Email or phone number is already registered' });
      throw error;
    }
    return res.json({ token: token(user), user: publicUser(user) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Step 1 of "Forgot password": email a 6-digit code. Always answers the same way,
// so the endpoint cannot be used to find out which emails are registered.
r.post('/forgot-password', async (req, res) => {
  try {
    if (!(await requireTurnstile(req, res))) return;
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');
    const generic = {
      message: 'If an account exists for this email, a reset code has been sent.',
      destination: email.replace(/^(.{2})[^@]*(@.*)$/, '$1***$2'),
    };

    const existing = await AuthOtp.findOne({ email, purpose: 'reset' });
    if (existing && Date.now() - existing.createdAt.getTime() < OTP_RESEND_DELAY_MS) {
      return res.status(429).json({ message: 'Please wait a minute before requesting another code' });
    }
    const user = await User.findOne({ email });
    if (!user) return res.json(generic);

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const challenge = await AuthOtp.findOneAndUpdate(
      { email, purpose: 'reset' },
      {
        email,
        purpose: 'reset',
        channel: 'email',
        otpHash: otpHash(email, 'reset', code),
        userId: user._id,
        attempts: 0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    try {
      const delivery = await sendOtp({ channel: 'email', destination: user.otpEmail || email, code, purpose: 'reset' });
      return res.json({
        ...generic,
        ...(delivery?.devLogged && otpDevLogEnabled()
        ? { devNote: delivery.deliveryError ? `Dev mode: real delivery failed (${delivery.deliveryError}). The code is printed in the backend terminal.` : 'Dev mode: the code is printed in the backend terminal.' }
        : {}),
      });
    } catch (error) {
      await AuthOtp.deleteOne({ _id: challenge._id });
      console.error('Reset OTP delivery failed:', error);
      return res.status(502).json({
        message: 'Could not send the reset code by email. Check the SMTP settings in backend/.env.',
        ...(isProduction ? {} : { detail: error.message }),
      });
    }
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

// Step 2: verify the code and set the new password.
r.post('/reset-password', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '');
    const password = req.body.password;
    if (!/^\d{6}$/.test(code)) return res.status(400).json({ message: 'Enter the six-digit reset code' });
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ message: 'Password must contain at least 6 characters' });
    }
    if (!process.env.JWT_SECRET) throw new Error('JWT_SECRET is not configured');

    const challenge = await AuthOtp.findOne({ email, purpose: 'reset' });
    if (!challenge || challenge.expiresAt <= new Date()) {
      if (challenge) await AuthOtp.deleteOne({ _id: challenge._id });
      return res.status(400).json({ message: 'Reset code expired. Request a new code.' });
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many incorrect codes. Request a new code.' });
    }
    const candidate = Buffer.from(otpHash(email, 'reset', code), 'hex');
    const expected = Buffer.from(challenge.otpHash, 'hex');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      await AuthOtp.updateOne({ _id: challenge._id, attempts: { $lt: OTP_MAX_ATTEMPTS } }, { $inc: { attempts: 1 } });
      return res.status(400).json({ message: 'Incorrect reset code' });
    }
    const consumed = await AuthOtp.findOneAndDelete({ _id: challenge._id, otpHash: challenge.otpHash });
    if (!consumed) return res.status(400).json({ message: 'Reset code already used. Request a new code.' });

    const user = await User.findById(challenge.userId);
    if (!user) return res.status(404).json({ message: 'Account no longer exists' });
    user.password = await bcrypt.hash(password, 10);
    await user.save();
    return res.json({ message: 'Password updated. You can now sign in with your new password.' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

r.get('/me', auth, async (req, res) => {
  try {
    const u = await User.findById(req.user.id).select('name email role createdAt');
    if (!u) return res.status(404).json({ message: 'User not found' });
    res.json({ user: publicUser(u) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

r.patch('/me', auth, async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    if (!name || name.length > 80) {
      return res.status(400).json({ message: 'Name is required and must be under 80 characters' });
    }
    const user = await User.findById(req.user.id);
    if (!user) return res.status(404).json({ message: 'User not found' });
    user.name = name;
    await user.save();
    return res.json({ token: token(user), user: publicUser(user) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default r;
