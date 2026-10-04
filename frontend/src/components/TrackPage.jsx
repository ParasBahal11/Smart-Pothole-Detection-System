import React, { useState } from 'react';
import { api, baseUrl } from '../api';
import Timeline from './Timeline';

export default function TrackPage() {
  const [id, setId] = useState('');
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const lookup = async (e) => {
    e.preventDefault();
    setError('');
    setData(null);
    setBusy(true);
    try {
      setData(await api(`/reports/track/${encodeURIComponent(id.trim())}`));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page">
      <header className="page-head">
        <div>
          <h1>Track a complaint</h1>
          <p>Enter the tracking ID from your confirmation email (for example RG-AB12CD34). No login needed.</p>
        </div>
      </header>

      <div className="panel">
        <form className="track-form" onSubmit={lookup}>
          <input
            value={id}
            onChange={(e) => setId(e.target.value)}
            placeholder="RG-XXXXXXXX"
            aria-label="Tracking ID"
            required
            maxLength={20}
          />
          <button className="accent" disabled={busy || !id.trim()}>{busy ? 'Searching…' : 'Track'}</button>
        </form>
        {error && <div className="error-box" role="alert">{error}</div>}
      </div>

      {data && (
        <div className="panel track-result">
          <div className="panel-head">
            <h2>{data.trackingId}</h2>
            <span>Submitted {new Date(data.createdAt).toLocaleString()}</span>
          </div>
          <div className="track-badges">
            <span className={`badge status-${data.status.toLowerCase().replace(' ', '-')}`}>{data.status}</span>
            <span className={`badge ${data.severity.toLowerCase()}`}>Severity {data.severity}</span>
            {data.supportCount > 0 && <span className="badge">{data.supportCount} citizen confirmation{data.supportCount === 1 ? '' : 's'}</span>}
          </div>
          <p className="muted-note">
            {data.address || 'Location recorded'} · Government desk: <b>{(data.government || 'queued').replace(/_/g, ' ')}</b> · Contractor desk: <b>{(data.contractor || 'queued').replace(/_/g, ' ')}</b>
          </p>
          <h3 className="section-title">Progress</h3>
          <Timeline items={data.timeline} />
          {data.workImages?.length > 0 && (
            <>
              <h3 className="section-title">Work done</h3>
              <div className="before-after">
                <figure>
                  <img src={baseUrl + data.imageUrl} alt="Before repair" />
                  <figcaption>Before</figcaption>
                </figure>
                {data.workImages.map((u, i) => (
                  <figure key={u}>
                    <img src={baseUrl + u} alt={`After repair ${i + 1}`} />
                    <figcaption>After{data.workImages.length > 1 ? ` ${i + 1}` : ''}</figcaption>
                  </figure>
                ))}
              </div>
              {data.workNote && <p className="work-note"><strong>Note:</strong> {data.workNote}</p>}
            </>
          )}
        </div>
      )}
    </main>
  );
}
