import React, { useRef, useState } from 'react';
import { API, api, authHeaders, baseUrl } from '../api';

export default function ReportForm({ token, onDone, onError }) {
  const [file, setFile] = useState(null);
  const [preview, setPreview] = useState('');
  const [loc, setLoc] = useState(null);
  const [address, setAddress] = useState('');
  const [notes, setNotes] = useState('');
  const [drag, setDrag] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState('');
  const [dupes, setDupes] = useState(null);
  const camRef = useRef(null);

  const pickFile = (f) => {
    if (!f) return;
    if (!/^image\/(jpeg|png|jpg|webp)$/i.test(f.type)) {
      onError?.('Use JPG, PNG, or WebP images only.');
      return;
    }
    if (preview) URL.revokeObjectURL(preview);
    setFile(f);
    setPreview(URL.createObjectURL(f));
    setMsg('');
  };

  const getLoc = () => {
    if (!navigator.geolocation) return onError?.('Geolocation not supported on this device.');
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLoc({ latitude: p.coords.latitude, longitude: p.coords.longitude });
        setMsg('Location captured.');
      },
      () => onError?.('Location permission is required to submit a report.'),
      { enableHighAccuracy: true, timeout: 12000 }
    );
  };

  const supportExisting = async (id) => {
    setBusy(true);
    try {
      await api(`/reports/${id}/support`, { method: 'POST', headers: authHeaders(token, false) });
      setDupes(null);
      setMsg('Thanks! Your confirmation was added to the existing complaint, no duplicate was created.');
      setTimeout(() => onDone({ supported: true }), 900);
    } catch (err) {
      onError?.(err.message);
    } finally {
      setBusy(false);
    }
  };

  const submit = async (e, confirmNew = false) => {
    e?.preventDefault();
    if (!file || !loc) {
      setMsg('Add a road image and capture your location first.');
      return;
    }
    setBusy(true);
    setMsg('Uploading and checking your image with AI… The first request may take longer while the AI service starts.');
    try {
      const fd = new FormData();
      fd.append('image', file);
      fd.append('latitude', loc.latitude);
      fd.append('longitude', loc.longitude);
      if (address.trim()) fd.append('address', address.trim());
      if (notes.trim()) fd.append('notes', notes.trim());
      if (confirmNew) fd.append('confirmNew', 'true');

      const res = await fetch(`${API}/reports`, {
        method: 'POST',
        headers: authHeaders(token, false),
        body: fd,
        signal: AbortSignal.timeout(180_000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 409 && data.duplicate) {
        // Same pothole already reported nearby: let the citizen support it instead of duplicating
        setDupes(data.nearby || []);
        setMsg('');
        return;
      }
      if (!res.ok) throw new Error(data.message || `Submit failed (${res.status})`);
      setDupes(null);

      const label = data.detection?.label || 'unknown';
      const conf = Math.round((data.detection?.confidence || 0) * 100);
      const routed = data.complaintRouting?.dispatched
        ? ' Complaint dispatched separately to Government and City Road Contractor.'
        : '';
      setMsg(`Done — AI: ${label} (${conf}%). Severity: ${data.severity}.${routed}`);
      setTimeout(() => onDone(data), 900);
    } catch (err) {
      setMsg('');
      onError?.(
        err.name === 'TimeoutError' || err.name === 'AbortError'
          ? 'Report submission timed out. Check the AI service /health and try again.'
          : err.message
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="report-layout">
      <div className="panel">
        <div className="panel-head">
          <h2>Report a pothole</h2>
          <span>Photo + GPS → AI → dual complaint desks</span>
        </div>

        <form className="form-stack" onSubmit={submit}>
          {!preview ? (
            <div
              className={`dropzone ${drag ? 'drag' : ''}`}
              onDragOver={(e) => {
                e.preventDefault();
                setDrag(true);
              }}
              onDragLeave={() => setDrag(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDrag(false);
                pickFile(e.dataTransfer.files?.[0]);
              }}
            >
              <strong>Drop a road photo here</strong>
              <p>or click to browse · JPG / PNG / WebP · max 5MB</p>
              <input
                type="file"
                accept="image/jpeg,image/png,image/jpg,image/webp"
                onChange={(e) => pickFile(e.target.files?.[0])}
              />
            </div>
          ) : (
            <div>
              <div className="preview-wrap">
                <img src={preview} alt="Selected road" />
              </div>
              <div className="preview-actions">
                <button type="button" className="secondary" onClick={() => { setFile(null); setPreview(''); }}>
                  Change image
                </button>
              </div>
            </div>
          )}

          <div className="preview-actions">
            <button
              type="button"
              className="ghost"
              onClick={() => camRef.current?.click()}
            >
              Use camera
            </button>
            <input
              ref={camRef}
              type="file"
              accept="image/*"
              capture="environment"
              hidden
              onChange={(e) => pickFile(e.target.files?.[0])}
            />
          </div>

          <div className="loc-box">
            <div>
              <strong>GPS location</strong>
              <div>
                {loc ? (
                  <code>
                    {loc.latitude.toFixed(5)}, {loc.longitude.toFixed(5)}
                  </code>
                ) : (
                  <span style={{ color: 'var(--muted)' }}>Not captured yet</span>
                )}
              </div>
            </div>
            <button type="button" className="secondary" onClick={getLoc}>
              {loc ? 'Refresh GPS' : 'Capture GPS'}
            </button>
          </div>

          <div className="field">
            <label htmlFor="address">Landmark / address (optional)</label>
            <input
              id="address"
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Near City Mall, Ring Road"
            />
          </div>

          <div className="field">
            <label htmlFor="notes">Notes (optional)</label>
            <textarea
              id="notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Depth, traffic risk, nearby school…"
            />
          </div>

          {dupes && dupes.length > 0 && (
            <div className="dup-box" role="alert">
              <strong>This pothole may already be reported</strong>
              <p>A complaint exists within a few metres of your location. Support it instead of creating a duplicate; more confirmations raise its priority.</p>
              {dupes.map((d) => (
                <div key={d.id} className="dup-item">
                  {d.imageUrl && <img src={baseUrl + d.imageUrl} alt="Existing complaint" />}
                  <div>
                    <b>{d.trackingId || 'Complaint'}</b> · {d.distance} m away
                    <div className="muted-note">
                      {d.address || 'No address'} · {d.status} · Severity {d.severity} · {d.supportCount} confirmation{d.supportCount === 1 ? '' : 's'}
                    </div>
                    {d.mine ? (
                      <small className="muted-note">This is your own complaint.</small>
                    ) : d.alreadySupported ? (
                      <small className="muted-note">You already supported this one.</small>
                    ) : (
                      <button type="button" className="accent" disabled={busy} onClick={() => supportExisting(d.id)}>
                        Yes, same pothole — support it
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <div className="preview-actions">
                <button type="button" className="secondary" disabled={busy} onClick={(e) => submit(e, true)}>
                  It is a different pothole — submit new
                </button>
                <button type="button" className="ghost" disabled={busy} onClick={() => setDupes(null)}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          <button className="accent" disabled={busy}>
            {busy ? 'Analyzing…' : 'Analyze & submit'}
          </button>
          {msg && <div className="info-box">{msg}</div>}
        </form>
      </div>

      <aside className="hint-card">
        <div className="stripe" aria-hidden />
        <h3>Better detections</h3>
        <ol>
          <li>Shoot from standing height, daylight preferred.</li>
          <li>Keep the damaged asphalt centered in frame.</li>
          <li>Allow location so crews can find the spot.</li>
          <li>Add a landmark if GPS is noisy under trees.</li>
          <li>Confirmed potholes go to government and the city contractor. If one desk stays silent, the other is escalated.</li>
        </ol>
      </aside>
    </div>
  );
}
