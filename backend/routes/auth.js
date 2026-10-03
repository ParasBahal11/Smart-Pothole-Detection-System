import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import AuthOtp from '../models/AuthOtp.js';
import User from '../models/User.js';
import { auth } from '../middleware/auth.js';
import { verifyTurnstile } from '../utils/turnstile.js';
import { sendOtp, otpDevLogEnabled } from '../utils/otpDelivery.js';

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

r.post('/request-otp', async (req, res) => {
  try {
    if (!(await requireTurnstile(req, res))) return;
    const { purpose, channel } = req.body;
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!['login', 'register'].includes(purpose) || !['email', 'sms'].includes(channel)) {
      return res.status(400).json({ message: 'Choose a valid authentication action and OTP delivery method' });
    }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }

    const existingChallenge = await AuthOtp.findOne({ email, purpose });
    if (existingChallenge && Date.now() - existingChallenge.createdAt.getTime() < OTP_RESEND_DELAY_MS) {
      return res.status(429).json({ message: 'Please wait a minute before requesting another code' });
    }

    let userId;
    let registration;
    let destination = email;
    if (purpose === 'register') {
      const { name, password } = req.body;
      const phone = String(req.body.phone || '').replace(/[\s()-]/g, '');
      if (typeof name !== 'string' || !name.trim() || typeof password !== 'string' || !phone) {
        return res.status(400).json({ message: 'Name, email, phone number and password are required' });
      }
      if (password.length < 6) {
        return res.status(400).json({ message: 'Password must contain at least 6 characters' });
      }
      if (!/^\+[1-9]\d{7,14}$/.test(phone)) {
        return res.status(400).json({ message: 'Enter the phone number in international format, for example +14155552671' });
      }
      if (await User.findOne({ email })) {
        return res.status(409).json({ message: 'Email already registered' });
      }
      if (await User.findOne({ phone })) {
        return res.status(409).json({ message: 'Phone number already registered' });
      }
      registration = {
        name: name.trim(),
        phone,
        passwordHash: await bcrypt.hash(password, 10),
      };
      if (channel === 'sms') destination = phone;
    } else {
      const user = await User.findOne({ email });
      if (
        !user ||
        typeof req.body.password !== 'string' ||
        !(await bcrypt.compare(req.body.password, user.password))
      ) {
        return res.status(401).json({ message: 'Invalid email or password' });
      }
      if (channel === 'sms') {
        if (!user.phone) {
          return res.status(400).json({ message: 'This account has no phone number. Choose email verification instead.' });
        }
        destination = user.phone;
      }
      // Seeded admin/contractor accounts use a fake login email, so their codes
      // can be delivered to a real inbox via ADMIN_OTP_EMAIL / CONTRACTOR_OTP_EMAIL.
      if (channel === 'email' && user.otpEmail) destination = user.otpEmail;
      userId = user._id;
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not configured');
    const otpHash = createHmac('sha256', secret).update(`${email}:${purpose}:${code}`).digest('hex');
    const challenge = await AuthOtp.findOneAndUpdate(
      { email, purpose },
      {
        email,
        purpose,
        channel,
        otpHash,
        userId,
        registration,
        attempts: 0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );
    let delivery;
    try {
      delivery = await sendOtp({ channel, destination, code });
    } catch (error) {
      await AuthOtp.deleteOne({ _id: challenge._id });
      console.error('OTP delivery failed:', error);
      const hint = channel === 'email' ? 'email (SMTP)' : 'SMS (Twilio)';
      return res.status(502).json({
        message: `Could not send the verification code by ${hint}. Check the settings in backend/.env or choose the other method.`,
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
      ...(delivery?.devLogged && otpDevLogEnabled() ? { devNote: 'Dev mode: the code is printed in the backend terminal.' } : {}),
    });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

r.post('/forgot-password', async (req, res) => {
  try {
    if (!(await requireTurnstile(req, res))) return;
    const email = String(req.body.email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return res.status(400).json({ message: 'Enter a valid email address' });
    }

    const genericMessage = 'If an account exists for this email, a reset code has been sent.';
    const user = await User.findOne({ email });
    if (!user) return res.json({ message: genericMessage });

    const existingChallenge = await AuthOtp.findOne({ email, purpose: 'reset' });
    if (existingChallenge && Date.now() - existingChallenge.createdAt.getTime() < OTP_RESEND_DELAY_MS) {
      return res.json({ message: genericMessage });
    }

    const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not configured');
    const otpHash = createHmac('sha256', secret).update(`${email}:reset:${code}`).digest('hex');
    const challenge = await AuthOtp.findOneAndUpdate(
      { email, purpose: 'reset' },
      {
        email,
        purpose: 'reset',
        channel: 'email',
        otpHash,
        userId: user._id,
        attempts: 0,
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + OTP_TTL_MS),
      },
      { upsert: true, new: true, runValidators: true, setDefaultsOnInsert: true }
    );

    try {
      await sendOtp({ channel: 'email', destination: user.otpEmail || user.email, code });
    } catch (error) {
      await AuthOtp.deleteOne({ _id: challenge._id });
      console.error('Password reset code delivery failed:', error);
    }
    return res.json({ message: genericMessage });
  } catch (e) {
    console.error('Password reset request failed:', e);
    res.status(500).json({ message: 'Could not start password reset. Please try again.' });
  }
});

r.post('/reset-password', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const code = String(req.body.code || '');
    const { password } = req.body;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: 'Enter a valid email and six-digit reset code' });
    }
    if (typeof password !== 'string' || password.length < 6) {
      return res.status(400).json({ message: 'Password must contain at least 6 characters' });
    }

    const challenge = await AuthOtp.findOne({ email, purpose: 'reset' });
    if (!challenge || challenge.expiresAt <= new Date()) {
      if (challenge) await AuthOtp.deleteOne({ _id: challenge._id });
      return res.status(400).json({ message: 'Reset code expired or invalid. Request a new code.' });
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many incorrect codes. Request a new code.' });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not configured');
    const candidate = createHmac('sha256', secret).update(`${email}:reset:${code}`).digest();
    const expected = Buffer.from(challenge.otpHash, 'hex');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      await AuthOtp.updateOne(
        { _id: challenge._id, attempts: { $lt: OTP_MAX_ATTEMPTS } },
        { $inc: { attempts: 1 } }
      );
      return res.status(400).json({ message: 'Reset code is incorrect' });
    }

    const consumedChallenge = await AuthOtp.findOneAndDelete({
      _id: challenge._id,
      otpHash: challenge.otpHash,
      expiresAt: { $gt: new Date() },
      attempts: { $lt: OTP_MAX_ATTEMPTS },
    });
    if (!consumedChallenge) {
      return res.status(400).json({ message: 'Reset code expired or already used. Request a new code.' });
    }
    const passwordHash = await bcrypt.hash(password, 10);
    const result = await User.updateOne({ _id: challenge.userId, email }, { $set: { password: passwordHash } });
    if (!result.matchedCount) return res.status(404).json({ message: 'Account no longer exists' });
    await AuthOtp.deleteMany({ email, purpose: 'login' });
    return res.json({ message: 'Password reset successfully. You can now sign in with your new password.' });
  } catch (e) {
    console.error('Password reset failed:', e);
    res.status(500).json({ message: 'Could not reset password. Please try again.' });
  }
});

