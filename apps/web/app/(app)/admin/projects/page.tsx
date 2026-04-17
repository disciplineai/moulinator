'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/src/auth/AuthProvider';
import { Rule } from '@/components/ui/Rule';
import { Input } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Spinner } from '@/components/ui/Spinner';
import { EmptyState } from '@/components/ui/EmptyState';
import { Table, Thead, Tbody, Tr, Th, Td } from '@/components/ui/Table';
import { api, errorMessage } from '@/src/api/client';
import { useAdminProjects, type AdminProject } from '@/src/api/hooks';
import { toast } from '@/components/ui/toast';

type Language = 'c' | 'cpp' | 'python' | 'bash' | 'haskell';
const LANGUAGES: Language[] = ['c', 'cpp', 'python', 'bash', 'haskell'];

type FormData = {
  slug: string; name: string; language: Language; tests_path: string;
  runner_image_repo: string; runner_image_digest: string;
  hermetic: boolean; timeout_seconds: string; harness_entrypoint: string;
  resource_limits: string; egress_allowlist: string;
};

const EMPTY_FORM: FormData = {
  slug: '', name: '', language: 'c', tests_path: '', runner_image_repo: '',
  runner_image_digest: 'sha256:', hermetic: true, timeout_seconds: '600',
  harness_entrypoint: 'tests/harness.sh',
  resource_limits: '{"memory_mb":2048,"cpus":2,"pids":512,"disk_mb":1024}',
  egress_allowlist: '[]',
};

