import React, { useEffect, useState } from 'react';
import { api, authHeaders } from '../api';

const COLORS = { Pending: '#e8a317', 'In Progress': '#0ea5e9', Repaired: '#15803d', Low: '#15803d', Medium: '#e8a317', High: '#dc2626' };

function Donut({ data, total }) {
  const entries = Object.entries(data);
  const r = 52;
  const c = 2 * Math.PI * r;
  let offset = 0;
  return (
    <div className="donut-wrap">
      <svg viewBox="0 0 140 140" className="donut" role="img" aria-label="Complaints by status">
        <circle cx="70" cy="70" r={r} fill="none" stroke="var(--line)" strokeWidth="18" />
        {total > 0 &&
          entries.map(([k, v]) => {
            const len = (v / total) * c;
            const el = (
              <circle
                key={k}
                cx="70"
                cy="70"
                r={r}
                fill="none"
                stroke={COLORS[k]}
                strokeWidth="18"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 70 70)"
              />
            );
            offset += len;
            return el;
          })}
        <text x="70" y="68" textAnchor="middle" className="donut-total">{total}</text>
        <text x="70" y="86" textAnchor="middle" className="donut-label">complaints</text>
      </svg>
      <ul className="legend">
        {entries.map(([k, v]) => (
          <li key={k}><i style={{ background: COLORS[k] }} />{k}<b>{v}</b></li>
        ))}
      </ul>
    </div>
  );
}

function Bars({ data }) {
  const max = Math.max(1, ...Object.values(data));
  return (
    <div className="hbars">
      {Object.entries(data).map(([k, v]) => (
        <div key={k} className="hbar-row">
          <span>{k}</span>
          <div className="hbar-track"><div className="hbar-fill" style={{ width: `${(v / max) * 100}%`, background: COLORS[k] }} /></div>
          <b>{v}</b>
        </div>
      ))}
    </div>
  );
}

function Monthly({ months }) {
  const max = Math.max(1, ...months.flatMap((m) => [m.reported, m.resolved]));
  const H = 120;
  return (
    <div>
      <svg viewBox={`0 0 ${months.length * 60} ${H + 28}`} className="monthly" role="img" aria-label="Reported and resolved per month">
        {months.map((m, i) => {
          const x = i * 60 + 10;
          const h1 = (m.reported / max) * H;
          const h2 = (m.resolved / max) * H;
          return (
            <g key={m.label + i}>
              <rect x={x} y={H - h1} width="18" height={h1} rx="3" fill="#e8a317"><title>{`${m.label}: ${m.reported} reported`}</title></rect>
              <rect x={x + 21} y={H - h2} width="18" height={h2} rx="3" fill="#15803d"><title>{`${m.label}: ${m.resolved} resolved`}</title></rect>
              <text x={x + 20} y={H + 16} textAnchor="middle" className="axis">{m.label}</text>
              {m.reported > 0 && <text x={x + 9} y={H - h1 - 3} textAnchor="middle" className="axis">{m.reported}</text>}
              {m.resolved > 0 && <text x={x + 30} y={H - h2 - 3} textAnchor="middle" className="axis">{m.resolved}</text>}
            </g>
          );
        })}
      </svg>
      <ul className="legend inline">
        <li><i style={{ background: '#e8a317' }} />Reported</li>
        <li><i style={{ background: '#15803d' }} />Resolved</li>
      </ul>
    </div>
  );
}

function fmtRepair(hours) {
  if (hours == null) return '—';
  return hours >= 48 ? `${(hours / 24).toFixed(1)} days` : `${hours} hrs`;
}

export default function Analytics({ token, role }) {
  const [d, setD] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api('/reports/analytics', { headers: authHeaders(token, false) })
      .then(setD)
      .catch((e) => setError(e.message));
  }, [token]);

  if (error) return <div className="error-box" role="alert">{error}</div>;
  if (!d) return <div className="panel"><p className="muted-note">Loading analytics…</p></div>;

  return (
    <div className="analytics">
      <div className="stats-grid">
        <div className="stat-card"><div className="label">{role === 'user' ? 'My complaints' : 'Total complaints'}</div><div className="value">{d.total}</div></div>
        <div className="stat-card"><div className="label">Resolution rate</div><div className="value">{d.resolutionRate}%</div></div>
        <div className="stat-card"><div className="label">Avg repair time</div><div className="value small">{fmtRepair(d.avgRepairHours)}</div></div>
        <div className="stat-card"><div className="label">Avg rating</div><div className="value">{d.avgRating ?? '—'}{d.avgRating ? <small> /5 ({d.ratingCount})</small> : null}</div></div>
      </div>

      <div className="analytics-grid">
        <div className="panel">
          <div className="panel-head"><h2>Status</h2><span>All complaints</span></div>
          <Donut data={d.byStatus} total={d.total} />
        </div>
        <div className="panel">
          <div className="panel-head"><h2>Severity</h2><span>AI score + citizen confirmations</span></div>
          <Bars data={d.bySeverity} />
          <p className="muted-note">{d.duplicatesPrevented} duplicate complaint{d.duplicatesPrevented === 1 ? '' : 's'} avoided by citizen confirmations · {d.escalated} escalated</p>
        </div>
        <div className="panel wide">
          <div className="panel-head"><h2>Last 6 months</h2><span>Reported vs resolved</span></div>
          <Monthly months={d.monthly} />
        </div>
      </div>
    </div>
  );
}
