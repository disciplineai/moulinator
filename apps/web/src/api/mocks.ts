import type { components } from './generated/schema';

type User = components['schemas']['User'];
type Credential = components['schemas']['GithubCredentialMeta'];
type Project = components['schemas']['ProjectDefinition'];
type Repo = components['schemas']['Repo'];
type Run = components['schemas']['Run'];
type TestCase = components['schemas']['TestCaseResult'];
type Artifact = components['schemas']['BuildArtifact'];
type Contribution = components['schemas']['TestContribution'];

export const USE_MOCKS =
  typeof process !== 'undefined' && process.env.NEXT_PUBLIC_USE_MOCKS === '1';

export const mockUser: User = {
  id: '01J2ABCDEFGHJKMNPQRSTVWXYZ',
  email: 'student@epitech.eu',
  role: 'student',
  created_at: '2026-03-02T09:12:00Z',
};

export const mockProjects: Project[] = [
  {
    id: '01J3PROJCPOOLBSQ00000000000',
    slug: 'cpool-bsq',
    name: 'CPool · BSQ',
    language: 'c',
    tests_path: 'cpool-bsq/tests',
    hermetic: true,
    runner_image_digest: 'sha256:b0afe1…',
  },
  {
    id: '01J3PROJCPOOLD6000000000000',
    slug: 'cpool-day06',
    name: 'CPool · Day 06',
    language: 'c',
    tests_path: 'cpool-day06/tests',
    hermetic: true,
    runner_image_digest: 'sha256:c3dd4a…',
  },
  {
    id: '01J3PROJMATCHSTICK000000000',
    slug: 'matchstick',
    name: 'Matchstick',
    language: 'python',
    tests_path: 'matchstick/tests',
    hermetic: true,
    runner_image_digest: 'sha256:a719bd…',
  },
];

export const mockCredentials: Credential[] = [
  {
    id: '01J4CREDPRIMARY0000000000000',
    label: 'primary laptop',
    scopes: ['repo', 'read:user'],
    last_used_at: '2026-04-16T21:03:00Z',
    created_at: '2026-02-17T11:00:00Z',
  },
];

export const mockRepos: Repo[] = [
  {
    id: '01J5REPOBSQ000000000000000',
    project_id: mockProjects[0]!.id,
    github_url: 'https://github.com/edith-sk/cpool-bsq',
    default_branch: 'main',
    created_at: '2026-03-01T10:00:00Z',
  },
  {
    id: '01J5REPOD600000000000000000',
    project_id: mockProjects[1]!.id,
    github_url: 'https://github.com/edith-sk/cpool-day06',
    default_branch: 'main',
    created_at: '2026-03-04T10:00:00Z',
  },
];

function runAt(
  id: string,
  status: Run['status'],
  hoursAgo: number,
  repo: Repo,
  commit: string,
): Run {
  const created = new Date(Date.now() - hoursAgo * 3_600_000);
  const terminal = !['queued', 'running'].includes(status);
  return {
    id,
    repo_id: repo.id,
    commit_sha: commit,
    tests_repo_commit_sha: terminal || status === 'running' ? '5a1cf8b2e4a0…' : null,
    runner_image_digest: terminal || status === 'running' ? 'sha256:b0afe1…' : null,
    status,
    cancellation_reason: status === 'cancelled' ? 'user_requested' : null,
    jenkins_build_url: terminal || status === 'running' ? 'https://jenkins.moulinator.dev/job/moulinator-run/482/' : null,
    correlation_id: '1f0b5e7a-1c1d-4c67-8b2b-8a8a38ef03cb',
    heartbeat_at: status === 'running' ? new Date(Date.now() - 15_000).toISOString() : null,
    started_at: terminal || status === 'running' ? new Date(created.getTime() + 15_000).toISOString() : null,
    finished_at: terminal ? new Date(created.getTime() + 195_000).toISOString() : null,
    timeout_at: new Date(created.getTime() + 1_800_000).toISOString(),
    created_at: created.toISOString(),
  };
}

export const mockRuns: Run[] = [
  runAt('01J6RUN00000000000000RUNNING', 'running', 0.01, mockRepos[0]!, 'b1e7f1c0a4d8c29e8c1a2b3d4e5f607182930abc'),
  runAt('01J6RUN00000000000000PASSED1', 'passed', 3, mockRepos[0]!, '3a4b5c6d7e8f90112233445566778899aabbccdd'),
  runAt('01J6RUN00000000000000FAILED1', 'failed', 8, mockRepos[1]!, 'ff00ee11dd22cc33bb44aa556677889900aabbcc'),
  runAt('01J6RUN00000000000000ERROR01', 'error', 26, mockRepos[1]!, '9988776655443322110099887766554433221100'),
  runAt('01J6RUN00000000000000TIMEDOT', 'timed_out', 48, mockRepos[0]!, '0011223344556677889900aabbccddeeff001122'),
];

export const mockTestCases: TestCase[] = [
  {
    id: '01J7CASE00000000001',
    test_run_id: mockRuns[1]!.id,
    name: 'recursive · my_strlen · empty',
    status: 'passed',
    duration_ms: 2,
    preview: 'ok 1',
  },
  {
    id: '01J7CASE00000000002',
    test_run_id: mockRuns[1]!.id,
    name: 'recursive · my_strlen · ascii',
    status: 'passed',
    duration_ms: 3,
  },
  {
    id: '01J7CASE00000000003',
    test_run_id: mockRuns[1]!.id,
    name: 'recursive · my_revstr · palindrome',
    status: 'failed',
    duration_ms: 12,
    preview:
      'expected "aba"\n   actual "aba\\x00c"\n  stderr: stray byte at index 3\n',
    artifact_ref: '01J8ARTIFACT000000001',
  },
  {
    id: '01J7CASE00000000004',
    test_run_id: mockRuns[1]!.id,
    name: 'recursive · my_putnbr · INT_MIN',
    status: 'skipped',
    duration_ms: 0,
  },
];

export const mockArtifacts: Artifact[] = [
  {
    id: '01J8ARTIFACTLOG00001',
    test_run_id: mockRuns[1]!.id,
    kind: 'logs',
    size_bytes: 48123,
    retention_until: '2026-05-20T00:00:00Z',
  },
  {
    id: '01J8ARTIFACTJUNIT001',
    test_run_id: mockRuns[1]!.id,
    kind: 'junit',
    size_bytes: 11923,
    retention_until: '2026-05-20T00:00:00Z',
  },
];

export const mockContributions: Contribution[] = [
  {
    id: '01J9CONTRIB000000001',
    user_id: mockUser.id,
    project_id: mockProjects[0]!.id,
    github_pr_url: 'https://github.com/your-org/moulinator-tests/pull/214',
    status: 'open',
    merged_commit_sha: null,
    created_at: '2026-04-11T12:04:00Z',
  },
  {
    id: '01J9CONTRIB000000002',
    user_id: mockUser.id,
    project_id: mockProjects[2]!.id,
    github_pr_url: 'https://github.com/your-org/moulinator-tests/pull/198',
    status: 'merged',
    merged_commit_sha: 'e0f1a2b3c4d5e6f7a8b9',
    created_at: '2026-03-20T09:22:00Z',
  },
];
