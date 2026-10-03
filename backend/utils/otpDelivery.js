import nodemailer from 'nodemailer';
import twilio from 'twilio';

const isProduction = process.env.NODE_ENV === 'production';

// Local/demo mode: OTP is printed in the backend terminal so you can log in
// even when SMTP / Twilio is not configured. Never active in production.
export function otpDevLogEnabled() {
  return process.env.OTP_DEV_LOG === 'true' && !isProduction;
}

const PLACEHOLDER = /(example\.com|your-|replace-with|xxxxxxxx|^$)/i;

function looksConfigured(value) {
  return Boolean(value) && !PLACEHOLDER.test(String(value));
}

// Accepts "RoadGuard <a@b.com>", "a@b.com" and also the common typo
// "RoadGuard a@b.com" (missing angle brackets) and turns it into a valid header.
function normalizeFrom(from, fallback) {
  const value = String(from || fallback || '').trim();
  if (!value) return '';
  if (/<[^>]+>/.test(value) || !/\s/.test(value)) return value;
  const match = value.match(/^(.*?)\s+([^\s@]+@[^\s@]+\.[^\s@]+)$/);
  return match ? `${match[1].trim()} <${match[2]}>` : value;
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

async function sendEmail({ destination, code }) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (![SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS].every(looksConfigured)) {
    throw new Error(
      'Email OTP is not configured: set real SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS in backend/.env (for Gmail use smtp.gmail.com and an App Password).'
    );
  }
  const from = normalizeFrom(process.env.SMTP_FROM, SMTP_USER);
  await getTransporter().sendMail({
    from,
    to: destination,
    subject: 'Your RoadGuard verification code',
    text: `Your RoadGuard verification code is ${code}. It expires in 10 minutes.`,
  });
}

export async function sendTransactionalEmail({ destination, subject, text }) {
  const { SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS } = process.env;
  if (![SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS].every(looksConfigured)) {
    throw new Error('Transactional email is not configured: set SMTP_HOST, SMTP_PORT, SMTP_USER and SMTP_PASS.');
  }
  await getTransporter().sendMail({
    from: normalizeFrom(process.env.SMTP_FROM, SMTP_USER),
    to: destination,
    subject,
    text,
  });
}

async function sendSms({ destination, code }) {
  const { TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER } = process.env;
  if (![TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER].every(looksConfigured)) {
    throw new Error(
      'SMS OTP is not configured: set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN and TWILIO_PHONE_NUMBER (a number bought from Twilio) in backend/.env.'
    );
  }
  const client = twilio(TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN);
  await client.messages.create({
    body: `Your RoadGuard verification code is ${code}. It expires in 10 minutes.`,
    from: TWILIO_PHONE_NUMBER,
    to: destination,
  });
}

/**
 * Sends the OTP. Returns { devLogged: boolean }.
 * With OTP_DEV_LOG=true (non-production) the code is also printed to the
 * backend console and a delivery failure does not block the login.
 */
export async function sendOtp({ channel, destination, code }) {
  const devLog = otpDevLogEnabled();
  if (devLog) {
    console.log(`\n[OTP DEV] ${channel.toUpperCase()} code for ${destination}: ${code}\n`);
  }
  try {
    if (channel === 'email') await sendEmail({ destination, code });
    else await sendSms({ destination, code });
    return { devLogged: devLog };
  } catch (error) {
    if (devLog) {
      console.warn(`[OTP DEV] Real delivery skipped/failed (${error.message}). Use the code above.`);
      return { devLogged: true };
    }
    throw error;
  }
}
