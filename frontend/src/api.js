const API = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

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
