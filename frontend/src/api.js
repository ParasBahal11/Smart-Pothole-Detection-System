const API = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

export const baseUrl = API.replace(/\/api\/?$/, '');

export function authHeaders(token, json = true) {
  const h = { Authorization: `Bearer ${token}` };
  if (json) h['Content-Type'] = 'application/json';
  return h;
}

export async function api(path, options = {}) {
  const res = await fetch(API + path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.message || `Request failed (${res.status})`);
  return data;
}

export { API };
