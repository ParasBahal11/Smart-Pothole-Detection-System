import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Report from '../models/Report.js';
import { sendReportNotification } from '../utils/reportNotifications.js';
import { auth, admin, agency } from '../middleware/auth.js';
import {
  applyEscalation,
  agencyFromRole,
  buildComplaintRouting,
  CHANNEL_STATUSES,
  syncReportStatus,
} from '../utils/complaintRouting.js';

const r = express.Router();
const safe = (fn) => (req, res) =>
  Promise.resolve(fn(req, res)).catch((e) => {
    console.error(e);
    if (!res.headersSent) res.status(e.name === 'CastError' ? 400 : 500).json({ message: e.name === 'CastError' ? 'Invalid id' : e.message });
  });
// Must match the static folder in server.js, no matter which directory node was started from
const uploadDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');
fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: uploadDir,
  filename: (req, file, cb) =>
    cb(null, Date.now() + '-' + file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_')),
});

const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, f, cb) => {
    if (/^image\/(jpeg|png|jpg|webp)$/.test(f.mimetype)) return cb(null, true);
    cb(new Error('Only JPEG, PNG, or WebP images are allowed'));
  },
});

function aiBase() {
  return process.env.AI_URL || process.env.AI_SERVICE_URL || 'http://127.0.0.1:8000';
}

async function detect(file) {
  try {
    const fd = new FormData();
    fd.append(
      'file',
      new Blob([fs.readFileSync(file.path)], { type: 'application/octet-stream' }),
      file.originalname
    );
    const resp = await fetch(`${aiBase()}/predict`, { method: 'POST', body: fd });
    if (!resp.ok) throw new Error('AI service returned ' + resp.status);
    return await resp.json();
  } catch (e) {
    return {
      detected: false,
      label: 'AI unavailable',
      confidence: 0,
      boxes: [],
      warning: e.message,
    };
  }
}

function severityFrom(d) {
  if (!d?.detected && d?.label !== 'pothole') {
    if (d?.label === 'normal') return 'Low';
    return 'Medium';
  }
  const c = d?.confidence || 0;
  if (c >= 0.85) return 'High';
  if (c >= 0.6) return 'Medium';
  return 'Low';
}

async function escalateAndSave(doc) {
  const { changed, report } = applyEscalation(doc);
  if (changed) await report.save();
  return report;
}

async function listWithEscalation(query, populateUser) {
  const q = Report.find(query).sort({ createdAt: -1 });
  if (populateUser) q.populate('user', 'name email');
  const rows = await q;
  await Promise.all(rows.map((doc) => escalateAndSave(doc)));
  return rows;
}

r.post('/', auth, upload.single('image'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ message: 'Image is required' });
    const { latitude, longitude, address, notes } = req.body;
    if (latitude === undefined || longitude === undefined) {
      return res.status(400).json({ message: 'Location is required' });
    }
    const d = await detect(req.file);
    const severity = severityFrom(d);
    const report = await Report.create({
      user: req.user.id,
      imageUrl: `/uploads/${req.file.filename}`,
      imageName: req.file.originalname,
      detection: d,
      latitude: Number(latitude),
      longitude: Number(longitude),
      address: address?.trim() || undefined,
      notes: notes?.trim() || undefined,
      severity,
      complaintRouting: buildComplaintRouting(d, severity),
    });
    await report.populate('user', 'name email');
    let emailNotification = { sent: true };
    try {
      await sendReportNotification(report, 'registered');
    } catch (error) {
      console.error('Complaint registration email could not be sent:', error);
      emailNotification = { sent: false };
    }
    res.status(201).json({ ...report.toObject(), emailNotification });
  } catch (e) {
    res.status(500).json({ message: e.message });
  }
});

r.get('/mine', auth, safe(async (req, res) => {
  const q = { user: req.user.id };
  if (req.query.status) q.status = req.query.status;
  if (req.query.severity) q.severity = req.query.severity;
  res.json(await listWithEscalation(q, false));
}));

r.get('/stats', auth, safe(async (req, res) => {
  const match = req.user.role === 'user' ? { user: req.user.id } : {};
  const reports = await Report.find(match).select('status severity detection createdAt complaintRouting');
  for (const doc of reports) applyEscalation(doc);
  res.json({
    total: reports.length,
    pending: reports.filter((x) => x.status === 'Pending').length,
    inProgress: reports.filter((x) => x.status === 'In Progress').length,
    repaired: reports.filter((x) => x.status === 'Repaired').length,
    high: reports.filter((x) => x.severity === 'High').length,
    potholes: reports.filter((x) => x.detection?.detected || x.detection?.label === 'pothole').length,
    govSilent: reports.filter((x) => x.complaintRouting?.government?.status === 'no_response').length,
    contractorSilent: reports.filter((x) => x.complaintRouting?.contractor?.status === 'no_response').length,
    escalated: reports.filter((x) => (x.complaintRouting?.escalations || []).length > 0).length,
  });
}));

