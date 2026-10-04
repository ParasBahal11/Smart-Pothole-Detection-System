// Usage:  npm run test:mail -- someone@gmail.com
// Sends a real test email to ANY address and prints the exact error if it fails.
import 'dotenv/config';
import { emailProvider, sendMailMessage } from './otpDelivery.js';

const to = process.argv[2];
if (!to || !to.includes('@')) {
  console.error('Usage: npm run test:mail -- someone@example.com');
  process.exit(1);
}
const provider = emailProvider();
console.log('Email provider in use:', provider || 'NONE (configure BREVO_API_KEY or SMTP_* in backend/.env)');
if (!provider) process.exit(1);
try {
  await sendMailMessage({
    to,
    subject: 'RoadGuard test email',
    text: 'If you can read this, RoadGuard can send OTP and complaint emails to this address.',
  });
  console.log(`OK - email accepted for delivery to ${to}. Check the inbox and the spam folder.`);
} catch (e) {
  console.error('FAILED:', e.message);
  process.exit(1);
}
