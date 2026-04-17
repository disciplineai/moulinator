/**
 * Access token lives in memory only. The refresh token is delivered by the
 * backend as an httpOnly `mou_rt` cookie (scope path=/auth) and the browser
 * attaches it automatically to /auth/refresh + /auth/logout when we call with
 * `credentials: 'include'`. JS cannot read it — that's the whole point.
 *
 * Per CLAUDE.md: never store PATs or JWTs in localStorage.
 */

export type AuthTokens = {
  access_token: string;
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
      // Session-scoped marker so edge middleware can gate protected routes
      // without reading the httpOnly refresh cookie. Clears on browser close;
      // AuthProvider also clears it on refresh failure.
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
  subscribe(fn: Listener) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
};
