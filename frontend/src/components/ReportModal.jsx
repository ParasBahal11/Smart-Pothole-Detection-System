import React, { useEffect, useMemo, useState } from 'react';
import { Star } from 'lucide-react';
import { API, api, authHeaders, baseUrl } from '../api';
import Timeline from './Timeline';

function channelLabel(status) {
  return (status || 'queued').replace(/_/g, ' ');
}

export default function ReportModal({ report, agency, role, token, startEditing = false, onClose, onUpdated, onError }) {
  const [status, setStatus] = useState(report.status);
  const [editing, setEditing] = useState(startEditing);
  const [address, setAddress] = useState(report.address || '');
  const [notes, setNotes] = useState(report.notes || '');
  const [channelStatus, setChannelStatus] = useState(
    role === 'contractor'
      ? report.complaintRouting?.contractor?.status || 'sent'
      : report.complaintRouting?.government?.status || 'sent'
  );
  const [busy, setBusy] = useState(false);
  const [rating, setRating] = useState(report.rating || 0);
  const [feedback, setFeedback] = useState(report.feedback || '');
  const [workFiles, setWorkFiles] = useState([]);
  const [workNote, setWorkNote] = useState(report.workNote || '');
  const workPreviews = useMemo(() => workFiles.map((f) => URL.createObjectURL(f)), [workFiles]);
  useEffect(() => () => workPreviews.forEach((u) => URL.revokeObjectURL(u)), [workPreviews]);
  const savedWork = report.workImages || [];
  const conf = Math.round((report.detection?.confidence || 0) * 100);
  const myLane = role === 'contractor' ? 'City road contractor' : 'Government';


  const pickWork = (e) => {
    const picked = Array.from(e.target.files || []).filter((f) => /^image\/(jpeg|png|jpg|webp)$/i.test(f.type));
    if (picked.length < (e.target.files || []).length) onError?.('Only JPG, PNG or WebP photos are allowed.');
    setWorkFiles((prev) => [...prev, ...picked].slice(0, Math.max(0, 6 - savedWork.length)));
    e.target.value = '';
  };

  const save = async () => {
    if (!agency) return onClose();
    const wantsRepaired = status === 'Repaired' || channelStatus === 'resolved';
    if (wantsRepaired && !savedWork.length && !workFiles.length) {
      onError?.('Add at least one photo of the completed work before marking this as Repaired.');
      return;
    }
    setBusy(true);
    try {
      if (workFiles.length || (workNote.trim() && workNote.trim() !== (report.workNote || ''))) {
        if (workFiles.length) {
          const fd = new FormData();
          workFiles.forEach((f) => fd.append('images', f));
          if (workNote.trim()) fd.append('note', workNote.trim());
          const res = await fetch(`${API}/reports/${report._id}/work-images`, {
            method: 'POST',
            headers: authHeaders(token, false),
            body: fd,
          });
          const data = await res.json().catch(() => ({}));
          if (!res.ok) throw new Error(data.message || `Photo upload failed (${res.status})`);
        }
      }
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

  const saveDetails = async () => {
    setBusy(true);
    try {
      await api(`/reports/${report._id}`, {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({ address, notes }),
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
          {report.trackingId && (
            <p style={{ margin: 0 }}>
              Tracking ID: <code className="tracking-id">{report.trackingId}</code>
            </p>
          )}
          <p style={{ margin: 0, color: 'var(--muted)' }}>
            {conf}% AI confidence · Severity {report.severity}
            {report.severityScore != null ? ` (score ${report.severityScore}/100)` : ''}
            {report.complaintRouting?.dispatched ? ' · Dual-desk complaint' : ''}
          </p>
          {report.severityScore != null && (
            <p className="muted-note" style={{ margin: 0 }}>
              Severity score = AI confidence ({Math.round(conf * 0.7)} pts) + citizen confirmations ({Math.min(report.supportCount || 0, 5) * 6} pts, {report.supportCount || 0} confirmed).
            </p>
          )}

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
              {editing ? (
                <input value={address} maxLength={300} onChange={(e) => setAddress(e.target.value)} />
              ) : (
                <div>{report.address || '—'}</div>
              )}
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
              {editing ? (
                <textarea value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} />
              ) : (
                <div>{report.notes || '—'}</div>
              )}
            </div>
          </div>

          <section className="timeline-section" aria-labelledby="timeline-heading">
            <h3 id="timeline-heading">Status timeline</h3>
            <Timeline items={report.timeline} />
          </section>

          {(savedWork.length > 0 || agency) && (
            <section className="work-done" aria-labelledby="work-heading">
              <h3 id="work-heading">Work done</h3>
              {savedWork.length > 0 ? (
                <div className="before-after">
                  <figure>
                    <a href={baseUrl + report.imageUrl} target="_blank" rel="noreferrer">
                      <img src={baseUrl + report.imageUrl} alt="Before repair" />
                    </a>
                    <figcaption>Before</figcaption>
                  </figure>
                  {savedWork.map((url, i) => (
                    <figure key={url}>
                      <a href={baseUrl + url} target="_blank" rel="noreferrer">
                        <img src={baseUrl + url} alt={`Work done ${i + 1}`} />
                      </a>
                      <figcaption>After{savedWork.length > 1 ? ` ${i + 1}` : ''}</figcaption>
                    </figure>
                  ))}
                </div>
              ) : (
                <p className="muted-note">No photos of completed work uploaded yet.</p>
              )}
              {report.workNote && <p className="work-note"><strong>Note:</strong> {report.workNote}</p>}
              {report.completedAt && (
                <small className="muted-note">Completed on {new Date(report.completedAt).toLocaleDateString()}</small>
              )}

              {agency && (
                <div className="work-upload">
                  <label htmlFor="work-files">Upload photos of completed work (required to mark Repaired)</label>
                  <input id="work-files" type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={pickWork} />
                  {workPreviews.length > 0 && (
                    <div className="work-previews">
                      {workPreviews.map((u, i) => (
                        <div key={u} className="work-preview">
                          <img src={u} alt={`New work photo ${i + 1}`} />
                          <button type="button" aria-label="Remove photo" onClick={() => setWorkFiles((f) => f.filter((_, j) => j !== i))}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                  <textarea
                    value={workNote}
                    maxLength={1000}
                    onChange={(e) => setWorkNote(e.target.value)}
                    placeholder="Short note about the work done (optional)…"
                  />
                  <small className="muted-note">Max 6 photos, 5 MB each. Photos are emailed to the citizen when you mark it Repaired.</small>
                </div>
              )}
            </section>
          )}

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
            {role === 'user' && report.status === 'Pending' && !editing && (
              <button type="button" className="secondary" onClick={() => setEditing(true)}>
                Edit details
              </button>
            )}
            {role === 'user' && editing && (
              <>
                <button type="button" className="accent" disabled={busy} onClick={saveDetails}>
                  Save changes
                </button>
                <button type="button" className="secondary" disabled={busy} onClick={() => setEditing(false)}>
                  Cancel
                </button>
              </>
            )}
            {agency && (
              <button type="button" className="accent" disabled={busy} onClick={save}>
                Save desk + status
              </button>
            )}
            {(role === 'admin' || role === 'user') && (
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
