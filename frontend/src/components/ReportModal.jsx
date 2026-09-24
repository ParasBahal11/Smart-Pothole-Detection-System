import React, { useState } from 'react';
import { api, authHeaders, baseUrl } from '../api';

function channelLabel(status) {
  return (status || 'queued').replace(/_/g, ' ');
}

export default function ReportModal({ report, agency, role, token, onClose, onUpdated, onError }) {
  const [status, setStatus] = useState(report.status);
  const [channelStatus, setChannelStatus] = useState(
    role === 'contractor'
      ? report.complaintRouting?.contractor?.status || 'sent'
      : report.complaintRouting?.government?.status || 'sent'
  );
  const [busy, setBusy] = useState(false);
  const conf = Math.round((report.detection?.confidence || 0) * 100);
  const myLane = role === 'contractor' ? 'City road contractor' : 'Government';

  const save = async () => {
    if (!agency) return onClose();
    setBusy(true);
    try {
      await api(`/reports/${report._id}/status`, {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({ status }),
      });
      await api(`/reports/${report._id}/channel`, {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({ status: channelStatus }),
      });
      onUpdated();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!confirm('Delete this report?')) return;
    setBusy(true);
    try {
      await api(`/reports/${report._id}`, {
        method: 'DELETE',
        headers: authHeaders(token, false),
      });
      onUpdated();
    } catch (e) {
      onError?.(e.message);
    } finally {
      setBusy(false);
    }
  };

  const gov = report.complaintRouting?.government;
  const con = report.complaintRouting?.contractor;
  const escalations = report.complaintRouting?.escalations || [];

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="report-title"
        onClick={(e) => e.stopPropagation()}
      >
        <button type="button" className="modal-close" onClick={onClose} style={{ margin: 12 }}>
          Close
        </button>
        <div className="modal-media">
          {report.imageUrl ? (
            <img src={baseUrl + report.imageUrl} alt="Pothole report" />
          ) : (
            <p style={{ color: '#fff' }}>No image</p>
          )}
        </div>
        <div className="modal-body">
          <h2 id="report-title">{report.detection?.label || 'Road report'}</h2>
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            {conf}% AI confidence · Severity {report.severity}
            {report.complaintRouting?.dispatched ? ' · Dual-desk complaint' : ''}
          </p>

          <div className="route-grid">
            <div className="route-card">
              <label>Government</label>
              <strong>{channelLabel(gov?.status)}</strong>
              <small>{gov?.note || 'Municipal / PWD desk'}</small>
            </div>
            <div className="route-card">
              <label>City road contractor</label>
              <strong>{channelLabel(con?.status)}</strong>
              <small>{con?.note || 'Repair contractor desk'}</small>
            </div>
          </div>

          {escalations.length > 0 && (
            <div className="info-box">
              {escalations.map((e, i) => (
                <div key={i}>
                  Escalated from {e.from} to {e.to}
                  {e.reason ? ` — ${e.reason}` : ''}
                </div>
              ))}
            </div>
          )}

          <div className="modal-meta">
            <div className="meta-item">
              <label>Repair status</label>
              {agency ? (
                <select value={status} onChange={(e) => setStatus(e.target.value)}>
                  <option>Pending</option>
                  <option>In Progress</option>
                  <option>Repaired</option>
                </select>
              ) : (
                <div>{report.status}</div>
              )}
            </div>
            {agency && (
              <div className="meta-item">
                <label>Your desk ({myLane})</label>
                <select value={channelStatus} onChange={(e) => setChannelStatus(e.target.value)}>
                  <option value="sent">sent</option>
                  <option value="acknowledged">acknowledged</option>
                  <option value="in_progress">in progress</option>
                  <option value="resolved">resolved</option>
                  <option value="no_response">no response</option>
                </select>
              </div>
            )}
            <div className="meta-item">
              <label>Coordinates</label>
              <div>
                {report.latitude?.toFixed(5)}, {report.longitude?.toFixed(5)}
              </div>
            </div>
            <div className="meta-item">
              <label>Address</label>
              <div>{report.address || '—'}</div>
            </div>
            <div className="meta-item">
              <label>Submitted</label>
              <div>{report.createdAt ? new Date(report.createdAt).toLocaleString() : '—'}</div>
            </div>
            {agency && report.user && (
              <div className="meta-item">
                <label>Reporter</label>
                <div>
                  {report.user.name}
                  <br />
                  <small>{report.user.email}</small>
                </div>
              </div>
            )}
            <div className="meta-item">
              <label>Notes</label>
              <div>{report.notes || '—'}</div>
            </div>
          </div>

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {agency && (
              <button type="button" className="accent" disabled={busy} onClick={save}>
                Save desk + status
              </button>
            )}
            {role === 'admin' && (
              <button type="button" className="danger" disabled={busy} onClick={remove}>
                Delete
              </button>
            )}
            <a
              href={`https://www.openstreetmap.org/?mlat=${report.latitude}&mlon=${report.longitude}#map=18/${report.latitude}/${report.longitude}`}
              target="_blank"
              rel="noreferrer"
            >
              <button type="button" className="secondary">
                Open in OSM
              </button>
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}
