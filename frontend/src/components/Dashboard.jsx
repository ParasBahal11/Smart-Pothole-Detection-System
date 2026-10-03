import React, { useEffect, useMemo, useState } from 'react';
import { api, authHeaders, baseUrl } from '../api';

function statusClass(status) {
  return `badge status-${(status || '').toLowerCase().replace(/\s+/g, '-')}`;
}

function channelLabel(status) {
  return (status || 'queued').replace(/_/g, ' ');
}

export default function Dashboard({ reports, agency, role, token, reload, onSelect, onToast }) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('all');
  const [severity, setSeverity] = useState('all');
  const [sort, setSort] = useState('newest');
  const [feedbackSummary, setFeedbackSummary] = useState({ average: 0, count: 0, recent: [] });

  useEffect(() => {
    api('/reports/feedback/summary', { headers: authHeaders(token, false) })
      .then(setFeedbackSummary)
      .catch(() => setFeedbackSummary({ average: 0, count: 0, recent: [] }));
  }, [token, reports]);

  const counts = useMemo(() => {
    const total = reports.length || 1;
    const escalated = reports.filter((x) => (x.complaintRouting?.escalations || []).length).length;
    return {
      total: reports.length,
      pending: reports.filter((x) => x.status === 'Pending').length,
      progress: reports.filter((x) => x.status === 'In Progress').length,
      repaired: reports.filter((x) => x.status === 'Repaired').length,
      escalated,
      fill: {
        total: 100,
        pending: (reports.filter((x) => x.status === 'Pending').length / total) * 100,
        progress: (reports.filter((x) => x.status === 'In Progress').length / total) * 100,
        repaired: (reports.filter((x) => x.status === 'Repaired').length / total) * 100,
      },
    };
  }, [reports]);

  const filtered = useMemo(() => {
    let list = [...reports];
    if (status !== 'all') list = list.filter((r) => r.status === status);
    if (severity !== 'all') list = list.filter((r) => r.severity === severity);
    if (q.trim()) {
      const s = q.toLowerCase();
      list = list.filter(
        (r) =>
          r.detection?.label?.toLowerCase().includes(s) ||
          r.address?.toLowerCase().includes(s) ||
          r.notes?.toLowerCase().includes(s) ||
          r.user?.name?.toLowerCase().includes(s) ||
          r.user?.email?.toLowerCase().includes(s) ||
          String(r.latitude).includes(s) ||
          String(r.longitude).includes(s)
      );
    }
    list.sort((a, b) => {
      if (sort === 'severity') {
        const rank = { High: 3, Medium: 2, Low: 1 };
        return (rank[b.severity] || 0) - (rank[a.severity] || 0);
      }
      if (sort === 'confidence') {
        return (b.detection?.confidence || 0) - (a.detection?.confidence || 0);
      }
      return new Date(b.createdAt) - new Date(a.createdAt);
    });
    return list;
  }, [reports, q, status, severity, sort]);

  const updateStatus = async (id, next) => {
    try {
      const result = await api(`/reports/${id}/status`, {
        method: 'PATCH',
        headers: authHeaders(token),
        body: JSON.stringify({ status: next }),
      });
      onToast?.(
        result.emailNotification?.sent === false
          ? 'Status updated, but the email notification could not be sent.'
          : 'Status updated and reporter notified by email',
        result.emailNotification?.sent === false ? 'err' : 'ok'
      );
      reload();
    } catch (e) {
      onToast?.(e.message, 'err');
    }
  };

  const remove = async (id) => {
    if (!confirm('Delete this report permanently?')) return;
    try {
      await api(`/reports/${id}`, {
        method: 'DELETE',
        headers: authHeaders(token, false),
      });
      onToast?.('Report deleted');
      reload();
    } catch (e) {
      onToast?.(e.message, 'err');
    }
  };

  return (
    <>
      <div className="stats-grid">
        <div className="stat-card" style={{ '--fill': `${counts.fill.total}%`, '--bar': '#14181f' }}>
          <div className="label">Total reports</div>
          <div className="value">{counts.total}</div>
        </div>
        <div className="stat-card" style={{ '--fill': `${counts.fill.pending}%`, '--bar': '#6366f1' }}>
          <div className="label">Pending</div>
          <div className="value">{counts.pending}</div>
        </div>
        <div className="stat-card" style={{ '--fill': `${counts.fill.progress}%`, '--bar': '#e8a317' }}>
          <div className="label">In progress</div>
          <div className="value">{counts.progress}</div>
        </div>
        <div className="stat-card" style={{ '--fill': `${counts.fill.repaired}%`, '--bar': '#0f766e' }}>
          <div className="label">{counts.escalated ? `Repaired · ${counts.escalated} escalated` : 'Repaired'}</div>
          <div className="value">{counts.repaired}</div>
        </div>
      </div>

      <section className="panel community-feedback">
        <div className="panel-head">
          <h2>Community feedback</h2>
          <span>{feedbackSummary.count} resolved report reviews</span>
        </div>
        <div className="feedback-score">
          <strong>{feedbackSummary.count ? feedbackSummary.average.toFixed(1) : '—'}</strong>
          <span>/ 5 average rating</span>
        </div>
        {feedbackSummary.recent.length > 0 ? (
          <div className="feedback-list">
            {feedbackSummary.recent.slice(0, 5).map((item) => (
              <blockquote key={item._id}>
                <span aria-label={`${item.rating} out of 5 stars`}>{'★'.repeat(item.rating)}{'☆'.repeat(5 - item.rating)}</span>
                <p>{item.feedback}</p>
                {item.resolutionImageUrl && (
                  <img
                    className="feedback-work-image"
                    src={baseUrl + item.resolutionImageUrl}
                    alt="Completed road repair"
                    loading="lazy"
                  />
                )}
              </blockquote>
            ))}
          </div>
        ) : (
          <p className="feedback-empty">No reviews have been submitted yet.</p>
        )}
      </section>

      <div className="panel">
        <div className="panel-head">
          <h2>Reports</h2>
          <span>
            {role === 'admin'
              ? 'Government queue'
              : role === 'contractor'
                ? 'Contractor queue'
                : 'Your submissions'}{' '}
            · {filtered.length} shown
          </span>
        </div>

        <div className="filters">
          <input
            placeholder="Search address, notes, AI label…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All statuses</option>
            <option>Pending</option>
            <option>In Progress</option>
            <option>Repaired</option>
          </select>
          <select value={severity} onChange={(e) => setSeverity(e.target.value)}>
            <option value="all">All severity</option>
            <option>High</option>
            <option>Medium</option>
            <option>Low</option>
          </select>
          <select value={sort} onChange={(e) => setSort(e.target.value)}>
            <option value="newest">Newest first</option>
            <option value="severity">Severity</option>
            <option value="confidence">AI confidence</option>
          </select>
        </div>

        {!filtered.length ? (
          <div className="empty">
            <h3>No reports match</h3>
            <p>Try clearing filters or submit a new road image.</p>
          </div>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Image</th>
                  <th>AI</th>
                  <th>Location</th>
                  <th>Severity</th>
                  <th>Gov desk</th>
                  <th>Contractor</th>
                  <th>Status</th>
                  {agency && <th>Reporter</th>}
                  <th>When</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr key={r._id}>
                    <td>
                      {r.imageUrl ? (
                        <img
                          className="thumb"
                          src={baseUrl + r.imageUrl}
                          alt="Report"
                          onClick={() => onSelect(r)}
                        />
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="ai-cell">
                      <strong>{r.detection?.label || '—'}</strong>
                      <small>{Math.round((r.detection?.confidence || 0) * 100)}% confidence</small>
                    </td>
                    <td>
                      {r.address ? (
                        <>
                          {r.address}
                          <br />
                          <small>
                            {r.latitude?.toFixed(4)}, {r.longitude?.toFixed(4)}
                          </small>
                        </>
                      ) : (
                        `${r.latitude?.toFixed(4)}, ${r.longitude?.toFixed(4)}`
                      )}
                    </td>
                    <td>
                      <span className={`badge ${(r.severity || '').toLowerCase()}`}>{r.severity}</span>
                    </td>
                    <td>
                      <span className={`badge channel-${r.complaintRouting?.government?.status || 'queued'}`}>
                        {channelLabel(r.complaintRouting?.government?.status)}
                      </span>
                    </td>
                    <td>
                      <span className={`badge channel-${r.complaintRouting?.contractor?.status || 'queued'}`}>
                        {channelLabel(r.complaintRouting?.contractor?.status)}
                      </span>
                    </td>
                    <td>
                      <span className={statusClass(r.status)}>{r.status}</span>
                      {(r.complaintRouting?.escalations || []).length > 0 && (
                        <>
                          <br />
                          <small>Escalated</small>
                        </>
                      )}
                    </td>
                    {agency && <td>{r.user?.name || r.user?.email || '—'}</td>}
                    <td>{r.createdAt ? new Date(r.createdAt).toLocaleDateString() : '—'}</td>
                    <td>
                      <div className="row-actions">
                        {agency && (
                          <select value={r.status} onChange={(e) => updateStatus(r._id, e.target.value)}>
                            <option>Pending</option>
                            <option>In Progress</option>
                            <option>Repaired</option>
                          </select>
                        )}
                        <button type="button" className="icon-btn" onClick={() => onSelect(r)}>
                          View
                        </button>
                        {role === 'admin' && (
                          <button type="button" className="icon-btn danger" onClick={() => remove(r._id)}>
                            Del
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}
