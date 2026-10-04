import express from 'express';
import ContactMessage from '../models/ContactMessage.js';
import { sendMailMessage } from '../utils/otpDelivery.js';

const r = express.Router();

// very small in-memory rate limit: 5 messages per 10 minutes per IP
const hits = new Map();
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) || []).filter((t) => now - t < 10 * 60 * 1000);
  recent.push(now);
  hits.set(ip, recent);
  return recent.length > 5;
}

const supportEmail = () => process.env.SUPPORT_EMAIL || process.env.SMTP_USER || '';

r.get('/info', (req, res) => {
  res.json({
    email: process.env.SUPPORT_EMAIL || '',
    phone: process.env.SUPPORT_PHONE || '',
    hours: process.env.SUPPORT_HOURS || 'Mon–Sat, 9:00 AM – 6:00 PM',
    address: process.env.SUPPORT_ADDRESS || '',
  });
});

r.post('/', async (req, res) => {
  try {
    if (req.body.website) return res.json({ message: 'Thanks! Your message has been sent.' }); // honeypot
    if (limited(req.ip)) return res.status(429).json({ message: 'Too many messages. Please try again in a few minutes.' });

    const name = String(req.body.name || '').trim();
    const email = String(req.body.email || '').trim().toLowerCase();
    const subject = String(req.body.subject || '').trim().slice(0, 200);
    const message = String(req.body.message || '').trim();
    if (!name || !message) return res.status(400).json({ message: 'Name and message are required' });
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return res.status(400).json({ message: 'Enter a valid email address' });
    if (message.length < 10 || message.length > 3000) {
      return res.status(400).json({ message: 'Message must be between 10 and 3000 characters' });
    }

    await ContactMessage.create({ name: name.slice(0, 120), email, subject, message });

    const to = supportEmail();
    if (to) {
      sendMailMessage({
        to,
        replyTo: email,
        subject: `[RoadGuard contact] ${subject || 'New message'} — ${name}`,
        text: `From: ${name} <${email}>\n\n${message}`,
      }).catch((e) => console.error('Contact email failed:', e.message));
    }
    res.status(201).json({ message: 'Thanks! Your message has been sent. We will reply by email.' });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

export default r;
