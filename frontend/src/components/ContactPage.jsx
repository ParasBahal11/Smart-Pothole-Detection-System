import React, { useEffect, useState } from 'react';
import { api } from '../api';

export default function ContactPage({ user, onToast }) {
  const [info, setInfo] = useState({ email: '', phone: '', hours: '', address: '' });
  const [form, setForm] = useState({ name: user?.name || '', email: user?.email || '', subject: '', message: '', website: '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState('');

  useEffect(() => {
    api('/contact/info').then(setInfo).catch(() => {});
  }, []);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setSent('');
    setBusy(true);
    try {
      const data = await api('/contact', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      setSent(data.message);
      onToast?.('Message sent');
      setForm((f) => ({ ...f, subject: '', message: '' }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="page static-page">
      <header className="page-head">
        <div>
          <h1>Contact us</h1>
          <p>Questions, a problem with your complaint, or feedback about the app — write to us.</p>
        </div>
      </header>

      <div className="contact-grid">
        <section className="panel">
          <div className="panel-head"><h2>Send a message</h2></div>
          <form className="form-stack" onSubmit={submit}>
            <div className="field">
              <label htmlFor="c-name">Your name</label>
              <input id="c-name" required value={form.name} onChange={set('name')} autoComplete="name" />
            </div>
            <div className="field">
              <label htmlFor="c-email">Email</label>
              <input id="c-email" type="email" required value={form.email} onChange={set('email')} autoComplete="email" />
            </div>
            <div className="field">
              <label htmlFor="c-subject">Subject (optional)</label>
              <input id="c-subject" value={form.subject} onChange={set('subject')} maxLength={200} />
            </div>
            <div className="field">
              <label htmlFor="c-message">Message</label>
              <textarea id="c-message" required minLength={10} maxLength={3000} value={form.message} onChange={set('message')} placeholder="Tell us how we can help…" />
            </div>
            {/* honeypot for bots */}
            <input className="hp-field" tabIndex={-1} autoComplete="off" aria-hidden="true" value={form.website} onChange={set('website')} name="website" />
            <button className="accent" disabled={busy}>{busy ? 'Sending…' : 'Send message'}</button>
            {error && <div className="error-box" role="alert">{error}</div>}
            {sent && <div className="info-box" role="status">{sent}</div>}
          </form>
        </section>

        <aside className="hint-card">
          <div className="stripe" aria-hidden />
          <h3>Reach us directly</h3>
          <ul className="contact-list">
            {info.email && <li><span>Email</span><a href={`mailto:${info.email}`}>{info.email}</a></li>}
            {info.phone && <li><span>Phone</span><a href={`tel:${info.phone}`}>{info.phone}</a></li>}
            {info.hours && <li><span>Hours</span>{info.hours}</li>}
            {info.address && <li><span>Address</span>{info.address}</li>}
            {!info.email && !info.phone && <li>Use the form and we will reply by email.</li>}
          </ul>
          <p>We usually reply within one working day.</p>
        </aside>
      </div>
    </main>
  );
}
