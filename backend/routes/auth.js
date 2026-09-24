import express from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import User from '../models/User.js';
import { auth } from '../middleware/auth.js';
import { verifyTurnstile } from '../utils/turnstile.js';

const r = express.Router();

const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, role: u.role });

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

r.post('/register', async (req, res) => {
  try {
    if (!(await requireTurnstile(req, res))) return;
    const { name, email, password } = req.body;
    if (!name || !email || !password) {
      return res.status(400).json({ message: 'Name, email and password are required' });
    }
    if (password.length < 6) {
      return res.status(400).json({ message: 'Password must contain at least 6 characters' });
    }
    if (await User.findOne({ email })) {
      return res.status(409).json({ message: 'Email already registered' });
    }
    const u = await User.create({ name, email, password: await bcrypt.hash(password, 10) });
    res.status(201).json({ token: token(u), user: publicUser(u) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

r.post('/login', async (req, res) => {
  try {
    if (!(await requireTurnstile(req, res))) return;
    const { email, password } = req.body;
    const u = await User.findOne({ email });
    if (!u || !(await bcrypt.compare(password, u.password))) {
      return res.status(401).json({ message: 'Invalid email or password' });
    }
    res.json({ token: token(u), user: publicUser(u) });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

r.get('/me', auth, async (req, res) => {
  const u = await User.findById(req.user.id).select('name email role createdAt');
  if (!u) return res.status(404).json({ message: 'User not found' });
  res.json({ user: publicUser(u) });
});

export default r;
