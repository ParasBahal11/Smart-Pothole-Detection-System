import mongoose from 'mongoose';

const authOtpSchema = new mongoose.Schema({
  email: { type: String, required: true, lowercase: true, trim: true },
  purpose: { type: String, required: true, enum: ['login', 'register'] },
  channel: { type: String, required: true, enum: ['email', 'sms'] },
  otpHash: { type: String, required: true },
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  registration: {
    name: String,
    phone: String,
    passwordHash: String,
  },
  attempts: { type: Number, default: 0 },
  expiresAt: { type: Date, required: true, expires: 0 },
  createdAt: { type: Date, default: Date.now },
});

authOtpSchema.index({ email: 1, purpose: 1 }, { unique: true });

export default mongoose.model('AuthOtp', authOtpSchema);
