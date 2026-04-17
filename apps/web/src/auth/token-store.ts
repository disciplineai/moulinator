/**
 * In-memory access token + refresh token in httpOnly-friendly fallback.
 * Per CLAUDE.md: never store PATs or JWTs in localStorage. For MVP we keep
 * access in memory; refresh token is passed to the backend which is expected
 * to set it as an httpOnly cookie. When a browser reload happens and we only
 * have the cookie, the backend rotates a new access token via /auth/refresh.
 */

export type AuthTokens = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
};

type Listener = (t: AuthTokens | null) => void;

let state: AuthTokens | null = null;
const listeners = new Set<Listener>();

function emit() {
  for (const l of listeners) l(state);
}

export const tokenStore = {
  setTokens(tokens: AuthTokens) {
    state = tokens;
    emit();
    if (typeof document !== 'undefined') {
      // Session-scoped marker (no max-age): clears when the browser closes, so
      // edge middleware does not keep granting access once the in-memory token
      // is gone. Production sets the real refresh token as httpOnly on the
      // backend; this cookie is only a client-side signal.
      document.cookie = 'moulinator_session=1; path=/; samesite=lax';
    }
  },
  clear() {
    state = null;
    emit();
    if (typeof document !== 'undefined') {
      document.cookie = 'moulinator_session=; path=/; max-age=0';
    }
  },
  getAccessToken() {
    return state?.access_token ?? null;
  },
  getRefreshToken() {
    return state?.refresh_token ?? null;
  },
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
