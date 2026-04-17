import createClient, { type Middleware } from 'openapi-fetch';
import type { paths } from './generated/schema';
import { tokenStore } from '@/src/auth/token-store';

// On the server we hit the API directly. In the browser, if a same-origin
// NEXT_PUBLIC_API_URL wasn't baked in at build time, we go through the Next
// rewrite at `/api/proxy/*` configured in next.config.js — that way a single
// server-side PUBLIC_API_URL is enough for both sides.
const API_BASE =
  typeof window === 'undefined'
    ? process.env.NEXT_PUBLIC_API_URL || process.env.PUBLIC_API_URL || 'http://localhost:3001'
    : process.env.NEXT_PUBLIC_API_URL || '/api/proxy';

// credentials: 'include' so the httpOnly mou_rt cookie is attached/received on
// /auth/* requests when the API is served cross-origin. Same-origin is fine too.
const raw = createClient<paths>({ baseUrl: API_BASE, credentials: 'include' });

let refreshInFlight: Promise<boolean> | null = null;

export async function tryRefresh(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = (async () => {
    try {
      // No body: the refresh token rides on the httpOnly `mou_rt` cookie.
      // X-Moulinator-Refresh is a CSRF-lite header: browsers do not attach it
      // on cross-origin simple requests, so drive-by refresh is blocked.
      const res = await fetch(`${API_BASE}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'X-Moulinator-Refresh': '1' },
      });
      if (!res.ok) return false;
      const body = (await res.json()) as {
        access_token: string;
        expires_in: number;
      };
      if (!body?.access_token) return false;
      tokenStore.setTokens(body);
      return true;
    } catch {
      return false;
    } finally {
      refreshInFlight = null;
    }
  })();
  return refreshInFlight;
}

export async function logoutRemote(): Promise<void> {
  try {
    await fetch(`${API_BASE}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch {
    // /auth/logout is idempotent; swallow network errors.
  }
}

const authMiddleware: Middleware = {
  async onRequest({ request }) {
    const token = tokenStore.getAccessToken();
    if (token && !request.headers.has('authorization')) {
      request.headers.set('authorization', `Bearer ${token}`);
    }
    return request;
  },
  async onResponse({ request, response }) {
    if (response.status !== 401) return response;
    if (request.url.includes('/auth/')) return response;
    const ok = await tryRefresh();
    if (!ok) {
      tokenStore.clear();
      if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
      return response;
    }
    const retry = new Request(request, {
      headers: new Headers(request.headers),
    });
    const token = tokenStore.getAccessToken();
    if (token) retry.headers.set('authorization', `Bearer ${token}`);
    return fetch(retry);
  },
};

raw.use(authMiddleware);

export const api = raw;
export { API_BASE };

export type ApiError = {
  error: string;
  message?: string;
  details?: Record<string, unknown>;
};

export function asApiError(err: unknown): ApiError | null {
  if (!err || typeof err !== 'object') return null;
  if ('error' in err && typeof (err as { error: unknown }).error === 'string') {
    return err as ApiError;
  }
  return null;
}

export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  const api = asApiError(err);
  if (api) return api.message || humanizeCode(api.error) || fallback;
  if (err instanceof Error) return err.message;
  return fallback;
}

function humanizeCode(code: string): string {
  return code.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}