r.get('/feedback/summary', auth, safe(async (req, res) => {
  const [summary] = await Report.aggregate([
    { $match: { rating: { $gte: 1, $lte: 5 } } },
    { $group: { _id: null, average: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const recent = await Report.find({ rating: { $gte: 1, $lte: 5 }, feedback: { $ne: '' } })
    .select('rating feedback ratedAt resolutionImageUrl')
    .sort({ ratedAt: -1 })
    .limit(20)
    .lean();
  res.json({ average: summary?.average || 0, count: summary?.count || 0, recent });
}));

r.patch('/:id/feedback', auth, safe(async (req, res) => {
  const { rating, feedback } = req.body || {};
  const parsedRating = Number(rating);
  const cleanFeedback = typeof feedback === 'string' ? feedback.trim() : '';
  if (!Number.isInteger(parsedRating) || parsedRating < 1 || parsedRating > 5) {
    return res.status(400).json({ message: 'Choose a rating from 1 to 5 stars' });
  }
  if (!cleanFeedback || cleanFeedback.length > 2000) {
    return res.status(400).json({ message: 'Feedback is required and must be under 2,000 characters' });
  }
  const report = await Report.findById(req.params.id);
  if (!report) return res.status(404).json({ message: 'Report not found' });
  if (String(report.user) !== req.user.id) {
    return res.status(403).json({ message: 'You can only review your own report' });
  }
  if (report.status !== 'Repaired') {
    return res.status(409).json({ message: 'You can review this report after it is resolved' });
  }
  report.rating = parsedRating;
  report.feedback = cleanFeedback;
  report.ratedAt = new Date();
  await report.save();
  res.json({ rating: report.rating, feedback: report.feedback, ratedAt: report.ratedAt });
}));

r.get('/', auth, agency, safe(async (req, res) => {
  const q = {};
  if (req.query.status) q.status = req.query.status;
  if (req.query.severity) q.severity = req.query.severity;
  res.json(await listWithEscalation(q, true));
}));

r.patch('/:id/status', auth, agency, safe(async (req, res) => {
  const { status } = req.body;
  if (!['Pending', 'In Progress', 'Repaired'].includes(status)) {
    return res.status(400).json({ message: 'Invalid status' });
  }
  const x = await Report.findById(req.params.id);
  if (!x) return res.status(404).json({ message: 'Report not found' });
  applyEscalation(x);
  const previousStatus = x.status;
  x.status = status;
  await x.save();
  await x.populate('user', 'name email');
  let emailNotification;
  if (previousStatus !== status && (status === 'In Progress' || status === 'Repaired')) {
    emailNotification = { sent: true };
    try {
      await sendReportNotification(x, status);
    } catch (error) {
      console.error(`Complaint ${status} email could not be sent:`, error);
      emailNotification = { sent: false };
    }
  }
  res.json({ ...x.toObject(), ...(emailNotification && { emailNotification }) });
}));

r.patch('/:id/completion-image', auth, agency, upload.single('image'), safe(async (req, res) => {
  if (!req.file) return res.status(400).json({ message: 'A repair completion image is required' });
  const report = await Report.findById(req.params.id);
  if (!report) {
    await fs.promises.unlink(req.file.path);
    return res.status(404).json({ message: 'Report not found' });
  }
  if (report.status !== 'Repaired') {
    await fs.promises.unlink(req.file.path);
    return res.status(409).json({ message: 'Mark the report as repaired before uploading completion evidence' });
  }
  const previousImage = report.resolutionImageUrl;
  report.resolutionImageUrl = `/uploads/${req.file.filename}`;
  try {
    await report.save();
  } catch (error) {
    await fs.promises.unlink(req.file.path).catch((cleanupError) => {
      console.error('Failed repair image upload cleanup:', cleanupError);
    });
    throw error;
  }
  if (previousImage) {
    const previousPath = path.join(uploadDir, path.basename(previousImage));
    fs.promises.unlink(previousPath).catch((error) => console.error('Previous repair image cleanup failed:', error));
  }
  res.json({ resolutionImageUrl: report.resolutionImageUrl });
}));

r.patch('/:id/channel', auth, agency, safe(async (req, res) => {
  const agencyKey = agencyFromRole(req.user.role);
  const { status, note } = req.body;
  if (!CHANNEL_STATUSES.includes(status) || status === 'queued') {
    return res.status(400).json({ message: 'Invalid channel status' });
  }
  const x = await Report.findById(req.params.id);
  if (!x) return res.status(404).json({ message: 'Report not found' });
  const previousStatus = x.status;
  applyEscalation(x);
  if (!x.complaintRouting) x.complaintRouting = buildComplaintRouting(x.detection, x.severity);

  const channel = x.complaintRouting[agencyKey] || {};
  channel.status = status;
  channel.updatedAt = new Date();
  if (note) channel.note = note;
  if (status === 'sent' && !channel.sentAt) channel.sentAt = new Date();
  if (status === 'acknowledged' || status === 'in_progress' || status === 'resolved') {
    channel.acknowledgedAt = channel.acknowledgedAt || new Date();
  }
  x.complaintRouting[agencyKey] = channel;
  syncReportStatus(x);
  await x.save();
  await x.populate('user', 'name email');
  let emailNotification;
  if (previousStatus !== x.status && (x.status === 'In Progress' || x.status === 'Repaired')) {
    emailNotification = { sent: true };
    try {
      await sendReportNotification(x, x.status);
    } catch (error) {
      console.error(`Complaint ${x.status} email could not be sent:`, error);
      emailNotification = { sent: false };
    }
  }
  res.json({ ...x.toObject(), ...(emailNotification && { emailNotification }) });
}));

r.delete('/:id', auth, admin, safe(async (req, res) => {
  const x = await Report.findByIdAndDelete(req.params.id);
  if (!x) return res.status(404).json({ message: 'Report not found' });
  if (x.imageUrl) {
    const filePath = path.join(uploadDir, path.basename(x.imageUrl));
    fs.promises.unlink(filePath).catch(() => {});
  }
  if (x.resolutionImageUrl) {
    const filePath = path.join(uploadDir, path.basename(x.resolutionImageUrl));
    fs.promises.unlink(filePath).catch((error) => console.error('Repair image cleanup failed:', error));
  }
  res.json({ message: 'Deleted' });
}));

export default r;
