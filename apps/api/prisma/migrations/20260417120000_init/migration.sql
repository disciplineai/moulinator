-- CreateEnum
CREATE TYPE "Role" AS ENUM ('student', 'moderator', 'admin');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('queued', 'running', 'passed', 'failed', 'error', 'cancelled', 'timed_out');

-- CreateEnum
CREATE TYPE "TestCaseStatus" AS ENUM ('passed', 'failed', 'skipped');

-- CreateEnum
CREATE TYPE "ArtifactKind" AS ENUM ('logs', 'tarball', 'junit');

-- CreateEnum
CREATE TYPE "ContributionStatus" AS ENUM ('open', 'merged', 'rejected');

-- CreateEnum
CREATE TYPE "Language" AS ENUM ('c', 'cpp', 'python', 'bash', 'haskell');

-- CreateTable
CREATE TABLE "users" (
    "id" CHAR(26) NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'student',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "jti" UUID NOT NULL,
    "issued_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "replaced_by" CHAR(26),

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "github_credentials" (
    "id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "label" TEXT NOT NULL,
    "ciphertext" BYTEA NOT NULL,
    "iv" BYTEA NOT NULL,
    "auth_tag" BYTEA NOT NULL,
    "wrapped_dek" BYTEA NOT NULL,
    "scopes" TEXT[],
    "last_used_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "github_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "project_definitions" (
    "id" CHAR(26) NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "language" "Language" NOT NULL,
    "tests_path" TEXT NOT NULL,
    "runner_image_repo" TEXT NOT NULL,
    "runner_image_digest" TEXT NOT NULL,
    "hermetic" BOOLEAN NOT NULL DEFAULT true,
    "egress_allowlist" JSONB NOT NULL,
    "timeout_seconds" INTEGER NOT NULL DEFAULT 600,
    "resource_limits" JSONB NOT NULL,
    "harness_entrypoint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "repositories" (
    "id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "project_id" CHAR(26) NOT NULL,
    "github_url" TEXT NOT NULL,
    "default_branch" TEXT NOT NULL DEFAULT 'main',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_runs" (
    "id" CHAR(26) NOT NULL,
    "repo_id" CHAR(26) NOT NULL,
    "commit_sha" TEXT NOT NULL,
    "tests_repo_commit_sha" TEXT,
    "runner_image_digest" TEXT,
    "status" "RunStatus" NOT NULL DEFAULT 'queued',
    "cancellation_reason" TEXT,
    "jenkins_build_url" TEXT,
    "correlation_id" UUID NOT NULL,
    "heartbeat_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "timeout_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_case_results" (
    "id" CHAR(26) NOT NULL,
    "test_run_id" CHAR(26) NOT NULL,
    "name" TEXT NOT NULL,
    "status" "TestCaseStatus" NOT NULL,
    "duration_ms" INTEGER NOT NULL,
    "preview" TEXT,
    "artifact_ref" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "test_case_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "build_artifacts" (
    "id" CHAR(26) NOT NULL,
    "test_run_id" CHAR(26) NOT NULL,
    "kind" "ArtifactKind" NOT NULL,
    "s3_key" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "retention_until" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "build_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "test_contributions" (
    "id" CHAR(26) NOT NULL,
    "user_id" CHAR(26) NOT NULL,
    "project_id" CHAR(26) NOT NULL,
    "github_pr_url" TEXT NOT NULL,
    "status" "ContributionStatus" NOT NULL DEFAULT 'open',
    "merged_commit_sha" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "test_contributions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "idempotency_key" UUID NOT NULL,
    "payload_hash" BYTEA NOT NULL,
    "event" TEXT NOT NULL,
    "received_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("idempotency_key")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" BIGSERIAL NOT NULL,
    "actor_id" CHAR(26),
    "action" TEXT NOT NULL,
    "entity" TEXT,
    "entity_id" TEXT,
    "ip" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_jti_key" ON "refresh_tokens"("jti");

-- CreateIndex
CREATE INDEX "refresh_tokens_user_id_revoked_at_idx" ON "refresh_tokens"("user_id", "revoked_at");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "github_credentials_user_id_idx" ON "github_credentials"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "project_definitions_slug_key" ON "project_definitions"("slug");

-- CreateIndex
CREATE INDEX "repositories_user_id_idx" ON "repositories"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "repositories_user_id_github_url_project_id_key" ON "repositories"("user_id", "github_url", "project_id");

-- CreateIndex
CREATE UNIQUE INDEX "test_runs_correlation_id_key" ON "test_runs"("correlation_id");

-- CreateIndex
CREATE INDEX "test_runs_repo_id_created_at_idx" ON "test_runs"("repo_id", "created_at");

-- CreateIndex
CREATE INDEX "test_runs_status_heartbeat_at_idx" ON "test_runs"("status", "heartbeat_at");

-- CreateIndex
CREATE INDEX "test_runs_status_timeout_at_idx" ON "test_runs"("status", "timeout_at");

-- CreateIndex
CREATE INDEX "test_case_results_test_run_id_idx" ON "test_case_results"("test_run_id");

-- CreateIndex
CREATE UNIQUE INDEX "build_artifacts_s3_key_key" ON "build_artifacts"("s3_key");

-- CreateIndex
CREATE INDEX "build_artifacts_test_run_id_idx" ON "build_artifacts"("test_run_id");

-- CreateIndex
CREATE INDEX "build_artifacts_retention_until_idx" ON "build_artifacts"("retention_until");

-- CreateIndex
CREATE UNIQUE INDEX "test_contributions_github_pr_url_key" ON "test_contributions"("github_pr_url");

-- CreateIndex
CREATE INDEX "test_contributions_status_idx" ON "test_contributions"("status");

-- CreateIndex
CREATE INDEX "test_contributions_project_id_status_idx" ON "test_contributions"("project_id", "status");

-- CreateIndex
CREATE INDEX "webhook_events_received_at_idx" ON "webhook_events"("received_at");

-- CreateIndex
CREATE INDEX "audit_logs_actor_id_created_at_idx" ON "audit_logs"("actor_id", "created_at");

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_replaced_by_fkey" FOREIGN KEY ("replaced_by") REFERENCES "refresh_tokens"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "github_credentials" ADD CONSTRAINT "github_credentials_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "repositories" ADD CONSTRAINT "repositories_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_runs" ADD CONSTRAINT "test_runs_repo_id_fkey" FOREIGN KEY ("repo_id") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_case_results" ADD CONSTRAINT "test_case_results_test_run_id_fkey" FOREIGN KEY ("test_run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "build_artifacts" ADD CONSTRAINT "build_artifacts_test_run_id_fkey" FOREIGN KEY ("test_run_id") REFERENCES "test_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_contributions" ADD CONSTRAINT "test_contributions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "test_contributions" ADD CONSTRAINT "test_contributions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "project_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

