'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import type { components } from './generated/schema';
import { api, errorMessage } from './client';
import {
  USE_MOCKS,
  mockArtifacts,
  mockContributions,
  mockCredentials,
  mockProjects,
  mockRepos,
  mockRuns,
  mockTestCases,
} from './mocks';

type Run = components['schemas']['Run'];
type Repo = components['schemas']['Repo'];
type Project = components['schemas']['ProjectDefinition'];
type Credential = components['schemas']['GithubCredentialMeta'];
type RunList = components['schemas']['RunList'];
type RepoList = components['schemas']['RepoList'];
type Artifact = components['schemas']['BuildArtifact'];
type TestCase = components['schemas']['TestCaseResult'];
type Contribution = components['schemas']['TestContribution'];

type Fetcher<T> = () => Promise<T>;

type QueryState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => Promise<void>;
};

function useAsync<T>(fn: Fetcher<T>, deps: React.DependencyList = []): QueryState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const value = await fn();
      if (mounted.current) setData(value);
    } catch (e) {
      if (mounted.current) setError(errorMessage(e));
    } finally {
      if (mounted.current) setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    mounted.current = true;
    run();
    return () => {
      mounted.current = false;
    };
  }, [run]);

  return { data, loading, error, refetch: run };
}

function mockOrFail<T>(mock: T, e: unknown): T {
  if (USE_MOCKS) return mock;
  throw e;
}

export function useCredentials() {
  return useAsync<Credential[]>(async () => {
    try {
      const { data, error } = await api.GET('/me/credentials');
      if (error) throw error;
      return (data ?? []) as Credential[];
    } catch (e) {
      return mockOrFail(mockCredentials, e);
    }
  });
}

export function useProjects() {
  return useAsync<Project[]>(async () => {
    try {
      const { data, error } = await api.GET('/projects');
      if (error) throw error;
      return (data ?? []) as Project[];
    } catch (e) {
      return mockOrFail(mockProjects, e);
    }
  });
}

export interface AdminProject {
  id: string; slug: string; name: string; language: string;
  tests_path: string; runner_image_repo: string; runner_image_digest: string;
  hermetic: boolean; egress_allowlist: unknown[]; timeout_seconds: number;
  resource_limits: Record<string, unknown>; harness_entrypoint: string;
  created_at: string; updated_at: string;
}

export function useAdminProjects() {
  return useAsync<AdminProject[]>(async () => {
    const { data, error } = await api.GET('/admin/projects' as '/projects');
    if (error) throw error;
    return (data ?? []) as unknown as AdminProject[];
  });
}

export function useRepos() {
  return useAsync<RepoList>(async () => {
    try {
      const { data, error } = await api.GET('/repos');
      if (error) throw error;
      return data as RepoList;
    } catch (e) {
      return mockOrFail({ items: mockRepos, next_cursor: null }, e);
    }
  });
}

export function useRepo(id: string) {
  return useAsync<Repo>(
    async () => {
      try {
        const { data, error } = await api.GET('/repos/{id}', {
          params: { path: { id } },
        });
        if (error) throw error;
        return data as Repo;
      } catch (e) {
        const found = mockRepos.find((r) => r.id === id) ?? mockRepos[0]!;
        return mockOrFail(found, e);
      }
    },
    [id],
  );
}

export function useRepoRuns(id: string) {
  return useAsync<RunList>(
    async () => {
      try {
        const { data, error } = await api.GET('/repos/{id}/runs', {
          params: { path: { id }, query: { limit: 20 } },
        });
        if (error) throw error;
        return data as RunList;
      } catch (e) {
        const items = mockRuns.filter((r) => r.repo_id === id);
        return mockOrFail(
          { items: items.length ? items : mockRuns, next_cursor: null },
          e,
        );
      }
    },
    [id],
  );
}

export function useRecentRuns() {
  return useAsync<Run[]>(async () => {
    try {
      const { data, error } = await api.GET('/repos');
      if (error) throw error;
      const repos = ((data as RepoList | undefined)?.items ?? []) as Repo[];
      const lists = await Promise.all(
        repos.slice(0, 5).map((r) =>
          api.GET('/repos/{id}/runs', {
            params: { path: { id: r.id }, query: { limit: 5 } },
          }),
        ),
      );
      const runs: Run[] = [];
      for (const res of lists) {
        if (res.data) runs.push(...(res.data as RunList).items);
      }
      runs.sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
      return runs.slice(0, 8);
    } catch (e) {
      return mockOrFail(mockRuns.slice(0, 8), e);
    }
  });
}

export function useRun(id: string, poll = true): QueryState<Run> & { isPolling: boolean } {
  const [data, setData] = useState<Run | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isPolling, setIsPolling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const attempt = useRef(0);
  const mounted = useRef(true);

  const fetchOnce = useCallback(async () => {
    try {
      const { data: d, error } = await api.GET('/runs/{id}', {
        params: { path: { id } },
      });
      if (error) throw error;
      if (mounted.current) setData(d as Run);
      return d as Run;
    } catch (e) {
      const mock = mockRuns.find((r) => r.id === id) ?? mockRuns[0]!;
      if (USE_MOCKS) {
        if (mounted.current) setData(mock);
        return mock;
      }
      if (mounted.current) setError(errorMessage(e));
      throw e;
    }
  }, [id]);

  const schedule = useCallback(
    (next: Run | null) => {
      if (!poll) return;
      const terminal = next && !['queued', 'running'].includes(next.status);
      if (terminal) {
        setIsPolling(false);
        return;
      }
      const delay = Math.min(15_000, 2000 + attempt.current * 750);
      attempt.current += 1;
      setIsPolling(true);
      timer.current = setTimeout(() => {
        fetchOnce().then(schedule).catch(() => schedule(null));
      }, delay);
    },
    [fetchOnce, poll],
  );

  const refetch = useCallback(async () => {
    setLoading(true);
    try {
      const next = await fetchOnce();
      schedule(next);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [fetchOnce, schedule]);

  useEffect(() => {
    mounted.current = true;
    refetch();
    return () => {
      mounted.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  return { data, loading, error, refetch, isPolling };
}

export function useRunResults(id: string, status: Run['status'] | undefined) {
  return useAsync<TestCase[]>(
    async () => {
      const terminal = status && !['queued', 'running'].includes(status);
      if (!terminal) return [];
      try {
        const { data, error } = await api.GET('/runs/{id}/results', {
          params: { path: { id } },
        });
        if (error) throw error;
        return (data ?? []) as TestCase[];
      } catch (e) {
        return mockOrFail(mockTestCases, e);
      }
    },
    [id, status],
  );
}

export function useRunArtifacts(id: string, status: Run['status'] | undefined) {
  return useAsync<Artifact[]>(
    async () => {
      const terminal = status && !['queued', 'running'].includes(status);
      if (!terminal) return [];
      try {
        const { data, error } = await api.GET('/runs/{id}/artifacts', {
          params: { path: { id } },
        });
        if (error) throw error;
        return (data ?? []) as Artifact[];
      } catch (e) {
        return mockOrFail(mockArtifacts, e);
      }
    },
    [id, status],
  );
}

export function useContributions(status?: 'open' | 'merged' | 'rejected') {
  return useAsync<Contribution[]>(
    async () => {
      try {
        const { data, error } = await api.GET('/contributions', {
          params: { query: status ? { status } : {} },
        });
        if (error) throw error;
        return (data ?? []) as Contribution[];
      } catch (e) {
        const filtered = status ? mockContributions.filter((c) => c.status === status) : mockContributions;
        return mockOrFail(filtered, e);
      }
    },
    [status],
  );
}
