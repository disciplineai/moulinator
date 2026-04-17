'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { Rule } from '@/components/ui/Rule';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';
import { useProjects, useRepos } from '@/src/api/hooks';
import { api, errorMessage } from '@/src/api/client';
import { toast } from '@/components/ui/toast';
import { relTime, repoName } from '@/src/format';

function ReposInner() {
  const search = useSearchParams();
  const repos = useRepos();
  const projects = useProjects();
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    if (search.get('new') === '1') setShowForm(true);
  }, [search]);

  const projectById = useMemo(() => {
    const map = new Map<string, { slug: string; name: string; language: string }>();
    for (const p of projects.data ?? []) map.set(p.id, p);
    return map;
  }, [projects.data]);

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow text-ember">— repositories</div>
          <h1 className="mt-2 font-display text-3xl font-medium text-ink">Your registered repos</h1>
          <p className="mt-3 max-w-[58ch] font-mono text-sm text-ink-400">
            A repo is a pointer: <code className="bg-ink/5 px-1">project × github url</code>. You
            trigger runs on specific commits — no branches are tracked.
          </p>
        </div>
        {!showForm && <Button onClick={() => setShowForm(true)}>register a repo ▸</Button>}
      </header>

      {showForm && (
        <RegisterRepoForm
          projects={projects.data ?? []}
          onCancel={() => setShowForm(false)}
          onCreated={() => {
            setShowForm(false);
            repos.refetch();
          }}
        />
      )}

      <section>
        <Rule label={`registered · ${repos.data?.items.length ?? 0}`} />
        <div className="paper-plain mt-6 overflow-hidden">
          {repos.loading ? (
            <div className="px-6 py-8">
              <Spinner label="Loading repositories" />
            </div>
          ) : !repos.data || repos.data.items.length === 0 ? (
            <EmptyState
              eyebrow="— empty set"
              title="No repositories registered."
              description="Pick a project and paste the GitHub URL of your repo. Make sure your PAT can clone it."
            />
          ) : (
            <Table>
              <Thead>
                <tr>
                  <Th>project</Th>
                  <Th>repository</Th>
                  <Th>branch</Th>
                  <Th>registered</Th>
                  <Th className="text-right pr-6">—</Th>
                </tr>
              </Thead>
              <Tbody>
                {repos.data.items.map((r) => {
                  const p = projectById.get(r.project_id);
                  return (
                    <Tr key={r.id}>
                      <Td>
                        <div className="flex items-center gap-2">
                          <span className="font-display text-md italic text-ink">
                            {p?.name ?? 'unknown'}
                          </span>
                          {p?.language && (
                            <span className="rounded-[2px] border border-ink/20 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-600">
                              {p.language}
                            </span>
                          )}
                        </div>
                      </Td>
                      <Td>
                        <a
                          href={r.github_url}
                          target="_blank"
                          rel="noreferrer"
                          className="link-under font-mono text-sm text-ink"
                        >
                          {repoName(r.github_url)} ↗
                        </a>
                      </Td>
                      <Td className="tabular text-ink-400">{r.default_branch}</Td>
                      <Td className="tabular text-ink-400">{relTime(r.created_at)}</Td>
                      <Td className="text-right pr-6">
                        <Link href={`/repos/${r.id}`} className="eyebrow text-ember">
                          open →
                        </Link>
                      </Td>
                    </Tr>
                  );
                })}
              </Tbody>
            </Table>
          )}
        </div>
      </section>
    </div>
  );
}

export default function ReposPage() {
  return (
    <Suspense fallback={<Spinner label="Loading" />}>
      <ReposInner />
    </Suspense>
  );
}

function RegisterRepoForm({
  projects,
  onCancel,
  onCreated,
}: {
  projects: Array<{ id: string; name: string; slug: string; language: string }>;
  onCancel: () => void;
  onCreated: () => void;
}) {
  const [projectId, setProjectId] = useState(projects[0]?.id ?? '');
  const [url, setUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (!projectId && projects[0]) setProjectId(projects[0].id);
  }, [projectId, projects]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSubmitting(true);
    try {
      const { error } = await api.POST('/repos', {
        body: {
          project_id: projectId,
          github_url: url,
          default_branch: branch || 'main',
        },
      });
      if (error) throw error;
      toast.success('Repository registered');
      onCreated();
    } catch (e) {
      setErr(errorMessage(e, 'Could not register repository.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="paper-plain border-l-2 !border-l-ember px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow text-ember">— register a repo</div>
          <h2 className="mt-1 font-display text-xl text-ink">Point at a repository</h2>
        </div>
        <button type="button" onClick={onCancel} className="eyebrow text-ink-400 hover:text-ember">
          cancel ✕
        </button>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-[260px_1fr_160px]">
        <div>
          <label className="field-label" htmlFor="project">
            project
          </label>
          <select
            id="project"
            className="input appearance-none pr-8"
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            required
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.language}
              </option>
            ))}
          </select>
        </div>
        <Input
          label="github url"
          type="url"
          required
          placeholder="https://github.com/you/cpool-bsq"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
        />
        <Input
          label="branch"
          placeholder="main"
          value={branch}
          onChange={(e) => setBranch(e.target.value)}
        />
      </div>

      {err && (
        <div role="alert" className="mt-4 border-l-2 border-rust px-4 py-2 font-mono text-xs text-rust">
          — {err}
        </div>
      )}

      <div className="mt-5 flex items-center gap-3">
        <Button type="submit" loading={submitting} disabled={!projectId || !url}>
          register ▸
        </Button>
      </div>
    </form>
  );
}
