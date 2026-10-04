import fs from 'fs';
import nodemailer from 'nodemailer';
import twilio from 'twilio';

const isProduction = process.env.NODE_ENV === 'production';

// Local/demo mode: codes/emails are printed in the backend terminal so you can test
// even when email/SMS is not configured. Never active when NODE_ENV=production.
export function otpDevLogEnabled() {
  return process.env.OTP_DEV_LOG === 'true' && !isProduction;
}

const PLACEHOLDER = /(example\.com|your-|replace-with|xxxxxxxx|^$)/i;

function looksConfigured(value) {
  return Boolean(value) && !PLACEHOLDER.test(String(value));
}

// Accepts "RoadGuard <a@b.com>", "a@b.com" and also "RoadGuard a@b.com" (missing brackets).
function normalizeFrom(from, fallback) {
  const value = String(from || fallback || '').trim();
  if (!value) return '';
  if (/<[^>]+>/.test(value) || !/\s/.test(value)) return value;
  const match = value.match(/^(.*?)\s+([^\s@]+@[^\s@]+\.[^\s@]+)$/);
  return match ? `${match[1].trim()} <${match[2]}>` : value;
}

function splitFrom(from) {
  const m = String(from).match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim() || 'RoadGuard', email: m[2].trim() } : { name: 'RoadGuard', email: String(from).trim() };
}

/**
 * Which email transport is configured?
 *  - 'brevo': HTTPS API (BREVO_API_KEY). Works on Render free tier (SMTP ports are blocked there)
 *             and can send to ANY recipient.
 *  - 'smtp' : classic SMTP (Gmail App Password etc.). Works locally; blocked on Render free tier.
 *  - null   : nothing configured.
 */
export function emailProvider() {
  if (looksConfigured(process.env.BREVO_API_KEY)) return 'brevo';
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if ([SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS].every(looksConfigured)) return 'smtp';
  return null;
}

// SMS is OFF unless SMS_OTP_ENABLED=true (needs a paid/upgraded Twilio account and a Twilio-issued number).
export function smsConfigured() {
  if (process.env.SMS_OTP_ENABLED !== 'true') return false;
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;
  return [TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER].every(looksConfigured);
}

/** Which OTP delivery methods can the login screen offer? */
export function availableChannels() {
  const dev = otpDevLogEnabled();
  return { email: Boolean(emailProvider()) || dev, sms: smsConfigured() };
}

let cachedTransporter;
let cachedKey;

function getTransporter() {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  const secure = process.env.SMTP_SECURE === 'true' || Number(SMTP_PORT) === 465;
  const key = [SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, secure].join('|');
  if (!cachedTransporter || cachedKey !== key) {
    cachedTransporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: Number(SMTP_PORT),
      secure,
      auth: { user: SMTP_USER, pass: String(SMTP_PASS).replace(/\s+/g, '') },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 15_000,
    });
    cachedKey = key;
  }
  return cachedTransporter;
}

