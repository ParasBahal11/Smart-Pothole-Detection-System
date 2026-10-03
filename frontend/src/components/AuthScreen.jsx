import React, { useEffect, useState } from 'react';
import { api } from '../api';
import TurnstileWidget from './TurnstileWidget';

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';

export default function AuthScreen({ onSuccess, mode, setMode }) {
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '', channel: 'email' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [turnstileToken, setTurnstileToken] = useState('');
  const [widgetReset, setWidgetReset] = useState(0);
  const [step, setStep] = useState('credentials');
  const [otp, setOtp] = useState('');
  const [otpDestination, setOtpDestination] = useState('');
  const [devNote, setDevNote] = useState('');
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const t = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(t);
  }, [cooldown]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (step === 'credentials') {
        if (!turnstileToken) {
          setError('Complete the Cloudflare security check first.');
          return;
        }
        const data = await api('/auth/request-otp', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...form,
            purpose: mode,
            turnstileToken,
          }),
        });
        setOtpDestination(data.destination);
        setDevNote(data.devNote || '');
        setCooldown(60);
        setOtp('');
        setTurnstileToken('');
        setStep('verification');
        return;
      }

      const data = await api('/auth/verify-otp', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: form.email, purpose: mode, code: otp }),
      });
      onSuccess(data);
    } catch (err) {
      setError(err.message);
      if (step === 'credentials') {
        setTurnstileToken('');
        setWidgetReset((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  };

  const returnToCredentials = () => {
    setStep('credentials');
    setOtp('');
    setError('');
    setDevNote('');
    setTurnstileToken('');
    setWidgetReset((n) => n + 1);
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
          <h2>
            {step === 'verification'
              ? 'Verify your account'
              : mode === 'login'
                ? 'Sign in'
                : 'Create account'}
          </h2>
          <p>
            {step === 'verification'
              ? `Enter the six-digit code sent by ${form.channel === 'email' ? 'email' : 'SMS'} to ${otpDestination}.`
              : mode === 'login'
                ? 'Access your dashboard and report road damage.'
                : 'Join as a citizen reporter in under a minute.'}
          </p>

          <form onSubmit={submit}>
            {step === 'credentials' && mode === 'register' && (
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
            {step === 'credentials' ? (
              <>
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
                {mode === 'register' && (
                  <div className="field">
                    <label htmlFor="phone">Phone number</label>
                    <input
                      id="phone"
                      type="tel"
                      required
                      value={form.phone}
                      onChange={set('phone')}
                      placeholder="+14155552671"
                      autoComplete="tel"
                    />
                  </div>
                )}
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
                  <label htmlFor="otp-channel">Send verification code by</label>
                  <select id="otp-channel" value={form.channel} onChange={set('channel')}>
                    <option value="email">Email</option>
                    <option value="sms">SMS</option>
                  </select>
                </div>
                <div className="field">
                  <label>Cloudflare security check</label>
                  <TurnstileWidget
                    siteKey={SITE_KEY}
                    resetKey={`${mode}-${widgetReset}`}
                    onToken={setTurnstileToken}
                  />
                </div>
              </>
            ) : (
              <div className="field">
                <label htmlFor="otp">Verification code</label>
                <input
                  id="otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="6-digit code"
                  className="otp-input"
                />
              </div>
            )}

            <button className="accent" disabled={busy}>
              {busy
                ? 'Please wait…'
                : step === 'verification'
                  ? 'Verify and continue'
                  : 'Send verification code'}
            </button>
          </form>

          {error && <div className="error-box" role="alert">{error}</div>}
          {step === 'verification' && devNote && <div className="info-box">{devNote}</div>}

          {step === 'verification' ? (
            <button type="button" className="linkish" onClick={returnToCredentials}>
              {cooldown > 0 ? `Back (you can request a new code in ${cooldown}s)` : 'Back to request another code'}
            </button>
          ) : (
            <button
              type="button"
              className="linkish"
              onClick={() => {
                setMode(mode === 'login' ? 'register' : 'login');
                setError('');
                setTurnstileToken('');
                setStep('credentials');
                setWidgetReset((n) => n + 1);
              }}
            >
              {mode === 'login' ? 'Need an account? Register' : 'Already registered? Sign in'}
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
