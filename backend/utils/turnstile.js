const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

export async function verifyTurnstile(token, ip) {
  const secret = process.env.TURNSTILE_SECRET_KEY;
  if (!secret) {
    throw new Error('Cloudflare Turnstile is not configured on the server');
  }
  if (!token) {
    return { ok: false, message: 'Complete the Cloudflare security check' };
  }

  const body = new URLSearchParams();
  body.set('secret', secret);
  body.set('response', token);
  if (ip) body.set('remoteip', ip);

  const resp = await fetch(VERIFY_URL, { method: 'POST', body });
  const data = await resp.json().catch(() => ({}));
  if (!data.success) {
    return { ok: false, message: 'Cloudflare verification failed. Refresh and try again.' };
  }
  return { ok: true };
}
