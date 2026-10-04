import React from 'react';

const ICON = {
  submitted: '📝',
  dispatched: '📨',
  desk: '🏢',
  status: '🔧',
  escalated: '⏫',
  support: '👥',
  severity: '⚠️',
  work: '📷',
  feedback: '⭐',
};

export default function Timeline({ items = [] }) {
  if (!items.length) return <p className="muted-note">No activity yet.</p>;
  return (
    <ol className="timeline">
      {items.map((e, i) => (
        <li key={`${e.type}-${e.at}-${i}`} className={`timeline-item ${e.type || ''}`}>
          <span className="timeline-dot" aria-hidden>{ICON[e.type] || '•'}</span>
          <div>
            <strong>{e.title}</strong>
            {e.detail && <div className="timeline-detail">{e.detail}</div>}
            <small>
              {e.at ? new Date(e.at).toLocaleString() : ''}
              {e.by ? ` · ${e.by}` : ''}
            </small>
          </div>
        </li>
      ))}
    </ol>
  );
}
