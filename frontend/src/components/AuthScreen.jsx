import React, { useState } from 'react';
import { api } from '../api';
import TurnstileWidget from './TurnstileWidget';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';

export default function AuthScreen({ onSuccess, mode, setMode }) {
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [widgetReset, setWidgetReset] = useState(0);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!turnstileToken) {
      setError('Complete the Cloudflare security check first.');
      return;
    }
    setBusy(true);
    try {
      const path = mode === 'login' ? '/auth/login' : '/auth/register';
      const body =
        mode === 'login'
          ? { email: form.email, password: form.password, turnstileToken }
          : { ...form, turnstileToken };
      const data = await api(path, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      onSuccess(data);
    } catch (err) {
      setError(err.message);
      setTurnstileToken('');
      setWidgetReset((n) => n + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-shell">
      <aside className="auth-visual">
        <div className="brand">
          <span className="brand-mark" aria-hidden />
          Road<span>Guard</span>
        </div>
        <h1>See the crack. Flag the fix.</h1>
        <p>
          AI-assisted pothole detection with dual complaint routing to government and city road
          contractors — plus live maps and repair tracking.
        </p>
      </aside>

      <section className="auth-panel">
        <div className="auth-card">
          <h2>{mode === 'login' ? 'Sign in' : 'Create account'}</h2>
          <p>
            {mode === 'login'
              ? 'Access your dashboard and report road damage.'
              : 'Join as a citizen reporter in under a minute.'}
          </p>

          <form onSubmit={submit}>
            {mode === 'register' && (
              <div className="field">
                <label htmlFor="name">Full name</label>
                <input
                  id="name"
                  required
                  value={form.name}
                  onChange={set('name')}
                  placeholder="Alex Rivera"
                  autoComplete="name"
                />
              </div>
            )}
            <div className="field">
              <label htmlFor="email">Email</label>
              <input
                id="email"
                type="email"
                required
                value={form.email}
                onChange={set('email')}
                placeholder="you@city.gov"
                autoComplete="email"
              />
            </div>
            <div className="field">
              <label htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                required
                minLength={6}
                value={form.password}
                onChange={set('password')}
                placeholder="At least 6 characters"
                autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              />
            </div>

            <div className="field">
              <label>Cloudflare security check</label>
              <TurnstileWidget
                siteKey={SITE_KEY}
                resetKey={`${mode}-${widgetReset}`}
                onToken={setTurnstileToken}
              />
            </div>

            <button className="accent" disabled={busy}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Enter RoadGuard' : 'Create account'}
            </button>
          </form>

          {error && <div className="error-box">{error}</div>}

          <button
            type="button"
            className="linkish"
            onClick={() => {
              setMode(mode === 'login' ? 'register' : 'login');
              setError('');
              setTurnstileToken('');
            }}
          >
            {mode === 'login' ? 'Need an account? Register' : 'Already registered? Sign in'}
          </button>
        </div>
      </section>
    </div>
  );
}
