import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Prisma } from '@prisma/client';
import { randomUUID } from 'crypto';
import { ulid } from 'ulid';
import type {
  IRunsOrchestrator,
  TriggerRunInput,
  TriggerRunResult,
} from '@moulinator/api-core-contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { GithubClient } from '../github/github.client';
import { TestsRepoResolver } from '../github/tests-repo.resolver';
import { StorageService } from '../storage/storage.service';
import { AuditService } from '../audit/audit.service';
import { JenkinsClient } from '../jenkins/jenkins.client';
import { AbortsQueue } from './aborts.queue';

const NON_TERMINAL_STATUSES = ['queued', 'running'] as const;

@Injectable()
export class RunsOrchestrator implements IRunsOrchestrator {
  private readonly logger = new Logger(RunsOrchestrator.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly crypto: CryptoService,
    private readonly github: GithubClient,
    private readonly storage: StorageService,
    private readonly jenkins: JenkinsClient,
    private readonly audit: AuditService,
    private readonly testsRepoResolver: TestsRepoResolver,
    private readonly aborts: AbortsQueue,
    private readonly config: ConfigService,
  ) {}

  async triggerRun(input: TriggerRunInput): Promise<TriggerRunResult> {
    const { userId, repoId, commitSha } = input;

    const repo = await this.prisma.repository.findUnique({
      where: { id: repoId },
      include: { project: true },
    });
    if (!repo || repo.user_id !== userId) {
      throw new NotFoundException({ error: 'repo_not_found' });
    }
    if (!/^[a-f0-9]{40}$/i.test(commitSha)) {
      throw new NotFoundException({
        error: 'invalid_commit_sha',
      });
    }

    const credential = await this.prisma.githubCredential.findFirst({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });
    if (!credential) {
      throw new NotFoundException({
        error: 'no_github_credential',
        message: 'add a GitHub PAT before triggering runs',
      });
    }

    const testsRepoCommitSha = await this.testsRepoResolver.resolveHead();
    const runnerImageDigest = repo.project.runner_image_digest;
    const timeoutSeconds = repo.project.timeout_seconds;
    const timeoutAt = new Date(Date.now() + timeoutSeconds * 1000);
    const runId = ulid();
    const correlationId = randomUUID();

    // Concurrency fence + row insert inside one transaction protected by a
    // Postgres advisory lock keyed on the user id, so concurrent triggerRun
    // calls for the same user serialize and cannot both observe active=0.
    await this.prisma.$transaction(async (tx) => {
      await this.takeAdvisoryLock(tx, userId);
      const active = await tx.testRun.count({
        where: {
          repo: { user_id: userId },
          status: { in: [...NON_TERMINAL_STATUSES] },
        },
      });
      if (active > 0) {
        throw new ConflictException({
          error: 'concurrent_run_limit',
          message:
            'you already have a non-terminal test run; wait for it to finish',
          details: { status: 429 },
        });
      }
      await tx.testRun.create({
        data: {
          id: runId,
          repo_id: repo.id,
          commit_sha: commitSha,
          tests_repo_commit_sha: testsRepoCommitSha,
          runner_image_digest: runnerImageDigest,
          status: 'queued',
          correlation_id: correlationId,
          timeout_at: timeoutAt,
        },
      });
    });

    const buckets = this.storage.bucketNames();
    const workspaceKey = `${runId}/workspace.tar.gz`;
    const logsKey = `${runId}/full.log`;
    const junitKey = `${runId}/junit.xml`;

    try {
      const pat = await this.crypto.decryptPat({
        ciphertext: credential.ciphertext,
        iv: credential.iv,
        authTag: credential.auth_tag,
        wrappedDek: credential.wrapped_dek,
      });

      const tarball = await this.github.archiveCommit(
        pat,
        repo.github_url,
        commitSha,
      );
      // PAT is a string (immutable) and will be GC'd; we drop the reference.
      let sizeBytes = 0;
      try {
        const upload = await this.storage.putObject({
          bucket: buckets.workspaces,
          key: workspaceKey,
          body: tarball,
          contentType: 'application/gzip',
        });
        sizeBytes = upload.sizeBytes;
      } finally {
        // Zero the tarball buffer whether or not the upload succeeded.
        tarball.fill(0);
      }

      const workspacePresigned = await this.storage.presignGet({
        bucket: buckets.workspaces,
        key: workspaceKey,
        expiresInSeconds: timeoutSeconds + 600,
      });
      const logsPresigned = await this.storage.presignPut({
        bucket: buckets.logs,
        key: logsKey,
        expiresInSeconds: timeoutSeconds + 600,
        contentType: 'text/plain',
      });
      const junitPresigned = await this.storage.presignPut({
        bucket: buckets.junit,
        key: junitKey,
        expiresInSeconds: timeoutSeconds + 600,
        contentType: 'application/xml',
      });

      const limits =
        (repo.project.resource_limits as {
          memory_mb?: number;
          cpus?: number;
          pids?: number;
        } | null) ?? {};
      const webhookUrl = `${this.config
        .getOrThrow<string>('PUBLIC_API_URL')
        .replace(/\/$/, '')}/webhooks/jenkins`;
      const testsRepoUrl = this.config.getOrThrow<string>('TESTS_REPO_URL');

      const trigger = await this.jenkins.triggerBuild({
        testRunId: runId,
        workspaceUrl: workspacePresigned.url,
        testsRepoUrl,
        testsCommitSha: testsRepoCommitSha,
        runnerImageDigest,
        projectSlug: repo.project.slug,
        harnessEntrypoint: repo.project.harness_entrypoint,
        timeoutSeconds,
        memoryMb: limits.memory_mb ?? 2048,
        cpus: limits.cpus ?? 2,
        pids: limits.pids ?? 512,
        hermetic: repo.project.hermetic,
        egressAllowlistJson: JSON.stringify(
          (repo.project.egress_allowlist as unknown) ?? [],
        ),
        logsUploadUrl: logsPresigned.url,
        junitUploadUrl: junitPresigned.url,
        webhookUrl,
      });

      await this.prisma.$transaction(async (tx) => {
        await tx.testRun.update({
          where: { id: runId },
          data: { jenkins_build_url: trigger.jenkinsBuildUrl },
        });
        await tx.buildArtifact.create({
          data: {
            id: ulid(),
            test_run_id: runId,
            kind: 'tarball',
            s3_key: workspaceKey,
            size_bytes: BigInt(sizeBytes),
            retention_until: new Date(Date.now() + 24 * 60 * 60 * 1000),
          },
        });
        await this.audit.logWith(tx, {
          actorId: userId,
          action: 'runs.trigger',
          entity: 'test_run',
          entityId: runId,
          metadata: {
            repo_id: repoId,
            commit_sha: commitSha,
            correlation_id: correlationId,
          },
        });
      });

      return { runId, correlationId, timeoutAt };
    } catch (err) {
      // Jenkins trigger (or any prerequisite) failed → queued→error.
      // State-machine: "queued → error | Jenkins trigger returns non-2xx".
      const reason = err instanceof Error ? err.message : 'trigger_failed';
      this.logger.warn(`trigger failed for run ${runId}: ${reason}`);
      await this.prisma.$transaction(async (tx) => {
        await tx.testRun.updateMany({
          where: { id: runId, status: 'queued' },
          data: {
            status: 'error',
            cancellation_reason: sanitizeReason(reason),
            finished_at: new Date(),
          },
        });
        await this.audit.logWith(tx, {
          actorId: userId,
          action: 'runs.trigger_failed',
          entity: 'test_run',
          entityId: runId,
          metadata: { reason: sanitizeReason(reason) },
        });
      });
      // Best-effort clean up the workspace object; nothing catastrophic if it lingers — lifecycle collects it.
      await this.storage.delete(buckets.workspaces, workspaceKey).catch(() => {});
      throw err;
    }
  }

