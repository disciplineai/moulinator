'use client';

import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import type { components } from '@/src/api/generated/schema';
import { api, logoutRemote, tryRefresh } from '@/src/api/client';
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
  logout: () => Promise<void>;
  refreshMe: () => Promise<void>;
};

const Ctx = createContext<AuthCtx | null>(null);

function hasSessionCookie(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith('moulinator_session='));
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refreshMe = async () => {
    if (USE_MOCKS) {
      // Mocks don't need a real session; synthesize an authenticated shell and
      // set the marker cookie so middleware lets protected routes render.
      tokenStore.setTokens({ access_token: 'mock', expires_in: 3600 });
      setUser(mockUser);
      setLoading(false);
      return;
    }

    const access = tokenStore.getAccessToken();
    if (!access) {
      // Try to rehydrate via the httpOnly mou_rt cookie. If we have a session
      // marker but the refresh fails, the marker is stale and must be cleared
      // so middleware stops trusting it.
      const bootstrapped = hasSessionCookie() ? await tryRefresh() : false;
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
      logout: async () => {
        await logoutRemote();
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