export default function AdminProjectsPage() {
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const projects = useAdminProjects();
  const [editing, setEditing] = useState<AdminProject | null>(null);
  const [showCreate, setShowCreate] = useState(false);

  if (authLoading) return <Spinner label="Checking permissions" />;
  if (!user || user.role !== 'admin') {
    router.replace('/dashboard');
    return null;
  }

  function closeForm() {
    setEditing(null);
    setShowCreate(false);
  }

  function refresh() {
    projects.refetch();
    closeForm();
  }

  return (
    <div className="flex flex-col gap-10">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow text-ember">— admin</div>
          <h1 className="mt-2 font-display text-3xl font-medium text-ink">Project definitions</h1>
          <p className="mt-3 max-w-[62ch] font-mono text-sm text-ink-400">
            Manage the project catalogue. Changes take effect immediately — students see updated
            projects on their next page load.
          </p>
        </div>
        {!showCreate && !editing && (
          <Button onClick={() => setShowCreate(true)} variant="primary">
            + new project ▸
          </Button>
        )}
      </header>

      {(showCreate || editing) && (
        <ProjectForm
          key={editing?.slug ?? 'new'}
          initial={editing ? projectToForm(editing) : EMPTY_FORM}
          slug={editing?.slug}
          onCancel={closeForm}
          onSaved={refresh}
        />
      )}

      <section>
        <Rule label={`projects · ${projects.data?.length ?? 0}`} />
        <div className="mt-6">
          {projects.loading ? (
            <Spinner label="Loading projects" />
          ) : !projects.data || projects.data.length === 0 ? (
            <EmptyState
              eyebrow="— empty catalogue"
              title="No projects yet."
              description="Create the first project definition above."
            >
              <Button onClick={() => setShowCreate(true)}>create first project ▸</Button>
            </EmptyState>
          ) : (
            <Table>
              <Thead>
                <Tr>
                  <Th>slug</Th>
                  <Th>name</Th>
                  <Th>lang</Th>
                  <Th>hermetic</Th>
                  <Th>timeout</Th>
                  <Th>digest</Th>
                  <Th></Th>
                </Tr>
              </Thead>
              <Tbody>
                {projects.data.map((p) => (
                  <Tr key={p.id}>
                    <Td><code className="text-ember">{p.slug}</code></Td>
                    <Td>{p.name}</Td>
                    <Td><span className="stamp">{p.language}</span></Td>
                    <Td>{p.hermetic ? '✓' : '—'}</Td>
                    <Td>{p.timeout_seconds}s</Td>
                    <Td className="max-w-[160px]">
                      <code className="block truncate text-[11px] text-ink-400">
                        {(p.runner_image_digest ?? '').slice(0, 19)}…
                      </code>
                    </Td>
                    <Td>
                      <div className="flex gap-2">
                        <Button
                          variant="ghost"
                          onClick={() => { setShowCreate(false); setEditing(p as AdminProject); }}
                        >
                          edit
                        </Button>
                        <Button
                          variant="danger"
                          onClick={async () => {
                            if (!confirm(`Delete project "${p.slug}"? This cannot be undone.`)) return;
                            try {
                              const { error } = await api.DELETE('/admin/projects/{slug}', {
                                params: { path: { slug: p.slug } },
                              });
                              if (error) throw error;
                              toast.success('Project deleted');
                              projects.refetch();
                            } catch (e) {
                              toast.error('Could not delete', errorMessage(e));
                            }
                          }}
                        >
                          delete
                        </Button>
                      </div>
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

function projectToForm(p: AdminProject): FormData {
  return {
    slug: p.slug,
    name: p.name,
    language: (LANGUAGES.includes(p.language as Language) ? p.language : 'c') as Language,
    tests_path: p.tests_path,
    runner_image_repo: p.runner_image_repo,
    runner_image_digest: p.runner_image_digest,
    hermetic: p.hermetic,
    timeout_seconds: String(p.timeout_seconds),
    harness_entrypoint: p.harness_entrypoint,
    resource_limits: JSON.stringify(p.resource_limits, null, 2),
    egress_allowlist: JSON.stringify(p.egress_allowlist ?? [], null, 2),
  };
}

function ProjectForm({
  initial,
  slug,
  onCancel,
  onSaved,
}: {
  initial: FormData;
  slug?: string;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const isEdit = !!slug;
  const [form, setForm] = useState<FormData>(initial);
  const [submitting, setSubmitting] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set(field: keyof FormData, value: string | boolean) {
    setForm((f) => ({ ...f, [field]: value }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    let resource_limits: Record<string, unknown>;
    let egress_allowlist: Record<string, unknown>[];
    try {
      resource_limits = JSON.parse(form.resource_limits);
    } catch {
      setErr('resource_limits must be valid JSON');
      return;
    }
    try {
      const parsed = JSON.parse(form.egress_allowlist);
      if (!Array.isArray(parsed)) throw new Error();
      egress_allowlist = parsed as Record<string, unknown>[];
    } catch {
      setErr('egress_allowlist must be a valid JSON array');
      return;
    }

    const body = {
      name: form.name,
      language: form.language,
      tests_path: form.tests_path,
      runner_image_repo: form.runner_image_repo,
      runner_image_digest: form.runner_image_digest,
      hermetic: form.hermetic,
      timeout_seconds: Number(form.timeout_seconds),
      harness_entrypoint: form.harness_entrypoint,
      resource_limits,
      egress_allowlist,
    };

    setSubmitting(true);
    try {
      if (isEdit) {
        const { error } = await api.PUT('/admin/projects/{slug}', {
          params: { path: { slug } },
          body,
        });
        if (error) throw error;
        toast.success('Project updated');
      } else {
        const { error } = await api.POST('/admin/projects', {
          body: { ...body, slug: form.slug },
        });
        if (error) throw error;
        toast.success('Project created');
      }
      onSaved();
    } catch (e) {
      setErr(errorMessage(e, 'Could not save project.'));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form onSubmit={submit} className="paper-plain border-l-2 !border-l-ember px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="eyebrow text-ember">— {isEdit ? `editing · ${slug}` : 'new project'}</div>
          <h2 className="mt-1 font-display text-xl font-medium text-ink">
            {isEdit ? 'Edit project definition' : 'Create project definition'}
          </h2>
        </div>
        <button type="button" onClick={onCancel} className="eyebrow text-ink-400 hover:text-ember">
          cancel ✕
        </button>
      </div>

      <div className="mt-6 grid gap-5 md:grid-cols-2">
        {!isEdit && (
          <Input
            label="slug"
            required
            placeholder="cpool-day06"
            value={form.slug}
            onChange={(e) => set('slug', e.target.value)}
            hint="unique identifier · lowercase, hyphens only"
          />
        )}
        <Input
          label="name"
          required
          placeholder="C Pool — Day 06"
          value={form.name}
          onChange={(e) => set('name', e.target.value)}
        />
        <div className="flex flex-col gap-1">
          <label className="eyebrow text-ink-600">language</label>
          <select
            className="input appearance-none"
            value={form.language}
            onChange={(e) => set('language', e.target.value as Language)}
            required
          >
            {LANGUAGES.map((l) => (
              <option key={l} value={l}>{l}</option>
            ))}
          </select>
        </div>
        <Input
          label="tests_path"
          required
          placeholder="cpool-day06/tests"
          value={form.tests_path}
          onChange={(e) => set('tests_path', e.target.value)}
          hint="path inside the tests-repo"
        />
        <Input
          label="runner_image_repo"
          required
          placeholder="ghcr.io/your-org/moulinator/runner-c"
          value={form.runner_image_repo}
          onChange={(e) => set('runner_image_repo', e.target.value)}
        />
        <Input
          label="runner_image_digest"
          required
          placeholder="sha256:abc123…"
          value={form.runner_image_digest}
          onChange={(e) => set('runner_image_digest', e.target.value)}
          hint="pinned digest — no tags"
        />
        <Input
          label="harness_entrypoint"
          required
          placeholder="tests/harness.sh"
          value={form.harness_entrypoint}
          onChange={(e) => set('harness_entrypoint', e.target.value)}
        />
        <Input
          label="timeout_seconds"
          type="number"
          required
          value={form.timeout_seconds}
          onChange={(e) => set('timeout_seconds', e.target.value)}
        />
        <label className="flex cursor-pointer items-center gap-3 font-mono text-sm">
          <input
            type="checkbox"
            checked={form.hermetic}
            onChange={(e) => set('hermetic', e.target.checked)}
            className="h-4 w-4 accent-ember"
          />
          <span className="text-ink">hermetic <span className="text-ink-400">(zero egress)</span></span>
        </label>
      </div>

      <div className="mt-5 grid gap-5 md:grid-cols-2">
        <div className="flex flex-col gap-1">
          <label className="eyebrow text-ink-600">resource_limits <span className="normal-case font-normal tracking-normal text-ink-400">(JSON)</span></label>
          <textarea
            className="input min-h-[80px] font-mono text-xs"
            value={form.resource_limits}
            onChange={(e) => set('resource_limits', e.target.value)}
            spellCheck={false}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label className="eyebrow text-ink-600">egress_allowlist <span className="normal-case font-normal tracking-normal text-ink-400">(JSON array — ignored when hermetic)</span></label>
          <textarea
            className="input min-h-[80px] font-mono text-xs"
            value={form.egress_allowlist}
            onChange={(e) => set('egress_allowlist', e.target.value)}
            spellCheck={false}
          />
        </div>
      </div>

      {err && (
        <div role="alert" className="mt-4 border-l-2 border-rust px-4 py-2 font-mono text-xs text-rust">
          — {err}
        </div>
      )}

      <div className="mt-5 flex items-center gap-3">
        <Button type="submit" loading={submitting}>
          {isEdit ? 'save changes ▸' : 'create project ▸'}
        </Button>
      </div>
    </form>
  );
}
