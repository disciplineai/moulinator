import type { Ulid, Iso8601, TestCaseStatus, ArtifactKind } from './dto';

export type JenkinsWebhookEventName =
  | 'build_started'
  | 'heartbeat'
  | 'build_completed'
  | 'build_errored';

export interface BuildStartedEvent {
  test_run_id: Ulid;
  jenkins_build_url: string;
  started_at: Iso8601;
  runner_image_digest: string;
  tests_repo_commit_sha: string;
}

export interface HeartbeatEvent {
  test_run_id: Ulid;
  heartbeat_at: Iso8601;
  stage?: string;
}

export interface BuildCompletedCase {
  name: string;
  status: TestCaseStatus;
  duration_ms: number;
  preview?: string;
  artifact_ref?: string;
}

export interface BuildCompletedArtifact {
  kind: ArtifactKind;
  s3_key: string;
  size_bytes: number;
}

export interface BuildCompletedEvent {
  test_run_id: Ulid;
  finished_at: Iso8601;
  cases: BuildCompletedCase[];
  artifacts?: BuildCompletedArtifact[];
}

export interface BuildErroredEvent {
  test_run_id: Ulid;
  finished_at: Iso8601;
  error: string;
  detail?: string;
}

export type JenkinsWebhookPayload =
  | BuildStartedEvent
  | HeartbeatEvent
  | BuildCompletedEvent
  | BuildErroredEvent;

export interface JenkinsWebhookHeaders {
  signature: string;
  idempotencyKey: string;
  event: JenkinsWebhookEventName;
}
