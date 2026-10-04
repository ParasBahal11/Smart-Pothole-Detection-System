import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import Report from '../models/Report.js';
import { auth, agency } from '../middleware/auth.js';
import {
  applyEscalation,
  agencyFromRole,
  buildComplaintRouting,
  CHANNEL_STATUSES,
  syncReportStatus,
} from '../utils/complaintRouting.js';
import { notifyReporter } from '../utils/notify.js';
import {
  addTimeline,
  boundingBox,
  computeSeverity,
  distanceMeters,
  duplicateRadiusMeters,
  newTrackingId,
  normalizeTrackingId,
  timelineFor,
} from '../utils/reportInsights.js';

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
  const configuredUrl = process.env.AI_URL || process.env.AI_SERVICE_URL;
  if (!configuredUrl) return 'http://127.0.0.1:8000';
  if (/^https?:\/\//i.test(configuredUrl)) return configuredUrl.replace(/\/+$/, '');
  return `${/^(localhost|127\.)/i.test(configuredUrl) ? 'http' : 'https'}://${configuredUrl.replace(/\/+$/, '')}`;
}

const NEEDS_PHOTO = 'Add at least one photo of the completed work before marking this complaint as Repaired';
const MIN_POTHOLE_CONFIDENCE = 0.75;
const hasWorkPhoto = (report) => (report.workImages || []).length > 0;

function notifyStatus(report, previousStatus) {
  if (report.status === previousStatus) return;
  if (report.status === 'In Progress' || report.status === 'Repaired') {
    notifyReporter(report, report.status); // fire-and-forget, never throws
  }
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
    const result = await resp.json().catch(() => ({}));
    if (!resp.ok) {
      throw Object.assign(new Error(result.message || 'AI detection service is unavailable'), { status: 503 });
    }
    return result;
  } catch (e) {
    if (e.status) throw e;
    throw Object.assign(new Error(`AI detection is unavailable: ${e.message}`), { status: 503 });
  }
}

const roleLabel = (role) => (role === 'admin' ? 'Government' : role === 'contractor' ? 'City road contractor' : 'Citizen');

async function uniqueTrackingId() {
  for (let i = 0; i < 6; i += 1) {
    const id = newTrackingId();
    if (!(await Report.exists({ trackingId: id }))) return id;
  }
  return `${newTrackingId()}${Math.floor(Math.random() * 9)}`;
}

// Open (not yet repaired) pothole complaints within DUPLICATE_RADIUS_METERS (default 30 m) of a point.
async function findNearbyOpen(lat, lon, userId) {
  const radius = duplicateRadiusMeters();
  const box = boundingBox(lat, lon, radius);
  const rows = await Report.find({
    status: { $ne: 'Repaired' },
    latitude: { $gte: box.minLat, $lte: box.maxLat },
    longitude: { $gte: box.minLon, $lte: box.maxLon },
  })
    .select('trackingId address status severity imageUrl latitude longitude supporters user detection createdAt')
    .limit(30);
  return rows
    .filter((x) => x.detection?.label !== 'normal')
    .map((x) => ({
      id: x._id,
      trackingId: x.trackingId,
      address: x.address,
      status: x.status,
      severity: x.severity,
      imageUrl: x.imageUrl,
      createdAt: x.createdAt,
      distance: Math.round(distanceMeters(lat, lon, x.latitude, x.longitude)),
      supportCount: (x.supporters || []).length,
      mine: String(x.user) === String(userId),
      alreadySupported: (x.supporters || []).some((id) => String(id) === String(userId)),
    }))
    .filter((x) => x.distance <= radius)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, 5);
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
    const lat = Number(latitude);
    const lon = Number(longitude);
    if (latitude === undefined || longitude === undefined || !Number.isFinite(lat) || !Number.isFinite(lon)) {
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(400).json({ message: 'Location is required' });
    }

    const d = await detect(req.file);
    if (
      d?.detected !== true ||
      d?.label !== 'pothole' ||
      !Number.isFinite(d?.confidence) ||
      d.confidence < MIN_POTHOLE_CONFIDENCE
    ) {
      fs.promises.unlink(req.file.path).catch(() => {});
      return res.status(422).json({
        message: `Pothole detection was not confident enough (minimum ${Math.round(MIN_POTHOLE_CONFIDENCE * 100)}%). Please upload a clear pothole photo.`,
      });
    }

    // Duplicate detection: the same pothole may already be reported. Ask the citizen to support the
    // existing complaint instead (they can still force a new one with confirmNew=true).
    if (req.body.confirmNew !== 'true') {
      const nearby = await findNearbyOpen(lat, lon, req.user.id);
      if (nearby.length) {
        fs.promises.unlink(req.file.path).catch(() => {});
        return res.status(409).json({
          duplicate: true,
          radius: duplicateRadiusMeters(),
          message: `A complaint for this spot already exists within ${duplicateRadiusMeters()} m. Support it instead of filing a duplicate.`,
          nearby,
        });
      }
    }

    const sev = computeSeverity(d, 0);
    const report = await Report.create({
      user: req.user.id,
      trackingId: await uniqueTrackingId(),
      imageUrl: `/uploads/${req.file.filename}`,
      imageName: req.file.originalname,
      detection: d,
      latitude: lat,
      longitude: lon,
      address: address?.trim() || undefined,
      notes: notes?.trim() || undefined,
      severity: sev.level,
      severityScore: sev.score,
      complaintRouting: buildComplaintRouting(d, sev.level),
    });
    addTimeline(report, {
      type: 'submitted',
      title: 'Complaint submitted',
      detail: `AI: ${d.label || 'unknown'} (${Math.round((d.confidence || 0) * 100)}%) - severity ${sev.level}`,
      by: 'Citizen',
    });
    if (report.complaintRouting?.dispatched) {
      addTimeline(report, { type: 'dispatched', title: 'Sent to Government and City Road Contractor', by: 'system' });
    }
    await report.save();
    notifyReporter(report, 'registered');
    res.status(201).json(report);
  } catch (e) {
    if (req.file?.path) fs.promises.unlink(req.file.path).catch(() => {});
    res.status(e.status || 500).json({ message: e.message });
  }
});

