import { isPothole } from './complaintRouting.js';

// ---------- Tracking ID ----------
// Random, unambiguous characters (no 0/O/1/I) so it is easy to read out and hard to guess.
const ID_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function newTrackingId() {
  let s = '';
  for (let i = 0; i < 8; i += 1) s += ID_CHARS[Math.floor(Math.random() * ID_CHARS.length)];
  return `RG-${s}`;
}

export function normalizeTrackingId(value) {
  return String(value || '').trim().toUpperCase().replace(/\s+/g, '');
}

// ---------- Severity (explainable, rule based) ----------
// AI part (max 70): pothole confidence x 70.   Community part (max 30): 6 points per citizen who
// confirmed the same pothole (max 5 counted).  >=60 High, >=42 Medium, else Low.
// With no community support this gives the same bands as before (85% -> High, 60% -> Medium).
export function computeSeverity(detection, supporterCount = 0) {
  let ai;
  if (isPothole(detection)) ai = Math.round(Math.min(1, Math.max(0, detection?.confidence || 0)) * 70);
  else if (detection?.label === 'normal') ai = 0;
  else ai = 42; // AI unavailable / model not loaded: treat as Medium until a human checks it
  const community = Math.min(Math.max(0, supporterCount), 5) * 6;
  const score = Math.min(100, ai + community);
  const level = score >= 60 ? 'High' : score >= 42 ? 'Medium' : 'Low';
  return { score, level, ai, community };
}

// ---------- Duplicate detection (same place) ----------
export function duplicateRadiusMeters() {
  const n = Number(process.env.DUPLICATE_RADIUS_METERS);
  return Number.isFinite(n) && n > 0 ? n : 30;
}

export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000;
  const rad = (d) => (d * Math.PI) / 180;
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

// Bounding box so MongoDB can use a plain index; exact distance is then checked in JS.
export function boundingBox(lat, lon, meters) {
  const dLat = meters / 111320;
  const dLon = meters / (111320 * Math.max(0.01, Math.cos((lat * Math.PI) / 180)));
  return { minLat: lat - dLat, maxLat: lat + dLat, minLon: lon - dLon, maxLon: lon + dLon };
}

// ---------- Timeline ----------
export function addTimeline(report, { type, title, detail, by }) {
  report.timeline = report.timeline || [];
  report.timeline.push({ type, title, detail: detail || undefined, by: by || undefined, at: new Date() });
}

// Stored timeline if present, otherwise a best-effort one for complaints created before this feature.
export function timelineFor(report) {
  const stored = (report.timeline || []).map((e) => ({
    type: e.type,
    title: e.title,
    detail: e.detail,
    by: e.by,
    at: e.at,
  }));
  if (stored.length) return stored.sort((a, b) => new Date(a.at) - new Date(b.at));

  const out = [{ type: 'submitted', title: 'Complaint submitted', at: report.createdAt }];
  if (report.complaintRouting?.dispatchedAt) {
    out.push({ type: 'dispatched', title: 'Sent to Government and City Road Contractor', at: report.complaintRouting.dispatchedAt });
  }
  for (const e of report.complaintRouting?.escalations || []) {
    out.push({ type: 'escalated', title: `Escalated from ${e.from} to ${e.to}`, detail: e.reason, at: e.at });
  }
  if (report.status === 'In Progress') out.push({ type: 'status', title: 'Work in progress', at: report.updatedAt });
  if (report.completedAt) out.push({ type: 'status', title: 'Repaired', at: report.completedAt });
  return out.sort((a, b) => new Date(a.at) - new Date(b.at));
}