r.post('/verify-otp', async (req, res) => {
  try {
    const email = String(req.body.email || '').trim().toLowerCase();
    const { purpose } = req.body;
    const code = String(req.body.code || '');
    if (!['login', 'register'].includes(purpose) || !/^\d{6}$/.test(code)) {
      return res.status(400).json({ message: 'Enter the six-digit verification code' });
    }
    const challenge = await AuthOtp.findOne({ email, purpose });
    if (!challenge || challenge.expiresAt <= new Date()) {
      if (challenge) await AuthOtp.deleteOne({ _id: challenge._id });
      return res.status(400).json({ message: 'Verification code expired. Request a new code.' });
    }
    if (challenge.attempts >= OTP_MAX_ATTEMPTS) {
      return res.status(429).json({ message: 'Too many incorrect codes. Request a new code.' });
    }

    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET is not configured');
    const candidate = createHmac('sha256', secret).update(`${email}:${purpose}:${code}`).digest();
    const expected = Buffer.from(challenge.otpHash, 'hex');
    if (candidate.length !== expected.length || !timingSafeEqual(candidate, expected)) {
      await AuthOtp.updateOne(
        { _id: challenge._id, attempts: { $lt: OTP_MAX_ATTEMPTS } },
        { $inc: { attempts: 1 } }
      );
      return res.status(400).json({ message: 'Incorrect verification code' });
    }

    let user;
    if (purpose === 'register') {
      if (await User.findOne({ $or: [{ email }, { phone: challenge.registration.phone }] })) {
        return res.status(409).json({ message: 'Email or phone number is already registered' });
      }
      try {
        user = await User.create({
          name: challenge.registration.name,
          email,
          phone: challenge.registration.phone,
          password: challenge.registration.passwordHash,
        });
      } catch (error) {
        if (error.code === 11000) {
          return res.status(409).json({ message: 'Email or phone number is already registered' });
        }
        throw error;
      }
      await AuthOtp.deleteOne({ _id: challenge._id });
    } else {
      const consumedChallenge = await AuthOtp.findOneAndDelete({
        _id: challenge._id,
        otpHash: challenge.otpHash,
        expiresAt: { $gt: new Date() },
        attempts: { $lt: OTP_MAX_ATTEMPTS },
      });
      if (!consumedChallenge) {
        return res.status(400).json({ message: 'Verification code expired or already used. Request a new code.' });
      }
      user = await User.findById(challenge.userId);
      if (!user) return res.status(401).json({ message: 'Account no longer exists' });
    }
    return res.json({ token: token(user), user: publicUser(user) });
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

export default r;