  async cancelRun(runId: string, reason: string): Promise<void> {
    const run = await this.prisma.testRun.findUnique({ where: { id: runId } });
    if (!run) {
      throw new NotFoundException({ error: 'run_not_found' });
    }

    if (run.status === 'queued') {
      const upd = await this.prisma.testRun.updateMany({
        where: { id: runId, status: 'queued' },
        data: {
          status: 'cancelled',
          cancellation_reason: reason,
          finished_at: new Date(),
        },
      });
      if (upd.count === 0) {
        // Someone transitioned it between load and update; re-read and retry once.
        return this.cancelRun(runId, reason);
      }
      await this.audit.log({
        actorId: null,
        action: 'runs.cancel',
        entity: 'test_run',
        entityId: runId,
        metadata: { from: 'queued', reason },
      });
      return;
    }

    if (run.status === 'running') {
      // State machine: abort first, then transition.
      if (!run.jenkins_build_url) {
        // Shouldn't happen — running implies a build_started webhook which
        // populated the URL. If somehow missing, treat as error.
        await this.markRunningAsError(runId, 'abort_failed_no_url');
        throw new Error('abort_failed_no_url');
      }
      try {
        await this.jenkins.abortBuild(run.jenkins_build_url);
      } catch (err) {
        await this.markRunningAsError(runId, 'abort_failed');
        throw err;
      }
      const upd = await this.prisma.testRun.updateMany({
        where: { id: runId, status: 'running' },
        data: {
          status: 'cancelled',
          cancellation_reason: reason,
          finished_at: new Date(),
        },
      });
      if (upd.count === 0) {
        // Terminal transition happened concurrently. Accept.
        return;
      }
      await this.audit.log({
        actorId: null,
        action: 'runs.cancel',
        entity: 'test_run',
        entityId: runId,
        metadata: { from: 'running', reason },
      });
      return;
    }

    // Already terminal — caller (RunsService) should have surfaced 409;
    // just be idempotent here.
    throw new ConflictException({
      error: 'run_terminal',
      message: `cannot cancel a ${run.status} run`,
    });
  }

