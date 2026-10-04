import 'dotenv/config';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import User from '../models/User.js';

await mongoose.connect(process.env.MONGO_URI);

async function upsert({ name, email, password, role, otpEmail }) {
  let u = await User.findOne({ email });
  const hash = await bcrypt.hash(password, 10);
  if (!u) {
    u = await User.create({ name, email, password: hash, role, ...(otpEmail ? { otpEmail } : {}) });
  } else {
    u.role = role;
    u.name = name;
    u.password = hash;
    if (otpEmail) u.otpEmail = otpEmail;
    await u.save();
  }
  console.log(`${role} ready:`, email);
}

await upsert({
  name: process.env.ADMIN_NAME || 'Government Admin',
  email: process.env.ADMIN_EMAIL || 'admin@pothole.local',
  password: process.env.ADMIN_PASSWORD || 'Admin@12345',
  role: 'admin',
  otpEmail: process.env.ADMIN_OTP_EMAIL,
});

await upsert({
  name: process.env.CONTRACTOR_NAME || 'City Road Contractor',
  email: process.env.CONTRACTOR_EMAIL || 'contractor@pothole.local',
  password: process.env.CONTRACTOR_PASSWORD || 'Contractor@12345',
  role: 'contractor',
  otpEmail: process.env.CONTRACTOR_OTP_EMAIL,
});

await mongoose.disconnect();
