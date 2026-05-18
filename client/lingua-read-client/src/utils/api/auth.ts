// Auth uses bare fetch (not the internal fetchApi helper) because callers in
// store.js consume the raw Response — they check `res.ok`, sometimes parse
// JSON, and need to react to specific status codes.

import { API_URL } from './client';

export type AuthUser = {
  username?: string;
  [key: string]: unknown;
};

// Shape returned by GET /auth/status. Swagger marks the response body as
// opaque (no schema) — these fields are inferred from store.js call sites.
export type AuthStatus = {
  authenticated: boolean;
  needsSetup?: boolean;
  user?: AuthUser | null;
};

export const authStatus = async (): Promise<AuthStatus> => {
  const res = await fetch(API_URL + '/auth/status', {
    credentials: 'include',
    headers: { Accept: 'application/json' }
  });
  if (!res.ok) throw new Error('Failed to check auth status');
  return res.json();
};

export const authLogin = (password: string): Promise<Response> => {
  return fetch(API_URL + '/auth/login', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: JSON.stringify({ password })
  });
};

export const authLogout = (): Promise<Response> => {
  return fetch(API_URL + '/auth/logout', {
    method: 'POST',
    credentials: 'include',
    headers: { 'X-Requested-With': 'XMLHttpRequest' }
  });
};

export const authSetup = (password: string): Promise<Response> => {
  return fetch(API_URL + '/auth/setup', {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      'X-Requested-With': 'XMLHttpRequest'
    },
    body: JSON.stringify({ password })
  });
};
