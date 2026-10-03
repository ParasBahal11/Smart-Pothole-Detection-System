const configuredApi = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';
const isLocalFrontend =
  typeof window !== 'undefined' &&
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1');
const API = isLocalFrontend ? '/api' : configuredApi;

export const baseUrl = API.replace(/\/api\/?$/, '');

export function authHeaders(token, json = true) {
  const h = { Authorization: `Bearer ${token}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

export async function api(path, options = {}) {
  let res;
  try {
    res = await fetch(API + path, options);
  } catch {
    throw new Error('Cannot reach the server. Make sure the backend is running and VITE_API_URL is correct.');
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const base = data.message || `Request failed (${res.status})`;
    throw new Error(data.detail ? `${base} (${data.detail})` : base);
  }
  return data;
}

export { API };
