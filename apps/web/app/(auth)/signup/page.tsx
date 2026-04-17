'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { api, errorMessage } from '@/src/api/client';
import { useAuth } from '@/src/auth/AuthProvider';
import type { components } from '@/src/api/generated/schema';

type Tokens = components['schemas']['AuthTokens'];

function scorePassword(pw: string): { score: 0 | 1 | 2 | 3 | 4; hint: string } {
  if (!pw) return { score: 0, hint: 'at least 10 characters' };
  if (pw.length < 10) return { score: 1, hint: `${10 - pw.length} characters to go` };
  let score = 2;
  if (/[A-Z]/.test(pw) && /[a-z]/.test(pw)) score++;
  if (/\d/.test(pw) && /[^A-Za-z0-9]/.test(pw)) score++;
  const labels: Record<number, string> = {
    2: 'length met — mix case + digits for more',
    3: 'solid — add a symbol for maximum',
    4: 'strong',
  };
  return { score: score as 0 | 1 | 2 | 3 | 4, hint: labels[score] ?? '' };
}

export default function SignupPage() {
  const router = useRouter();
  const { setTokens } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const strength = useMemo(() => scorePassword(password), [password]);
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
      const { data, error } = await api.POST('/auth/signup', {
        body: { email, password },
      });
      if (error) throw error;
      setTokens(data as Tokens);
      router.push('/dashboard');
    } catch (e) {
      setErr(errorMessage(e, 'Signup failed.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-[440px]">
      <div className="eyebrow text-ember">— new account</div>
      <h1 className="mt-3 font-display text-3xl font-medium text-ink text-balance">
        Make an account. Ten seconds.
      </h1>
      <p className="mt-3 max-w-[44ch] font-mono text-sm text-ink-400">
        Email and password only. No email verification in this MVP — pick one you control.
      </p>

      {!secure && (
        <div
          role="alert"
          className="mt-6 border-l-2 border-rust px-4 py-3 font-mono text-xs text-rust"
        >
          ▲ this page is served over HTTP. Do not enter a real password — credentials are
          transmitted in the clear.
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
        <div>
          <Input
            label="password"
            type="password"
            autoComplete="new-password"
            minLength={10}
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <StrengthMeter score={strength.score} hint={strength.hint} />
        </div>

        {err && (
          <div role="alert" className="border-l-2 border-rust px-4 py-2 font-mono text-xs text-rust">
            — {err}
          </div>
        )}

        <div className="mt-2 flex items-center gap-4">
          <Button type="submit" loading={submitting} disabled={strength.score < 2}>
            create account ▸
          </Button>
          <Link href="/login" className="eyebrow text-ink-400 hover:text-ember">
            i have one →
          </Link>
        </div>
      </form>
    </div>
  );
}

function StrengthMeter({ score, hint }: { score: 0 | 1 | 2 | 3 | 4; hint: string }) {
  const tones = ['#D8CFBD', '#B33A23', '#C9962B', '#4F7942', '#4F7942'];
  return (
    <div aria-hidden className="mt-3 flex items-center gap-3">
      <div className="flex flex-1 gap-[3px]">
        {[1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className="h-[3px] flex-1 transition-colors"
            style={{ background: i <= score ? tones[score] : 'rgba(15,14,12,0.1)' }}
          />
        ))}
      </div>
      <div className="eyebrow normal-case tracking-[0.06em] text-ink-400 font-normal">{hint}</div>
    </div>
  );
}
