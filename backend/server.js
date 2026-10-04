import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import path from 'path';
import { fileURLToPath } from 'url';
import auth from './routes/auth.js';
import reports from './routes/reports.js';
import contact from './routes/contact.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
app.set('trust proxy', 1); // Render/Heroku-style reverse proxy: correct client IP for Turnstile

app.use(cors({ origin: process.env.CLIENT_URL?.split(',') || true }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// HOME ROUTE
app.get('/', (req, res) => {
  res.send('Smart Pothole Detection Backend is Running 🚀');
});

// HEALTH CHECK
app.get('/api/health', (req, res) => {
  res.json({
    ok: true,
    service: 'backend',
    db: mongoose.connection.readyState === 1 ? 'connected' : 'disconnected',
  });
});

app.use('/api/auth', auth);
app.use('/api/reports', reports);
app.use('/api/contact', contact);

// Unknown API route -> JSON (not Express' default HTML page)
app.use('/api', (req, res) => res.status(404).json({ message: `Route not found: ${req.method} ${req.originalUrl}` }));

// Central error handler: multer errors (file too big / wrong type), bad JSON, uncaught route errors
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  console.error(err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ message: 'Image is too large (max 5 MB)' });
  if (err.type === 'entity.parse.failed') return res.status(400).json({ message: 'Invalid JSON in request body' });
  const status = err.status || err.statusCode || (err.name === 'MulterError' ? 400 : 500);
  res.status(status).json({ message: err.message || 'Server error' });
});

process.on('unhandledRejection', (reason) => console.error('Unhandled rejection:', reason));

const port = process.env.PORT || 5000;

mongoose
  .connect(process.env.MONGO_URI)
  .then(() =>
    app.listen(port, '0.0.0.0', () =>
      console.log(`Backend running on port ${port}`)
    )
  )
  .catch((e) => {
    console.error('MongoDB connection failed:', e.message);
    process.exit(1);
  });