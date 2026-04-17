'use client';

import Link from 'next/link';
import { use, useState } from 'react';
import { Rule } from '@/components/ui/Rule';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { StatusBadge } from '@/components/ui/StatusBadge';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, Tbody, Td, Th, Thead, Tr } from '@/components/ui/Table';
import { useProjects, useRepo, useRepoRuns } from '@/src/api/hooks';
import { api, errorMessage } from '@/src/api/client';
import { toast } from '@/components/ui/toast';
import { relTime, repoName, shortSha } from '@/src/format';
import { useRouter } from 'next/navigation';

export default function RepoDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const repo = useRepo(id);
  const runs = useRepoRuns(id);
  const projects = useProjects();
  const [commit, setCommit] = useState('');
  const [triggering, setTriggering] = useState(false);
  const [triggerErr, setTriggerErr] = useState<string | null>(null);

  const project = projects.data?.find((p) => p.id === repo.data?.project_id);
  const validCommit = /^[a-f0-9]{40}$/.test(commit.trim());

  async function trigger() {
    if (!validCommit || !repo.data) return;
    setTriggerErr(null);
    setTriggering(true);
    try {
      const { data, error } = await api.POST('/runs', {
        body: { repo_id: repo.data.id, commit_sha: commit.trim() },
      });
      if (error) throw error;
      toast.success('Run queued', `correlation ${(data as { correlation_id: string }).correlation_id.slice(0, 8)}`);
      if (data) router.push(`/runs/${(data as { id: string }).id}`);
    } catch (e) {
      setTriggerErr(errorMessage(e, 'Could not queue run.'));
    } finally {
      setTriggering(false);
    }
  }

  if (repo.loading) return <Spinner label="Loading repository" />;
  if (!repo.data) {
    return (
      <EmptyState
        eyebrow="— not found"
        title="This repo does not exist, or it is not yours."
        description="Check the URL or go back to the list."
      >
        <Link href="/repos" className="btn-ghost">
          ← back to repos
        </Link>
      </EmptyState>
    );
  }

  return (
    <div className="flex flex-col gap-10">
      <header>
        <div className="flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <div className="eyebrow text-ember">— repository</div>
            <h1 className="mt-2 truncate font-display text-3xl font-medium text-ink">
              {repoName(repo.data.github_url)}
            </h1>
            <p className="mt-3 font-mono text-sm text-ink-400">
              {project ? (
                <>
                  project <span className="text-ink">{project.name}</span> ·{' '}
                  <span className="uppercase">{project.language}</span> ·{' '}
                </>
              ) : null}
              default branch <span className="text-ink">{repo.data.default_branch}</span>
            </p>
          </div>
          <div className="flex items-center gap-3">
            <a href={repo.data.github_url} target="_blank" rel="noreferrer" className="btn-ghost">
              open on github ↗
            </a>
            <Button
              variant="danger"
              onClick={async () => {
                if (!confirm('Delete this repository registration? Runs already recorded are kept.')) return;
                try {
                  const { error } = await api.DELETE('/repos/{id}', { params: { path: { id } } });
                  if (error) throw error;
                  toast.success('Repository deregistered');
                  router.push('/repos');
                } catch (e) {
                  toast.error('Could not delete', errorMessage(e));
                }
              }}
            >
              delete
            </Button>
          </div>
        </div>
      </header>

      <section className="paper-plain px-6 py-5">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <div className="eyebrow text-ember">— trigger a run</div>
            <h2 className="mt-1 font-display text-xl text-ink">Pick a commit SHA</h2>
            <p className="mt-2 max-w-[60ch] font-mono text-xs text-ink-400">
              Full 40-char SHA only (no branch names in MVP). Every run pins a matching{' '}
              <code className="bg-ink/5 px-1">tests_repo_commit_sha</code> and{' '}
              <code className="bg-ink/5 px-1">runner_image_digest</code> for reproducibility.
            </p>
          </div>
        </div>

        <div className="mt-5 grid gap-5 md:grid-cols-[1fr_auto]">
          <Input
            label="commit sha"
            placeholder="full 40-character SHA"
            spellCheck={false}
            pattern="[a-f0-9]{40}"
            value={commit}
            onChange={(e) => setCommit(e.target.value.trim().toLowerCase())}
            error={commit && !validCommit ? 'must be a 40-character hex SHA' : null}
            trailing={validCommit ? <span className="text-moss">✓</span> : null}
          />
          <div className="flex items-end">
            <Button onClick={trigger} loading={triggering} disabled={!validCommit}>
              queue ▸
            </Button>
          </div>
        </div>
        {triggerErr && (
          <div role="alert" className="mt-4 border-l-2 border-rust px-4 py-2 font-mono text-xs text-rust">
            — {triggerErr}
          </div>
        )}
      </section>

      <section>
        <Rule label={`run history · ${runs.data?.items.length ?? 0} recent`} />
        <div className="paper-plain mt-6 overflow-hidden">
          {runs.loading ? (
            <div className="px-6 py-8">
              <Spinner label="Loading runs" />
            </div>
          ) : !runs.data || runs.data.items.length === 0 ? (
            <EmptyState
              eyebrow="— no runs yet"
              title="Trigger the first run for this repo."
              description="Once you paste a commit SHA above and hit queue, this table fills up."
            />
          ) : (
            <Table>
              <Thead>
                <tr>
                  <Th>status</Th>
                  <Th>commit</Th>
                  <Th>queued</Th>
                  <Th>started</Th>
                  <Th>finished</Th>
                  <Th className="text-right pr-6">—</Th>
                </tr>
              </Thead>
              <Tbody>
                {runs.data.items.map((r) => (
                  <Tr key={r.id}>
                    <Td>
                      <StatusBadge status={r.status} />
                    </Td>
                    <Td className="tabular text-ink">{shortSha(r.commit_sha, 10)}</Td>
                    <Td className="tabular text-ink-400">{relTime(r.created_at)}</Td>
                    <Td className="tabular text-ink-400">{relTime(r.started_at)}</Td>
                    <Td className="tabular text-ink-400">{relTime(r.finished_at)}</Td>
                    <Td className="text-right pr-6">
                      <Link href={`/runs/${r.id}`} className="eyebrow text-ember">
                        open →
                      </Link>
                    </Td>
                  </Tr>
                ))}
              </Tbody>
            </Table>
          )}
        </div>
      </section>
    </div>
  );
}
