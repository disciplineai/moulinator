import type { RunDto, TestCaseResultDto } from '@moulinator/api-core-contracts';

export function runRowToDto(row: {
  id: string;
  repo_id: string;
  commit_sha: string;
  tests_repo_commit_sha: string | null;
  runner_image_digest: string | null;
  status: RunDto['status'];
  cancellation_reason: string | null;
  jenkins_build_url: string | null;
  correlation_id: string;
  heartbeat_at: Date | null;
  started_at: Date | null;
  finished_at: Date | null;
  timeout_at: Date;
  created_at: Date;
}): RunDto {
  return {
    id: row.id,
    repo_id: row.repo_id,
    commit_sha: row.commit_sha,
    tests_repo_commit_sha: row.tests_repo_commit_sha,
    runner_image_digest: row.runner_image_digest,
    status: row.status,
    cancellation_reason: row.cancellation_reason,
    jenkins_build_url: row.jenkins_build_url,
    correlation_id: row.correlation_id,
    heartbeat_at: row.heartbeat_at?.toISOString() ?? null,
    started_at: row.started_at?.toISOString() ?? null,
    finished_at: row.finished_at?.toISOString() ?? null,
    timeout_at: row.timeout_at.toISOString(),
    created_at: row.created_at.toISOString(),
  };
}

export function caseRowToDto(row: {
  id: string;
  test_run_id: string;
  name: string;
  status: TestCaseResultDto['status'];
  duration_ms: number;
  preview: string | null;
  artifact_ref: string | null;
}): TestCaseResultDto {
  return {
    id: row.id,
    test_run_id: row.test_run_id,
    name: row.name,
    status: row.status,
    duration_ms: row.duration_ms,
    preview: row.preview ?? undefined,
    artifact_ref: row.artifact_ref,
  };
}
