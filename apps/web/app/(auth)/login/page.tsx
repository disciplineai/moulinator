'use client';

import { useState, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { api, errorMessage } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthProvider';
import type { components } from '@/src/api/generated/schema';

type Tokens = components['schemas']['AuthTokens'];

function safeNext(raw: string | null): string {
  if (!raw) return '/dashboard';
  // Only accept same-origin absolute paths. Reject protocol-relative (//evil.com),
  // schemes (javascript:, http://...), and anything that doesn't start with a single "/".
  if (!raw.startsWith('/') || raw.startsWith('//') || raw.startsWith('/\\')) return '/dashboard';
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const search = useSearchParams();
  const next = safeNext(search.get('next'));
  const { setTokens } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const secure =
    typeof window === 'undefined' ||
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const { data, error } = await api.POST('/auth/login', {
        body: { email, password },
      });
      if (error) throw error;
      setTokens(data as Tokens);
      router.push(next);
    } catch (e) {
      setErr(errorMessage(e, 'Invalid email or password.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-[440px]">
      <div className="eyebrow text-ember">— welcome back</div>
      <h1 className="mt-3 font-display text-3xl font-medium text-ink text-balance">
        Sign in to pick up where you left off.
      </h1>
      <p className="mt-3 font-mono text-sm text-ink-400">
        Moulinator has no password recovery yet. Lost access? Contact a moderator.
      </p>

      {!secure && (
        <div role="alert" className="mt-6 border-l-2 border-rust px-4 py-3 font-mono text-xs text-rust">
          ▲ this page is not served over HTTPS. Your password would be sent in the clear.
        </div>
      )}

      <form onSubmit={onSubmit} className="mt-8 flex flex-col gap-5" noValidate>
        <Input
          label="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <Input
          label="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {err && (
          <div role="alert" className="border-l-2 border-rust px-4 py-2 font-mono text-xs text-rust">
            — {err}
          </div>
        )}

        <div className="mt-2 flex items-center gap-4">
          <Button type="submit" loading={submitting}>
            sign in ▸
          </Button>
          <Link href="/signup" className="eyebrow text-ink-400 hover:text-ember">
            need an account →
          </Link>
        </div>
      </form>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