async function sendViaBrevo({ to, subject, text, html, attachments, replyTo }) {
  const sender = splitFrom(
    normalizeFrom(process.env.BREVO_SENDER_EMAIL || process.env.SMTP_FROM, process.env.SMTP_USER)
  );
  if (!sender.email || !sender.email.includes('@')) {
    throw new Error('Set BREVO_SENDER_EMAIL in backend/.env to the sender address you verified in Brevo.');
  }
  const body = {
    sender,
    to: [{ email: to }],
    subject,
    textContent: text || subject,
    ...(html ? { htmlContent: html } : {}),
    ...(replyTo ? { replyTo: { email: replyTo } } : {}),
  };
  const files = (attachments || []).filter((a) => a?.path && fs.existsSync(a.path));
  if (files.length) {
    body.attachment = files.map((a) => ({ name: a.filename, content: fs.readFileSync(a.path).toString('base64') }));
  }
  let res;
  try {
    res = await fetch('https://api.brevo.com/v3/smtp/email', {
      method: 'POST',
      headers: { 'api-key': process.env.BREVO_API_KEY.trim(), 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (e) {
    throw new Error(`Could not reach Brevo (${e.message})`);
  }
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(`Brevo rejected the email (${res.status}): ${data.message || res.statusText}`);
  }
}

/**
 * Generic email sender used for OTP, complaint notifications and the contact form.
 * Returns { sent: true } on delivery, { sent: false, devLogged: true } when only printed
 * to the console (OTP_DEV_LOG=true), otherwise throws.
 */
export async function sendMailMessage({ to, subject, text, html, attachments, replyTo }) {
  const provider = emailProvider();
  if (!provider) {
    if (otpDevLogEnabled()) {
      console.log(`\n[MAIL DEV] To: ${to}\nSubject: ${subject}\n${text}\n`);
      return { sent: false, devLogged: true };
    }
    throw new Error(
      'Email is not configured. Set BREVO_API_KEY + BREVO_SENDER_EMAIL (recommended, works on Render) or SMTP_HOST/PORT/USER/PASS in backend/.env.'
    );
  }
  if (provider === 'brevo') {
    await sendViaBrevo({ to, subject, text, html, attachments, replyTo });
    return { sent: true, provider };
  }
  const from = normalizeFrom(process.env.SMTP_FROM, process.env.SMTP_USER);
  try {
    await getTransporter().sendMail({ from, to, subject, text, html, attachments, replyTo });
  } catch (e) {
    if (['ETIMEDOUT', 'ESOCKET', 'ECONNECTION', 'ECONNREFUSED', 'EHOSTUNREACH', 'ENETUNREACH'].includes(e.code)) {
      throw new Error(
        `SMTP connection failed (${e.code}). Hosting such as Render free tier blocks SMTP ports 25/465/587 - use BREVO_API_KEY instead. (${e.message})`
      );
    }
    throw e;
  }
  return { sent: true, provider };
}

async function sendEmail({ destination, code, purpose }) {
  const reason = purpose === 'reset' ? 'reset your RoadGuard password' : 'verify your RoadGuard account';
  const text = `Your RoadGuard verification code is ${code}.\n\nUse it to ${reason}. The code expires in 10 minutes.\nIf you did not request this, you can ignore this email.`;
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:auto;padding:24px;border:1px solid #e5e7eb;border-radius:12px">
  <h2 style="margin:0 0 8px;color:#111827">RoadGuard</h2>
  <p style="color:#374151">Use this code to ${reason}:</p>
  <p style="font-size:32px;letter-spacing:8px;font-weight:700;color:#111827;margin:16px 0">${code}</p>
  <p style="color:#6b7280;font-size:13px">The code expires in 10 minutes. If you did not request it, you can ignore this email.</p>
</div>`;
  await sendMailMessage({ to: destination, subject: `${code} is your RoadGuard verification code`, text, html });
}

function twilioMessage(error) {
  const hints = {
    21608: 'Twilio trial accounts can only text numbers verified in the Twilio console. Verify this number or upgrade the account.',
    21211: 'The phone number is not valid. Use international format, e.g. +919876543210.',
    21408: 'Twilio has not enabled SMS to this country. Enable it in Twilio Console > Messaging > Geo permissions.',
    21606: 'TWILIO_PHONE_NUMBER is not a number owned by your Twilio account (a personal mobile number cannot be used).',
    20003: 'Twilio authentication failed. Check TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN.',
  };
  return hints[error.code] ? `${hints[error.code]} (Twilio ${error.code})` : error.message;
}

async function sendSms({ destination, code }) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;
  if (!smsConfigured()) {
    throw new Error('SMS OTP is disabled or not configured. Set SMS_OTP_ENABLED=true, TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and a Twilio-issued TWILIO_PHONE_NUMBER in backend/.env.');
  }
  try {
    const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
    await client.messages.create({
      body: `Your RoadGuard verification code is ${code}. It expires in 10 minutes.`,
      from: TWILIO_PHONE_NUMBER,
      to: destination,
    });
  } catch (e) {
    throw new Error(twilioMessage(e));
  }
}

/**
 * Sends the OTP. Returns { devLogged, deliveryError }.
 * With OTP_DEV_LOG=true (non-production) the code is printed to the backend console and a
 * delivery failure does not block the login; the reason is returned so the UI can show it.
 */
export async function sendOtp({ channel, destination, code, purpose = 'register' }) {
  const devLog = otpDevLogEnabled();
  if (devLog) console.log(`\n[OTP DEV] ${channel.toUpperCase()} code for ${destination}: ${code}\n`);
  try {
    if (channel === 'email') await sendEmail({ destination, code, purpose });
    else await sendSms({ destination, code });
    return { devLogged: devLog };
  } catch (error) {
    if (devLog) {
      console.warn(`[OTP DEV] Real delivery failed: ${error.message}\n          Use the code printed above.`);
      return { devLogged: true, deliveryError: error.message };
    }
    throw error;
  }
}
