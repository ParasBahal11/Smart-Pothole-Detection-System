import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import auth from './routes/auth.js';
import reports from './routes/reports.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();

app.use(cors({ origin: process.env.CLIENT_URL?.split(',') || true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

app.get('/api/health', (req, res) => res.json({ ok: true, service: 'backend' }));
app.use('/api/auth', auth);
app.use('/api/reports', reports);

const port = process.env.PORT || 5000;
mongoose
  .connect(process.env.MONGO_URI)
  .then(() => app.listen(port, () => console.log(`Backend running on http://localhost:${port}`)))
  .catch((e) => {
    console.error('MongoDB connection failed:', e.message);
    process.exit(1);
  });
