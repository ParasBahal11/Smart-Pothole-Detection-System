import React, { useEffect, useState } from 'react';
import { api } from '../api';
import TurnstileWidget from './TurnstileWidget';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';

export default function ForgotPassword({ onBack, onDone }) {
  const [step, setStep] = useState('email'); // email -> reset -> done
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [token, setToken] = useState('');
  const [widgetReset, setWidgetReset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [info, setInfo] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const requestCode = async (e) => {
    e?.preventDefault();
    setError('');
    if (!token) return setError('Complete the Cloudflare security check first.');
    setBusy(true);
    try {
      const data = await api('/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, turnstileToken: token }),
      });
      setInfo([data.message, data.devNote].filter(Boolean).join(' '));
      setCooldown(60);
      setStep('reset');
    } catch (err) {
      setError(err.message);
    } finally {
      setToken('');
      setWidgetReset((n) => n + 1);
      setBusy(false);
    }
  };

  const resetPassword = async (e) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('Passwords do not match.');
    setBusy(true);
    try {
      const data = await api('/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code, password }),
      });
      setInfo(data.message);
      setStep('done');
    } catch (err) {
      setError(err.message);
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
        <h1>Forgot your password?</h1>
        <p>We will email a 6-digit code to the address you registered with. Enter it to choose a new password.</p>
      </aside>

      <section className="auth-panel">
        <div className="auth-card">
          <h2>{step === 'done' ? 'Password changed' : 'Reset password'}</h2>

          {step === 'email' && (
            <>
              <p>Enter your registered email address.</p>
              <form onSubmit={requestCode}>
                <div className="field">
                  <label htmlFor="fp-email">Email</label>
                  <input id="fp-email" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@city.gov" />
                </div>
                <div className="field">
                  <label>Cloudflare security check</label>
                  <TurnstileWidget siteKey={SITE_KEY} resetKey={`forgot-${widgetReset}`} onToken={setToken} />
                </div>
                <button className="accent" disabled={busy}>{busy ? 'Please wait…' : 'Send reset code'}</button>
              </form>
            </>
          )}

          {step === 'reset' && (
            <>
              <p>Enter the code sent to <strong>{email}</strong> and your new password.</p>
              <form onSubmit={resetPassword}>
                <div className="field">
                  <label htmlFor="fp-code">Reset code</label>
                  <input id="fp-code" className="otp-input" inputMode="numeric" autoComplete="one-time-code" maxLength={6} required value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder="6-digit code" />
                </div>
                <div className="field">
                  <label htmlFor="fp-pass">New password</label>
                  <input id="fp-pass" type="password" required minLength={6} autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 6 characters" />
                </div>
                <div className="field">
                  <label htmlFor="fp-confirm">Confirm new password</label>
                  <input id="fp-confirm" type="password" required minLength={6} autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
                </div>
                <button className="accent" disabled={busy || code.length !== 6}>{busy ? 'Please wait…' : 'Change password'}</button>
              </form>
              <button type="button" className="linkish" disabled={cooldown > 0 || busy} onClick={() => { setStep('email'); setError(''); }}>
                {cooldown > 0 ? `Request a new code in ${cooldown}s` : 'Request a new code'}
              </button>
            </>
          )}

          {step === 'done' && (
            <button type="button" className="accent" onClick={onDone}>Go to sign in</button>
          )}

          {error && <div className="error-box" role="alert">{error}</div>}
          {info && step !== 'email' && <div className="info-box">{info}</div>}

          {step !== 'done' && (
            <button type="button" className="linkish" onClick={onBack}>Back to sign in</button>
          )}
        </div>
      </section>
    </div>
  );
}
