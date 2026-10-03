import React, { useState } from 'react';
import { Star } from 'lucide-react';
import { api, authHeaders, baseUrl } from '../api';

function channelLabel(status) {
  return (status || 'queued').replace(/_/g, ' ');
}

export default function ReportModal({ report, agency, role, token, onClose, onUpdated, onStatusUpdated, onError }) {
  const [status, setStatus] = useState(report.status);
  const [channelStatus, setChannelStatus] = useState(
    role === 'contractor'
      ? report.complaintRouting?.contractor?.status || 'sent'
      : report.complaintRouting?.government?.status || 'sent'
  );
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(report.rating || 0);
  const [feedback, setFeedback] = useState(report.feedback || '');
  const [completionImage, setCompletionImage] = useState(null);
  const conf = Math.round((report.detection?.confidence || 0) * 100);
  const myLane = role === 'contractor' ? 'City road contractor' : 'Government';

  const save = async () => {
    if (!agency) return onClose();
    if (completionImage && status !== 'Repaired') {
      onError?.('Mark the report as repaired before uploading its completion photo.');
      return;
    }
    setBusy(true);
    try {
      const statusResult = await api(`/reports/${report._id}/status`, {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({ status }),
      });
      const channelResult = await api(`/reports/${report._id}/channel`, {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({ status: channelStatus }),
      });
      if (completionImage) {
        const form = new FormData();
        form.append('image', completionImage);
        await api(`/reports/${report._id}/completion-image`, {
          method: 'PATCH',
          headers: authHeaders(token, false),
          body: form,
        });
      }
      const notification = channelResult.emailNotification || statusResult.emailNotification;
      if (notification) onStatusUpdated?.({ emailNotification: notification });
      else onUpdated();
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

  const saveFeedback = async () => {
    setBusy(true);
    try {
      await api(`/reports/${report._id}/feedback`, {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({ rating, feedback }),
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
        {report.resolutionImageUrl && (
          <div className="completion-photo">
            <h3>Repair completed</h3>
            <img src={baseUrl + report.resolutionImageUrl} alt="Completed pothole repair" />
          </div>
        )}
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
            {agency && status === 'Repaired' && (
              <div className="meta-item">
                <label htmlFor="completion-image">Repair completion photo</label>
                <input
                  id="completion-image"
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  onChange={(event) => {
                    const file = event.target.files?.[0];
                    if (!file) return setCompletionImage(null);
                    if (!/^image\/(jpeg|png|webp)$/i.test(file.type) || file.size > 5 * 1024 * 1024) {
                      event.target.value = '';
                      setCompletionImage(null);
                      onError?.('Choose a JPG, PNG, or WebP repair photo under 5 MB.');
                      return;
                    }
                    setCompletionImage(file);
                  }}
                />
                <small>{completionImage?.name || 'Optional · JPG, PNG, or WebP · max 5 MB'}</small>
              </div>
            )}
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

          {role === 'user' && report.status === 'Repaired' && (
            <section className="report-feedback" aria-labelledby="review-heading">
              <h3 id="review-heading">Your repair experience</h3>
              <div className="rating-stars" role="group" aria-label="Rate your repair experience">
                {[1, 2, 3, 4, 5].map((value) => (
                  <button
                    key={value}
                    type="button"
                    className={`rating-star ${value <= rating ? 'selected' : ''}`}
                    aria-label={`${value} star${value === 1 ? '' : 's'}`}
                    aria-pressed={rating === value}
                    onClick={() => setRating(value)}
                  >
                    <Star size={22} fill={value <= rating ? 'currentColor' : 'none'} />
                  </button>
                ))}
              </div>
              <label className="sr-only" htmlFor="report-feedback">Your feedback</label>
              <textarea
                id="report-feedback"
                maxLength={2000}
                placeholder="Share what went well or what could be better..."
                value={feedback}
                onChange={(event) => setFeedback(event.target.value)}
              />
              <button type="button" className="accent" disabled={busy || !rating || !feedback.trim()} onClick={saveFeedback}>
                {report.rating ? 'Update feedback' : 'Submit feedback'}
              </button>
            </section>
          )}

          {report.rating && (
            <section className="report-feedback-display">
              <strong>{report.rating}/5 community rating</strong>
              <p>{report.feedback}</p>
            </section>
          )}

          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {agency && (
              <button type="button" className="accent" disabled={busy} onClick={save}>
                Save desk, status & photo
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
