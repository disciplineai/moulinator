'use client';

import Link from 'next/link';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Rule } from '@/components/ui/Rule';
import { useCredentials, useRecentRuns, useRepos } from '@/src/api/hooks';
import { useAuth } from '@/src/auth/AuthProvider';
import { relTime, repoName, shortSha } from '@/src/format';

export default function DashboardPage() {
  const { user } = useAuth();
  const runs = useRecentRuns();
  const credentials = useCredentials();
  const repos = useRepos();

  const hasCred = (credentials.data ?? []).length > 0;
  const repoCount = (repos.data?.items ?? []).length;

  return (
    <div className="flex flex-col gap-12">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div>
          <div className="eyebrow text-ember">— dashboard</div>
          <h1 className="mt-2 font-display text-4xl font-medium text-ink text-balance">
            welcome back,{' '}
            <em className="italic">{user?.email.split('@')[0] || 'student'}</em>.
          </h1>
          <p className="mt-3 max-w-[58ch] font-mono text-sm text-ink-400">
            Here&apos;s the shape of your last week. Trigger a run from a repo, or start a new
            contribution when you have a test to share.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link href="/repos" className="btn-ghost">
            ▸ my repos
          </Link>
          <Link href="/repos?new=1" className="btn-primary">
            register a repo
          </Link>
        </div>
      </header>

      <section className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <StatCard
          eyebrow="00 — account"
          title={user?.email || ''}
          detail={`role · ${user?.role ?? 'student'}`}
          tone="ink"
        />
        <StatCard
          eyebrow="01 — credentials"
          title={hasCred ? `${credentials.data!.length} PAT` : 'no PAT yet'}
          detail={hasCred ? 'encrypted at rest' : 'add one to trigger runs'}
          action={
            !hasCred ? (
              <Link href="/credentials" className="link-under">
                add one →
              </Link>
            ) : undefined
          }
          tone={hasCred ? 'plain' : 'warn'}
        />
        <StatCard
          eyebrow="02 — repositories"
          title={`${repoCount} registered`}
          detail={repoCount ? 'run any, anytime' : 'register one to start'}
          action={
            !repoCount ? (
              <Link href="/repos" className="link-under">
                register →
              </Link>
            ) : undefined
          }
          tone={repoCount ? 'plain' : 'warn'}
        />
      </section>

      <section>
        <Rule label="recent runs · latest first" />
        <div className="paper-plain mt-6">
          {runs.loading ? (
            <div className="px-6 py-8">
              <Spinner label="Tailing the log" />
            </div>
          ) : !runs.data || runs.data.length === 0 ? (
            <EmptyState
              eyebrow="— no runs yet"
              title="Nothing has been tested on your behalf yet."
              description="Register a repository, paste a PAT, and trigger your first run. It usually takes under two minutes from commit to verdict."
            >
              <Link href="/repos" className="btn-primary">
                go to repos ▸
              </Link>
            </EmptyState>
          ) : (
            <ul className="divide-y divide-ink/10">
              {runs.data.map((run) => (
                <li key={run.id}>
                  <Link
                    href={`/runs/${run.id}`}
                    className="grid grid-cols-[auto_1fr_auto_auto] items-center gap-6 px-6 py-4 hover:bg-parchment-50"
                  >
                    <StatusBadge status={run.status} size="sm" />
                    <div className="min-w-0">
                      <div className="truncate font-mono text-sm text-ink">
                        run · <span className="tabular">{shortSha(run.commit_sha, 10)}</span>
                      </div>
                      <div className="eyebrow mt-1 text-ink-400 normal-case tracking-[0.05em] font-normal">
                        {relTime(run.created_at)} · correlation{' '}
                        <span className="tabular">{run.correlation_id.slice(0, 8)}</span>
                      </div>
                    </div>
                    <div className="hidden font-mono text-xs text-ink-400 md:block tabular">
                      {repoCount
                        ? (() => {
                            const r = repos.data?.items.find((x) => x.id === run.repo_id);
                            return r ? repoName(r.github_url) : '—';
                          })()
                        : '—'}
                    </div>
                    <div className="font-mono text-ink-400 opacity-60">→</div>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function StatCard({
  eyebrow,
  title,
  detail,
  action,
  tone,
}: {
  eyebrow: string;
  title: string;
  detail: string;
  action?: React.ReactNode;
  tone?: 'plain' | 'warn' | 'ink';
}) {
  const toneCls =
    tone === 'warn'
      ? 'paper-plain border-l-2 !border-l-ember'
      : tone === 'ink'
        ? 'bg-ink text-parchment-50'
        : 'paper-plain';
  return (
    <article className={`${toneCls} relative flex min-h-[128px] flex-col justify-between px-5 py-4`}>
      <div
        className={`eyebrow ${tone === 'warn' ? 'text-ember' : tone === 'ink' ? 'text-parchment' : 'text-ink-400'}`}
      >
        {eyebrow}
      </div>
      <div>
        <div className="font-display text-xl font-medium text-balance">{title}</div>
        <div className={`mt-1 font-mono text-xs ${tone === 'ink' ? 'text-parchment' : 'text-ink-400'}`}>
          {detail}
        </div>
      </div>
      {action && <div className="mt-4 text-xs">{action}</div>}
    </article>
  );
}
