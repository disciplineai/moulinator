'use client';

import { useState } from 'react';
import { Rule } from '@/components/ui/Rule';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { api, errorMessage } from '@/src/api/client';
import { useCredentials } from '@/src/api/hooks';
import { toast } from '@/components/ui/toast';
import { relTime } from '@/src/format';

export default function CredentialsPage() {
  const creds = useCredentials();
  const [showForm, setShowForm] = useState(false);

  const secure =
    typeof window === 'undefined' ||
    window.location.protocol === 'https:' ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow text-ember">— credentials</div>
          <h1 className="mt-2 font-display text-3xl font-medium text-ink">
            GitHub personal access tokens
          </h1>
          <p className="mt-3 max-w-[62ch] font-mono text-sm text-ink-400">
            Your PAT is validated against GitHub, then encrypted with{' '}
            <code className="bg-ink/5 px-1">AES-256-GCM</code> before storage. It is{' '}
            <em className="not-italic text-ink underline decoration-ember">never</em> shown again
            after you submit it — and it never leaves the control plane, not even to Jenkins or the
            runner.
          </p>
        </div>
        {!showForm && (
          <Button onClick={() => setShowForm(true)} variant="primary">
            add a token ▸
          </Button>
        )}
      </header>

      {showForm && (
        <AddTokenForm
          secure={secure}
          onCancel={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            creds.refetch();
          }}
        />
      )}

      <section>
        <Rule label={`stored tokens · ${creds.data?.length ?? 0}`} />
        <div className="mt-6">
          {creds.loading ? (
            <Spinner label="Loading credentials" />
          ) : !creds.data || creds.data.length === 0 ? (
            <EmptyState
              eyebrow="— empty set"
              title="No PAT stored yet."
              description="Create one at github.com → Settings → Developer settings → Personal access tokens. Grant repo + read:user."
            >
              <Button onClick={() => setShowForm(true)}>add the first one ▸</Button>
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {creds.data.map((c) => (
                <li key={c.id}>
                  <article className="paper-plain flex flex-wrap items-center justify-between gap-6 px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-3">
                        <span className="stamp stamp-solid">PAT</span>
                        <span className="truncate font-mono text-sm text-ink">{c.label || 'untitled'}</span>
                      </div>
                      <div className="eyebrow mt-2 normal-case tracking-[0.06em] text-ink-400 font-normal">
                        added {relTime(c.created_at)} · last used{' '}
                        <span className="text-ink">{c.last_used_at ? relTime(c.last_used_at) : 'never'}</span>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      {c.scopes.map((s) => (
                        <span
                          key={s}
                          className="rounded-[2px] border border-ink/20 px-2 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-ink-600"
                        >
                          {s}
                        </span>
                      ))}
                    </div>
                    <Button
                      variant="danger"
                      onClick={async () => {
                        if (!confirm('Delete this PAT? Runs using it will fail until you add a new one.')) return;
                        try {
                          const { error } = await api.DELETE('/me/credentials/{id}', {
                            params: { path: { id: c.id } },
                          });
                          if (error) throw error;
                          toast.success('Token deleted');
                          creds.refetch();
                        } catch (e) {
                          toast.error('Could not delete', errorMessage(e));
                        }
                      }}
                    >
                      delete
                    </Button>
                  </article>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function AddTokenForm({
  secure,
  onCancel,
  onCreated,
}: {
  secure: boolean;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [label, setLabel] = useState('');
  const [token, setToken] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const { error } = await api.POST('/me/credentials', {
        body: { token, label },
      });
      if (error) throw error;
      toast.success('Token stored', 'encrypted at rest · never shown again');
      onCreated();
    } catch (e) {
      setErr(errorMessage(e, 'Could not store token.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="paper-plain border-l-2 !border-l-ember px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow text-ember">— new token</div>
          <h2 className="mt-1 font-display text-xl font-medium text-ink">Paste a PAT</h2>
        </div>
        <button type="button" onClick={onCancel} className="eyebrow text-ink-400 hover:text-ember">
          cancel ✕
        </button>
      </div>

      {!secure && (
        <div role="alert" className="mt-4 border-l-2 border-rust px-4 py-2 font-mono text-xs text-rust">
          ▲ you are about to submit a secret over plain HTTP. Do not continue in production.
        </div>
      )}

      <div
        role="note"
        className="mt-4 grid grid-cols-[auto_1fr] gap-3 border-l-2 border-ink/20 bg-ink/[0.02] px-4 py-3"
      >
        <span className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.18em] text-ink-600">
          note
        </span>
        <p className="font-mono text-xs leading-5 text-ink-600">
          We will never show this token to you again. If you lose it, delete the entry here and
          generate a new one on GitHub — rotation is your responsibility.
        </p>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-[220px_1fr]">
        <Input
          label="label"
          placeholder="e.g. primary laptop"
          maxLength={64}
          value={label}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Input
          label="token"
          type="password"
          autoComplete="off"
          required
          placeholder="ghp_…"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          hint="minimum scopes: repo, read:user"
        />
      </div>

      {err && (
        <div role="alert" className="mt-4 border-l-2 border-rust px-4 py-2 font-mono text-xs text-rust">
          — {err}
        </div>
      )}

      <div className="mt-5 flex items-center gap-3">
        <Button type="submit" loading={submitting} disabled={!token}>
          store encrypted ▸
        </Button>
        <span className="eyebrow text-ink-400 normal-case tracking-[0.05em] font-normal">
          submit only over HTTPS
        </span>
      </div>
    </form>
  );
}
