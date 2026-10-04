const CHANNEL_STATUSES = ['queued', 'sent', 'acknowledged', 'in_progress', 'resolved', 'no_response'];

export function isPothole(detection) {
  return Boolean(detection?.detected || detection?.label === 'pothole');
}

function shouldDispatch(detection) {
  return isPothole(detection);
}

function emptyChannel(status = 'queued') {
  return { status, sentAt: null, acknowledgedAt: null, updatedAt: new Date(), note: '' };
}

export function buildComplaintRouting(detection, severity) {
  const pothole = isPothole(detection);
  const primary = severity === 'High' ? 'government' : 'contractor';
  const now = new Date();

  if (!shouldDispatch(detection)) {
    return {
      dispatched: false,
      dispatchedAt: null,
      primary,
      government: emptyChannel('queued'),
      contractor: emptyChannel('queued'),
      escalations: [],
    };
  }

  return {
    dispatched: true,
    dispatchedAt: now,
    primary,
    government: { status: 'sent', sentAt: now, acknowledgedAt: null, updatedAt: now, note: 'Dispatched to municipal / government desk' },
    contractor: { status: 'sent', sentAt: now, acknowledgedAt: null, updatedAt: now, note: 'Dispatched to city road contractor' },
    escalations: [],
  };
}

function hoursMs() {
  const h = Number(process.env.ESCALATION_HOURS || 24);
  return Math.max(0.001, h) * 60 * 60 * 1000;
}

function silent(channel) {
  return channel?.status === 'sent' && !channel?.acknowledgedAt;
}

export function applyEscalation(report) {
  const routing = report.complaintRouting;
  if (!routing?.dispatched) return { changed: false, report };

  const cutoff = Date.now() - hoursMs();
  let changed = false;
  const pairs = [
    ['government', 'contractor'],
    ['contractor', 'government'],
  ];

  for (const [from, to] of pairs) {
    const channel = routing[from];
    if (!silent(channel) || !channel.sentAt) continue;
    if (new Date(channel.sentAt).getTime() > cutoff) continue;

    const already = (routing.escalations || []).some((e) => e.from === from && e.to === to);
    channel.status = 'no_response';
    channel.updatedAt = new Date();
    channel.note = `${from} did not acknowledge in time`;

    const other = routing[to];
    if (other && other.status !== 'resolved') {
      if (other.status === 'queued') {
        other.status = 'sent';
        other.sentAt = other.sentAt || new Date();
      }
      other.updatedAt = new Date();
      other.note = `Escalated because ${from} did not respond`;
    }

    if (!already) {
      routing.escalations = routing.escalations || [];
      routing.escalations.push({
        from,
        to,
        at: new Date(),
        reason: `${from} did not respond within the SLA window`,
      });
      report.timeline = report.timeline || [];
      report.timeline.push({
        type: 'escalated',
        title: `Escalated from ${from} to ${to}`,
        detail: `${from} did not respond within the SLA window`,
        by: 'system',
        at: new Date(),
      });
    }
    changed = true;
  }

  report.complaintRouting = routing;
  return { changed, report };
}

export function agencyFromRole(role) {
  if (role === 'admin') return 'government';
  if (role === 'contractor') return 'contractor';
  return null;
}

export function syncReportStatus(report) {
  const g = report.complaintRouting?.government?.status;
  const c = report.complaintRouting?.contractor?.status;
  if (g === 'resolved' || c === 'resolved') report.status = 'Repaired';
  else if (g === 'in_progress' || c === 'in_progress' || g === 'acknowledged' || c === 'acknowledged') {
    report.status = 'In Progress';
  }
  return report;
}

export { CHANNEL_STATUSES };