  private async markRunningAsError(
    runId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const upd = await tx.testRun.updateMany({
        where: { id: runId, status: 'running' },
        data: {
          status: 'error',
          cancellation_reason: reason,
          finished_at: new Date(),
        },
      });
      if (upd.count === 0) return;
      await this.audit.logWith(tx, {
        actorId: null,
        action: 'runs.error',
        entity: 'test_run',
        entityId: runId,
        metadata: { reason },
      });
    });
    // Ensure the Jenkins build is gone in the background.
    await this.aborts.enqueue(runId).catch(() => {});
  }

  /**
   * Postgres `pg_advisory_xact_lock(bigint)` scoped to the current
   * transaction. Serializes concurrent triggerRun() calls for the same user
   * so the count + insert concurrency fence is atomic. The lock is released
   * automatically at COMMIT/ROLLBACK.
   *
   * We derive the bigint from the ULID by taking 63 bits of its sha256 hash.
   * Collisions across users only mean two unrelated users briefly queue on
   * the same lock — harmless and rare.
   */
  private async takeAdvisoryLock(
    tx: Prisma.TransactionClient,
    userId: string,
  ): Promise<void> {
    const key = userIdToLockKey(userId);
    await tx.$executeRawUnsafe(`SELECT pg_advisory_xact_lock(${key})`);
  }
}

function userIdToLockKey(userId: string): bigint {
  // 8-byte xor fold of sha256 → bigint in the signed-int64 range.
  const h = require('crypto')
    .createHash('sha256')
    .update(userId)
    .digest();
  let key = 0n;
  for (let i = 0; i < 8; i++) {
    key = (key << 8n) | BigInt(h[i] ?? 0);
  }
  // Make sure it fits in a Postgres bigint (signed 64-bit).
  const SIGNED_MAX = (1n << 63n) - 1n;
  const SIGNED_MIN = -(1n << 63n);
  if (key > SIGNED_MAX) key -= 1n << 64n;
  if (key < SIGNED_MIN) key += 1n << 64n;
  return key;
}

function sanitizeReason(s: string): string {
  // Cap length & strip newlines to keep the audit log tidy.
  return s.replace(/\s+/g, ' ').slice(0, 200);
}

// Avoid an "unused Prisma type" compile error when the file has no generated
// client yet; Prisma namespace import gives us TransactionClient indirectly.
export type _TxHint = Prisma.TransactionClient;
