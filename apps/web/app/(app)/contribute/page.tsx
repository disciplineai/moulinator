'use client';

import { useState } from 'react';
import { Rule } from '@/components/ui/Rule';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { useContributions, useProjects } from '@/src/api/hooks';
import { api, errorMessage } from '@/src/api/client';
import { toast } from '@/components/ui/toast';
import { relTime, shortSha } from '@/src/format';
import type { components } from '@/src/api/generated/schema';

type Status = 'open' | 'merged' | 'rejected' | 'all';

export default function ContributePage() {
  const [statusFilter, setStatusFilter] = useState<Status>('all');
  const contribs = useContributions(statusFilter === 'all' ? undefined : statusFilter);
  const projects = useProjects();
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow text-ember">— contribute</div>
          <h1 className="mt-2 font-display text-3xl font-medium text-ink">
            Tests you submitted to the shared repo
          </h1>
          <p className="mt-3 max-w-[68ch] font-mono text-sm text-ink-400">
            When you find a missing case, open a pull request on{' '}
            <code className="bg-ink/5 px-1">moulinator-tests</code> and register the PR here.
            Moderators review the PR on GitHub; the status mirrors automatically. One pinned
            commit per project, no force-pushes.
          </p>
        </div>
        {!showForm && <Button onClick={() => setShowForm(true)}>register a PR ▸</Button>}
      </header>

      {showForm && (
        <RegisterPrForm
          projects={projects.data ?? []}
          onCancel={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            contribs.refetch();
          }}
        />
      )}

      <section>
        <div className="flex items-center justify-between">
          <Rule label="your pull requests" />
        </div>
        <nav
          aria-label="filter by status"
          className="mt-4 flex flex-wrap items-center gap-2 font-mono text-xs"
        >
          {(['all', 'open', 'merged', 'rejected'] as Status[]).map((s) => {
            const active = statusFilter === s;
            return (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`rounded-[2px] border px-3 py-1.5 uppercase tracking-[0.12em] transition ${
                  active
                    ? 'border-ink bg-ink text-parchment-50'
                    : 'border-ink/20 text-ink-600 hover:border-ink'
                }`}
                aria-pressed={active}
              >
                {s}
              </button>
            );
          })}
        </nav>

        <div className="mt-6">
          {contribs.loading ? (
            <Spinner label="Loading contributions" />
          ) : !contribs.data || contribs.data.length === 0 ? (
            <EmptyState
              eyebrow="— empty set"
              title="No contributions yet."
              description="When you spot a missing test case on a run, open a PR on the tests-repo and link it here."
            >
              <Button onClick={() => setShowForm(true)}>register a PR ▸</Button>
            </EmptyState>
          ) : (
            <ul className="flex flex-col gap-3">
              {contribs.data.map((c) => {
                const project = projects.data?.find((p) => p.id === c.project_id);
                return (
                  <li key={c.id}>
                    <article className="paper-plain flex flex-wrap items-center justify-between gap-4 px-5 py-4">
                      <div className="flex items-center gap-3">
                        <ContribStamp status={c.status} />
                        <div>
                          <div className="font-display text-md italic text-ink">
                            {project?.name ?? c.project_id}
                          </div>
                          <a
                            href={c.github_pr_url}
                            target="_blank"
                            rel="noreferrer"
                            className="link-under font-mono text-xs text-ink-400"
                          >
                            {c.github_pr_url} ↗
                          </a>
                        </div>
                      </div>
                      <div className="font-mono text-xs text-ink-400 tabular">
                        opened {relTime(c.created_at)}
                        {c.merged_commit_sha && <> · merged at {shortSha(c.merged_commit_sha)}</>}
                      </div>
                    </article>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}

function ContribStamp({ status }: { status: 'open' | 'merged' | 'rejected' }) {
  const map = {
    open: { fg: '#2A4A63', bg: '#DDE8F1', border: '#3B6E8F' },
    merged: { fg: '#F6F2E9', bg: '#4F7942', border: '#3F6434' },
    rejected: { fg: '#F6F2E9', bg: '#B33A23', border: '#8E2E1A' },
  }[status];
  return (
    <span
      className="stamp"
      style={{ color: map.fg, background: map.bg, borderColor: map.border }}
    >
      {status}
    </span>
  );
}

function RegisterPrForm({
  projects,
  onCancel,
  onCreated,
}: {
  projects: Array<components['schemas']['ProjectDefinition']>;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [projectSlug, setProjectSlug] = useState(projects[0]?.slug ?? '');
  const [url, setUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const { error } = await api.POST('/contributions', {
        body: { project_slug: projectSlug, github_pr_url: url },
      });
      if (error) throw error;
      toast.success('Contribution registered');
      onCreated();
    } catch (e) {
      setErr(errorMessage(e, 'Could not register PR.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="paper-plain border-l-2 !border-l-ember px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow text-ember">— register a PR</div>
          <h2 className="mt-1 font-display text-xl text-ink">Link a pull request to a project</h2>
        </div>
        <button type="button" onClick={onCancel} className="eyebrow text-ink-400 hover:text-ember">
          cancel ✕
        </button>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-[260px_1fr]">
        <div>
          <label className="field-label" htmlFor="slug">
            project
          </label>
          <select
            id="slug"
            className="input"
            value={projectSlug}
            onChange={(e) => setProjectSlug(e.target.value)}
            required
          >
            {projects.map((p) => (
              <option key={p.slug} value={p.slug}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <Input
          label="github pr url"
          type="url"
          placeholder="https://github.com/your-org/moulinator-tests/pull/123"
          required
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
      </div>

      {err && (
        <div role="alert" className="mt-4 border-l-2 border-rust px-4 py-2 font-mono text-xs text-rust">
          — {err}
        </div>
      )}

      <div className="mt-5 flex items-center gap-3">
        <Button type="submit" loading={submitting} disabled={!url || !projectSlug}>
          register ▸
        </Button>
      </div>
    </form>
  );
}