// Citizens may update the address and notes on their own pending reports.
r.patch('/:id', auth, safe(async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ message: 'Only citizens can edit their reports' });
  const report = await Report.findById(req.params.id);
  if (!report) return res.status(404).json({ message: 'Report not found' });
  if (String(report.user) !== req.user.id) return res.status(403).json({ message: 'You can only edit your own report' });
  if (report.status !== 'Pending') return res.status(409).json({ message: 'Only pending reports can be edited' });

  const { address, notes } = req.body || {};
  if (!Object.hasOwn(req.body || {}, 'address') && !Object.hasOwn(req.body || {}, 'notes')) {
    return res.status(400).json({ message: 'Provide an address or notes to update' });
  }
  if (Object.hasOwn(req.body || {}, 'address')) {
    if (typeof address !== 'string' || address.trim().length > 300) {
      return res.status(400).json({ message: 'Address must be under 300 characters' });
    }
    report.address = address.trim();
  }
  if (Object.hasOwn(req.body || {}, 'notes')) {
    if (typeof notes !== 'string' || notes.trim().length > 2000) {
      return res.status(400).json({ message: 'Notes must be under 2,000 characters' });
    }
    report.notes = notes.trim();
  }
  addTimeline(report, { type: 'updated', title: 'Report details updated', by: 'Citizen' });
  await report.save();
  res.json(report);
}));

// Citizen confirms an existing complaint ("me too") instead of filing a duplicate.
// More confirmations raise the severity score, which can raise the priority.
r.post('/:id/support', auth, safe(async (req, res) => {
  if (req.user.role !== 'user') return res.status(403).json({ message: 'Only citizens can support a complaint' });
  const x = await Report.findById(req.params.id);
  if (!x) return res.status(404).json({ message: 'Report not found' });
  if (x.status === 'Repaired') return res.status(409).json({ message: 'This complaint is already resolved' });
  if (String(x.user) === req.user.id) return res.status(400).json({ message: 'This is your own complaint' });
  if ((x.supporters || []).some((id) => String(id) === req.user.id)) {
    return res.status(409).json({ message: 'You have already supported this complaint' });
  }
  x.supporters.push(req.user.id);
  const before = x.severity;
  const sev = computeSeverity(x.detection, x.supporters.length);
  x.severity = sev.level;
  x.severityScore = sev.score;
  addTimeline(x, {
    type: 'support',
    title: `Another citizen confirmed this pothole (${x.supporters.length} confirmation${x.supporters.length === 1 ? '' : 's'})`,
    by: 'Citizen',
  });
  if (before !== sev.level) {
    addTimeline(x, { type: 'severity', title: `Priority raised from ${before} to ${sev.level}`, detail: `Severity score ${sev.score}/100`, by: 'system' });
    if (x.complaintRouting?.dispatched && sev.level === 'High') x.complaintRouting.primary = 'government';
  }
  await x.save();
  res.json(x);
}));

