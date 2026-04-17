'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { components } from '@/src/api/generated/schema';
import { api, API_BASE } from '@/src/api/client';
import { tokenStore, type AuthTokens } from './token-store';
import { USE_MOCKS, mockUser } from '@/src/api/mocks';

type User = components['schemas']['User'];

type AuthState = {
  user: User | null;
  loading: boolean;
  error: string | null;
};

type AuthCtx = AuthState & {
  setTokens: (t: AuthTokens) => void;
  logout: () => void;
  refreshMe: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

function hasSessionCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith('moulinator_session='));
}

async function tryBootstrapSession(): Promise<boolean> {
  // If the session marker cookie is present but we have no in-memory token
  // (typical after a page reload), attempt a refresh — production backend is
  // expected to set a refresh token as an httpOnly cookie. If that fails, the
  // marker cookie is stale and must be cleared so middleware stops trusting it.
  if (!hasSessionCookie()) return false;
  try {
    const res = await fetch(`${API_BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ refresh_token: '' }),
    });
    if (!res.ok) return false;
    const body = (await res.json()) as AuthTokens;
    if (!body?.access_token) return false;
    tokenStore.setTokens(body);
    return true;
  } catch {
    return false;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshMe = async () => {
    if (USE_MOCKS) {
      // Mocks don't need a real session; synthesize an authenticated shell and
      // set the marker cookie so middleware lets protected routes render.
      tokenStore.setTokens({ access_token: 'mock', refresh_token: 'mock', expires_in: 3600 });
      setUser(mockUser);
      setLoading(false);
      return;
    }

    const access = tokenStore.getAccessToken();
    if (!access) {
      const bootstrapped = await tryBootstrapSession();
      if (!bootstrapped) {
        tokenStore.clear();
        setUser(null);
        setLoading(false);
        return;
      }
    }
    try {
      const { data, error: e } = await api.GET('/me');
      if (e) {
        setError('Session expired');
        tokenStore.clear();
        setUser(null);
      } else if (data) {
        setUser(data as User);
      }
    } catch {
      tokenStore.clear();
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refreshMe();
    const unsub = tokenStore.subscribe((t) => {
      if (!t) {
        setUser(null);
      } else {
        refreshMe();
      }
    });
    return () => {
      unsub();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      user,
      loading,
      error,
      setTokens: (t) => tokenStore.setTokens(t),
      logout: () => {
        tokenStore.clear();
        setUser(null);
      },
      refreshMe,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [user, loading, error],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
