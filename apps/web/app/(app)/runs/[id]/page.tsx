'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { Rule } from '@/components/ui/Rule';
import { Button } from '@/components/ui/Button';
import { StatusBadge, TestCaseBadge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { useRun, useRunArtifacts, useRunResults } from '@/src/api/hooks';
import { api, errorMessage } from '@/src/api/client';
import { toast } from '@/components/ui/toast';
import { fmtBytes, fmtDuration, relTime, shortDigest, shortSha } from '@/src/format';

export default function RunDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const run = useRun(id, true);
  const status = run.data?.status;
  const results = useRunResults(id, status);
  const artifacts = useRunArtifacts(id, status);

  if (run.loading && !run.data) return <Spinner label="Loading run" />;
  if (!run.data) {
    return (
      <div className="paper-plain px-6 py-8">
        <div className="eyebrow text-rust">— not found</div>
        <h1 className="mt-2 font-display text-2xl">This run does not exist.</h1>
        <Link href="/dashboard" className="link-under mt-4 inline-block">
          ← back to dashboard
        </Link>
      </div>
    );
  }

  const r = run.data;
  const terminal = !['queued', 'running'].includes(r.status);

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-start justify-between gap-6">
        <div className="min-w-0">
          <div className="eyebrow text-ember">— run</div>
          <h1 className="mt-2 font-display text-3xl font-medium text-ink">
            <span className="tabular">{shortSha(r.commit_sha, 10)}</span>
          </h1>
          <p className="mt-2 font-mono text-xs text-ink-400 tabular">
            correlation {r.correlation_id} · created {relTime(r.created_at)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <StatusBadge status={r.status} size="lg" />
          {!terminal && (
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm('Cancel this run?')) return;
                try {
                  const { error } = await api.DELETE('/runs/{id}', { params: { path: { id } } });
                  if (error) throw error;
                  toast.success('Cancellation requested');
                  run.refetch();
                } catch (e) {
                  toast.error('Could not cancel', errorMessage(e));
                }
              }}
            >
              cancel run
            </Button>
          )}
          {r.jenkins_build_url && (
            <a href={r.jenkins_build_url} target="_blank" rel="noreferrer" className="btn-ghost">
              jenkins build ↗
            </a>
          )}
        </div>
      </header>

      <PinSheet
        testsSha={r.tests_repo_commit_sha}
        runnerDigest={r.runner_image_digest}
        startedAt={r.started_at}
        finishedAt={r.finished_at}
        heartbeatAt={r.heartbeat_at}
        timeoutAt={r.timeout_at}
        isPolling={run.isPolling}
      />

      {r.cancellation_reason && (
        <div className="paper-plain border-l-2 !border-l-rust px-5 py-3 font-mono text-sm text-rust">
          — cancellation reason · {r.cancellation_reason}
        </div>
      )}

      <section>
        <Rule
          label={
            terminal
              ? `test cases · ${results.data?.length ?? 0}`
              : 'test cases (awaiting terminal transition)'
          }
        />
        <div className="mt-6">
          {!terminal ? (
            <div className="paper animate-slide-in px-6 py-10">
              <div className="mx-auto max-w-[56ch] text-center">
                <div className="eyebrow text-ember">— running</div>
                <h2 className="mt-2 font-display text-2xl">
                  The harness has not reported a verdict yet.
                </h2>
                <p className="mt-3 font-mono text-sm text-ink-400">
                  Live polling on a 2–15 s backoff. Test cases will materialise the moment the
                  Jenkins build_completed webhook lands.
                </p>
                <div className="mt-6 flex justify-center gap-2 text-2xl text-ember">
                  <span className="animate-pulse-soft">▮</span>
                  <span className="animate-pulse-soft" style={{ animationDelay: '140ms' }}>
                    ▮
                  </span>
                  <span className="animate-pulse-soft" style={{ animationDelay: '280ms' }}>
                    ▮
                  </span>
                </div>
              </div>
            </div>
          ) : results.loading ? (
            <Spinner label="Loading results" />
          ) : !results.data || results.data.length === 0 ? (
            <div className="paper-plain px-6 py-6 font-mono text-sm text-ink-400">
              — no test cases were reported.
            </div>
          ) : (
            <ul className="paper-plain divide-y divide-ink/10">
              {results.data.map((t) => (
                <li key={t.id}>
                  <details className="group">
                    <summary className="flex cursor-pointer items-center gap-4 px-5 py-3 hover:bg-parchment-50">
                      <TestCaseBadge status={t.status} />
                      <span className="flex-1 truncate font-mono text-sm text-ink">{t.name}</span>
                      <span className="font-mono text-xs text-ink-400 tabular">
                        {fmtDuration(t.duration_ms)}
                      </span>
                      {t.preview && <span className="eyebrow text-ink-400">expand ▾</span>}
                    </summary>
                    {t.preview && (
                      <pre className="mx-5 mb-4 mt-1 max-h-64 overflow-auto whitespace-pre rounded-[2px] bg-ink/[0.03] p-3 font-mono text-[12px] leading-5 text-ink-600">
                        {t.preview}
                      </pre>
                    )}
                  </details>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {terminal && (
        <section>
          <Rule label={`artifacts · ${artifacts.data?.length ?? 0}`} />
          <div className="mt-6">
            {artifacts.loading ? (
              <Spinner label="Loading artifacts" />
            ) : !artifacts.data || artifacts.data.length === 0 ? (
              <div className="paper-plain px-6 py-6 font-mono text-sm text-ink-400">
                — no artifacts recorded.
              </div>
            ) : (
              <ul className="grid gap-3 md:grid-cols-2">
                {artifacts.data.map((a) => (
                  <li key={a.id}>
                    <ArtifactCard id={a.id} kind={a.kind} size={a.size_bytes} retention={a.retention_until} />
                  </li>
                ))}
              </ul>
            )}
          </div>
        </section>
      )}
    </div>
  );
}

function PinSheet({
  testsSha,
  runnerDigest,
  startedAt,
  finishedAt,
  heartbeatAt,
  timeoutAt,
  isPolling,
}: {
  testsSha: string | null | undefined;
  runnerDigest: string | null | undefined;
  startedAt: string | null | undefined;
  finishedAt: string | null | undefined;
  heartbeatAt: string | null | undefined;
  timeoutAt: string | null | undefined;
  isPolling: boolean;
}) {
  return (
    <section className="paper-plain grid grid-cols-2 gap-0 border-l-2 !border-l-ember md:grid-cols-4">
      <PinCell label="tests pin" value={shortSha(testsSha, 12)} hint="tests_repo_commit_sha" />
      <PinCell label="runner image" value={shortDigest(runnerDigest)} hint="runner_image_digest" />
      <PinCell
        label="timing"
        value={finishedAt ? 'finished' : startedAt ? 'started' : 'queued'}
        hint={
          finishedAt
            ? `finished ${relTime(finishedAt)}`
            : startedAt
              ? `started ${relTime(startedAt)} · hb ${relTime(heartbeatAt) || '—'}`
              : `timeout_at ${relTime(timeoutAt)}`
        }
      />
      <PinCell
        label="polling"
        value={isPolling ? 'live · on' : 'off'}
        hint={isPolling ? 'backoff 2–15 s' : 'stopped on terminal'}
      />
    </section>
  );
}

function PinCell({ label, value, hint }: { label: string; value: string; hint: string }) {
  return (
    <div className="border-b border-r border-ink/10 px-5 py-4 last:border-r-0">
      <div className="eyebrow text-ink-400">{label}</div>
      <div className="mt-1 font-display text-lg tabular text-ink">{value}</div>
      <div className="eyebrow mt-1 tracking-[0.05em] normal-case font-normal text-ink-400">{hint}</div>
    </div>
  );
}

function ArtifactCard({
  id,
  kind,
  size,
  retention,
}: {
  id: string;
  kind: 'logs' | 'tarball' | 'junit';
  size: number;
  retention: string;
}) {
  const [loading, setLoading] = useState(false);

  async function download() {
    setLoading(true);
    try {
      const { data, error } = await api.GET('/artifacts/{id}/url', {
        params: { path: { id } },
      });
      if (error) throw error;
      const url = (data as { url: string }).url;
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (e) {
      toast.error('Could not get artifact URL', errorMessage(e));
    } finally {
      setLoading(false);
    }
  }

  const tone = kind === 'logs' ? 'ink' : kind === 'junit' ? 'moss' : 'ochre';
  const bg = { ink: '#2A2620', moss: '#4F7942', ochre: '#C9962B' }[tone];
  return (
    <article className="paper-plain flex items-center justify-between gap-4 px-5 py-4">
      <div className="flex min-w-0 items-center gap-3">
        <span
          className="stamp"
          style={{ color: '#F6F2E9', background: bg, borderColor: bg }}
        >
          {kind}
        </span>
        <div className="min-w-0">
          <div className="font-mono text-sm text-ink tabular">{fmtBytes(size)}</div>
          <div className="eyebrow normal-case tracking-[0.06em] font-normal text-ink-400">
            retention {relTime(retention)}
          </div>
        </div>
      </div>
      <Button variant="ghost" loading={loading} onClick={download}>
        download ↓
      </Button>
    </article>
  );
}