// Public tracking (no login): limited fields only, never the reporter's identity or exact coordinates.
const trackHits = new Map();
r.get('/track/:trackingId', safe(async (req, res) => {
  const now = Date.now();
  const hit = trackHits.get(req.ip) || { n: 0, t: now };
  if (now - hit.t > 60_000) { hit.n = 0; hit.t = now; }
  hit.n += 1;
  trackHits.set(req.ip, hit);
  if (trackHits.size > 5000) trackHits.clear();
  if (hit.n > 30) return res.status(429).json({ message: 'Too many lookups. Please wait a minute.' });

  const id = normalizeTrackingId(req.params.trackingId);
  const x = id ? await Report.findOne({ trackingId: id }) : null;
  if (!x) return res.status(404).json({ message: 'No complaint found for this tracking ID' });
  applyEscalation(x);
  res.json({
    trackingId: x.trackingId,
    status: x.status,
    severity: x.severity,
    severityScore: x.severityScore,
    address: x.address || null,
    imageUrl: x.imageUrl,
    workImages: x.workImages || [],
    workNote: x.workNote || null,
    createdAt: x.createdAt,
    completedAt: x.completedAt || null,
    supportCount: (x.supporters || []).length,
    government: x.complaintRouting?.government?.status || null,
    contractor: x.complaintRouting?.contractor?.status || null,
    timeline: timelineFor(x.toObject()),
  });
}));

// Analytics for charts. Citizens see their own complaints, government/contractor see all.
r.get('/analytics', auth, safe(async (req, res) => {
  const match = req.user.role === 'user' ? { user: req.user.id } : {};
  const rows = await Report.find(match)
    .select('status severity detection createdAt completedAt rating supporters complaintRouting')
    .lean();

  const count = (arr, fn) => arr.reduce((m, x) => { const k = fn(x); m[k] = (m[k] || 0) + 1; return m; }, {});
  const byStatus = count(rows, (x) => x.status);
  const bySeverity = count(rows, (x) => x.severity);

  const months = [];
  const now = new Date();
  for (let i = 5; i >= 0; i -= 1) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
    months.push({
      key: `${d.getUTCFullYear()}-${d.getUTCMonth()}`,
      label: d.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' }),
      reported: 0,
      resolved: 0,
    });
  }
  const slot = (date) => date && months.find((m) => m.key === `${new Date(date).getUTCFullYear()}-${new Date(date).getUTCMonth()}`);
  for (const x of rows) {
    const c = slot(x.createdAt); if (c) c.reported += 1;
    const d = x.status === 'Repaired' ? slot(x.completedAt || x.createdAt) : null; if (d) d.resolved += 1;
  }

  const repaired = rows.filter((x) => x.status === 'Repaired' && x.completedAt && x.createdAt);
  const hours = repaired.map((x) => (new Date(x.completedAt) - new Date(x.createdAt)) / 36e5).filter((h) => h >= 0);
  const rated = rows.filter((x) => x.rating >= 1);

  res.json({
    total: rows.length,
    byStatus: { Pending: byStatus.Pending || 0, 'In Progress': byStatus['In Progress'] || 0, Repaired: byStatus.Repaired || 0 },
    bySeverity: { Low: bySeverity.Low || 0, Medium: bySeverity.Medium || 0, High: bySeverity.High || 0 },
    monthly: months.map(({ label, reported, resolved }) => ({ label, reported, resolved })),
    resolutionRate: rows.length ? Math.round(((byStatus.Repaired || 0) / rows.length) * 100) : 0,
    avgRepairHours: hours.length ? Math.round((hours.reduce((a, b) => a + b, 0) / hours.length) * 10) / 10 : null,
    repairedCount: hours.length,
    avgRating: rated.length ? Math.round((rated.reduce((a, x) => a + x.rating, 0) / rated.length) * 10) / 10 : null,
    ratingCount: rated.length,
    duplicatesPrevented: rows.reduce((a, x) => a + (x.supporters || []).length, 0),
    escalated: rows.filter((x) => (x.complaintRouting?.escalations || []).length > 0).length,
  });
}));

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
    .select('rating feedback ratedAt workImages address')
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
  addTimeline(report, { type: 'feedback', title: `Citizen rated the repair ${parsedRating}/5`, by: 'Citizen' });
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
  if (status === 'Repaired' && !hasWorkPhoto(x)) return res.status(400).json({ message: NEEDS_PHOTO });
  const previous = x.status;
  applyEscalation(x);
  x.status = status;
  if (status === 'Repaired' && !x.completedAt) x.completedAt = new Date();
  if (status !== previous) {
    const title = status === 'In Progress' ? 'Work started - complaint is under process' : status === 'Repaired' ? 'Repaired - complaint resolved' : 'Moved back to pending';
    addTimeline(x, { type: 'status', title, by: roleLabel(req.user.role) });
  }
  await x.save();
  await x.populate('user', 'name email');
  notifyStatus(x, previous);
  res.json(x);
}));

