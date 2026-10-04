import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import User from '../models/User.js';
import { sendMailMessage } from './otpDelivery.js';

const uploadDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'uploads');

const esc = (v) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const complaintRef = (report) => report.trackingId || `RG-${String(report._id).slice(-6).toUpperCase()}`;

const appUrl = () => (process.env.APP_URL || String(process.env.CLIENT_URL || '').split(',')[0] || '').replace(/\/$/, '');

function layout({ title, color, lead, report, extra = '' }) {
  const place = report.address || `${report.latitude?.toFixed?.(5)}, ${report.longitude?.toFixed?.(5)}`;
  const link = appUrl();
  return `<div style="font-family:Arial,Helvetica,sans-serif;max-width:560px;margin:auto;border:1px solid #e2e6ee;border-radius:12px;overflow:hidden">
  <div style="background:#14181f;color:#fff;padding:16px 22px;font-size:18px;font-weight:700">Road<span style="color:#e8a317">Guard</span></div>
  <div style="padding:22px">
    <h2 style="margin:0 0 8px;color:${color}">${esc(title)}</h2>
    <p style="margin:0 0 14px;color:#3d4654">${lead}</p>
    <table style="width:100%;border-collapse:collapse;font-size:14px;color:#14181f">
      <tr><td style="padding:6px 0;color:#6b7585;width:130px">Complaint ID</td><td><b>${complaintRef(report)}</b></td></tr>
      <tr><td style="padding:6px 0;color:#6b7585">Location</td><td>${esc(place)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7585">Severity</td><td>${esc(report.severity)}</td></tr>
      <tr><td style="padding:6px 0;color:#6b7585">Status</td><td><b>${esc(report.status)}</b></td></tr>
    </table>
    ${extra}
    ${link ? `<p style="margin:18px 0 0"><a href="${esc(link)}" style="background:#e8a317;color:#14181f;padding:10px 16px;border-radius:8px;text-decoration:none;font-weight:700">Open RoadGuard</a></p>` : ''}
  </div>
  <div style="background:#f5f7fa;color:#6b7585;font-size:12px;padding:12px 22px">This is an automated message from RoadGuard. Please do not reply to it.</div>
</div>`;
}

const MESSAGES = {
  registered: (report) => ({
    subject: `Your complaint ${complaintRef(report)} has been registered`,
    text: `Your complaint has been registered successfully.\nComplaint ID: ${complaintRef(report)}\nWe have forwarded it to the government desk and the city road contractor. You will get an email when work starts and when it is completed.`,
    html: layout({
      title: 'Your complaint has been registered',
      color: '#0f766e',
      lead: 'Thank you for reporting. We have forwarded your complaint to the government desk and the city road contractor. You will receive an email when work starts and when it is completed.',
      report,
      extra: `<p style="margin:14px 0 0;padding:10px 12px;background:#f5f7fa;border-radius:8px;color:#3d4654">Keep your tracking ID <b>${complaintRef(report)}</b>. Anyone with this ID can check the status on the RoadGuard "Track" page, even without logging in.</p>`,
    }),
  }),
  'In Progress': (report) => ({
    subject: `Your complaint ${complaintRef(report)} is under process`,
    text: `Good news! Work on your complaint is under process.\nComplaint ID: ${complaintRef(report)}\nStatus: In Progress`,
    html: layout({
      title: 'Your complaint is under process',
      color: '#c4840a',
      lead: 'Work on your complaint has started. Our team is currently handling it. We will email you again as soon as the repair is completed.',
      report,
    }),
  }),
  Repaired: (report) => ({
    subject: `Your complaint ${complaintRef(report)} is resolved successfully`,
    text: `Your complaint has been resolved successfully.\nComplaint ID: ${complaintRef(report)}\n${report.workNote ? `Work note: ${report.workNote}\n` : ''}Photos of the completed work are attached. Please open RoadGuard and rate the repair.`,
    html: layout({
      title: 'Your complaint is resolved successfully',
      color: '#15803d',
      lead: 'The repair work for your complaint is completed. Photos of the completed work are attached to this email. Please log in to RoadGuard and rate the repair — your feedback helps us improve.',
      report,
      extra: report.workNote ? `<p style="margin:14px 0 0;padding:10px 12px;background:#f5f7fa;border-radius:8px;color:#3d4654"><b>Work note:</b> ${esc(report.workNote)}</p>` : '',
    }),
  }),
};

function workAttachments(report) {
  return (report.workImages || []).slice(0, 3).flatMap((url, i) => {
    const file = path.join(uploadDir, path.basename(url));
    return fs.existsSync(file) ? [{ filename: `work-done-${i + 1}${path.extname(file)}`, path: file }] : [];
  });
}

/**
 * kind: 'registered' | 'In Progress' | 'Repaired'
 * Sends at most one email per kind per complaint. Never throws.
 */
export async function notifyReporter(report, kind) {
  try {
    if (!MESSAGES[kind] || (report.notified || []).includes(kind)) return;
    const user = report.user?.email ? report.user : await User.findById(report.user).select('name email');
    if (!user?.email) return;
    const msg = MESSAGES[kind](report);
    const result = await sendMailMessage({
      to: user.email,
      subject: msg.subject,
      text: msg.text,
      html: msg.html,
      attachments: kind === 'Repaired' ? workAttachments(report) : undefined,
    });
    if (result.sent || result.devLogged) {
      report.notified = [...(report.notified || []), kind];
      await report.save();
    }
  } catch (error) {
    console.error(`Complaint email (${kind}) failed:`, error.message);
  }
}
