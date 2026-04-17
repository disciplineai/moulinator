export type Ulid = string;
export type Iso8601 = string;
export type Uuid = string;

export type Role = 'student' | 'moderator' | 'admin';
export type RunStatus =
  | 'queued'
  | 'running'
  | 'passed'
  | 'failed'
  | 'error'
  | 'cancelled'
  | 'timed_out';
export type TestCaseStatus = 'passed' | 'failed' | 'skipped';
export type ArtifactKind = 'logs' | 'tarball' | 'junit';
export type ContributionStatus = 'open' | 'merged' | 'rejected';
export type Language = 'c' | 'cpp' | 'python' | 'bash' | 'haskell';

export interface ApiError {
  error: string;
  message?: string;
  details?: Record<string, unknown>;
}

/**
 * JSON body returned from /auth/signup, /auth/login, /auth/refresh.
 * The refresh token lives in the httpOnly `mou_rt` cookie set by the
 * server — never in this body.
 */
export interface AuthTokens {
  access_token: string;
  expires_in: number;
}

export interface UserDto {
  id: Ulid;
  email: string;
  role: Role;
  created_at: Iso8601;
}

export interface GithubCredentialMetaDto {
  id: Ulid;
  label: string;
  scopes: string[];
  last_used_at: Iso8601 | null;
  created_at: Iso8601;
}

export interface ProjectDefinitionDto {
  id: Ulid;
  slug: string;
  name: string;
  language: Language;
  tests_path: string;
  hermetic: boolean;
  runner_image_digest: string;
}

export interface RepoDto {
  id: Ulid;
  project_id: Ulid;
  github_url: string;
  default_branch: string;
  created_at: Iso8601;
}

export interface RepoListDto {
  items: RepoDto[];
  next_cursor: string | null;
}

export interface RunDto {
  id: Ulid;
  repo_id: Ulid;
  commit_sha: string;
  tests_repo_commit_sha: string | null;
  runner_image_digest: string | null;
  status: RunStatus;
  cancellation_reason: string | null;
  jenkins_build_url: string | null;
  correlation_id: Uuid;
  heartbeat_at: Iso8601 | null;
  started_at: Iso8601 | null;
  finished_at: Iso8601 | null;
  timeout_at: Iso8601;
  created_at: Iso8601;
}

export interface RunListDto {
  items: RunDto[];
  next_cursor: string | null;
}

export interface TestCaseResultDto {
  id: Ulid;
  test_run_id: Ulid;
  name: string;
  status: TestCaseStatus;
  duration_ms: number;
  preview?: string;
  artifact_ref: string | null;
}

export interface BuildArtifactDto {
  id: Ulid;
  test_run_id: Ulid;
  kind: ArtifactKind;
  size_bytes: number;
  retention_until: Iso8601;
}

export interface TestContributionDto {
  id: Ulid;
  user_id: Ulid;
  project_id: Ulid;
  github_pr_url: string;
  status: ContributionStatus;
  merged_commit_sha: string | null;
  created_at: Iso8601;
}

export interface PresignedUrlDto {
  url: string;
  expires_at: Iso8601;
}