r.patch('/:id/channel', auth, agency, safe(async (req, res) => {
  const agencyKey = agencyFromRole(req.user.role);
  const { status, note } = req.body;
  if (!CHANNEL_STATUSES.includes(status) || status === 'queued') {
    return res.status(400).json({ message: 'Invalid channel status' });
  }
  const x = await Report.findById(req.params.id);
  if (!x) return res.status(404).json({ message: 'Report not found' });
  const previous = x.status;
  applyEscalation(x);
  if (!x.complaintRouting) x.complaintRouting = buildComplaintRouting(x.detection, x.severity);

  const channel = x.complaintRouting[agencyKey] || {};
  const previousChannel = channel.status;
  channel.status = status;
  channel.updatedAt = new Date();
  if (note) channel.note = note;
  if (status === 'sent' && !channel.sentAt) channel.sentAt = new Date();
  if (status === 'acknowledged' || status === 'in_progress' || status === 'resolved') {
    channel.acknowledgedAt = channel.acknowledgedAt || new Date();
  }
  x.complaintRouting[agencyKey] = channel;
  syncReportStatus(x);
  if (x.status === 'Repaired' && !hasWorkPhoto(x)) return res.status(400).json({ message: NEEDS_PHOTO });
  if (x.status === 'Repaired' && !x.completedAt) x.completedAt = new Date();
  if (status !== previousChannel) {
    addTimeline(x, { type: 'desk', title: `${roleLabel(req.user.role)} desk: ${status.replace(/_/g, ' ')}`, detail: note || undefined, by: roleLabel(req.user.role) });
  }
  if (x.status !== previous) {
    const title = x.status === 'In Progress' ? 'Work started - complaint is under process' : x.status === 'Repaired' ? 'Repaired - complaint resolved' : `Status changed to ${x.status}`;
    addTimeline(x, { type: 'status', title, by: roleLabel(req.user.role) });
  }
  await x.save();
  await x.populate('user', 'name email');
  notifyStatus(x, previous);
  res.json(x);
}));

const workUpload = upload.array('images', 4);

r.post('/:id/work-images', auth, agency, (req, res, next) => workUpload(req, res, (err) => (err ? next(err) : next())), safe(async (req, res) => {
  const files = req.files || [];
  if (!files.length) return res.status(400).json({ message: 'Choose at least one photo of the completed work' });
  const x = await Report.findById(req.params.id);
  if (!x) {
    files.forEach((f) => fs.promises.unlink(f.path).catch(() => {}));
    return res.status(404).json({ message: 'Report not found' });
  }
  const room = Math.max(0, 6 - (x.workImages || []).length);
  files.slice(room).forEach((f) => fs.promises.unlink(f.path).catch(() => {}));
  x.workImages = [...(x.workImages || []), ...files.slice(0, room).map((f) => `/uploads/${f.filename}`)];
  const note = typeof req.body.note === 'string' ? req.body.note.trim().slice(0, 1000) : '';
  if (note) x.workNote = note;
  addTimeline(x, { type: 'work', title: `${Math.min(files.length, room)} photo(s) of completed work added`, by: roleLabel(req.user.role) });
  await x.save();
  await x.populate('user', 'name email');
  res.json(x);
}));

r.delete('/:id', auth, safe(async (req, res) => {
  const report = await Report.findById(req.params.id);
  if (!report) return res.status(404).json({ message: 'Report not found' });
  const isOwner = req.user.role === 'user' && String(report.user) === req.user.id;
  if (req.user.role !== 'admin' && !isOwner) {
    return res.status(403).json({ message: 'You are not allowed to delete this report' });
  }
  const x = await Report.findByIdAndDelete(req.params.id);
  if (!x) return res.status(404).json({ message: 'Report not found' });
  for (const url of [x.imageUrl, ...(x.workImages || [])].filter(Boolean)) {
    fs.promises.unlink(path.join(uploadDir, path.basename(url))).catch(() => {});
  }
  res.json({ message: 'Deleted' });
}));

export default r;
