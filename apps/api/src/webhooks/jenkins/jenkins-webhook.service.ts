import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { ulid } from 'ulid';
import type { Prisma } from '@prisma/client';
import type {
  BuildCompletedEvent,
  BuildErroredEvent,
  BuildStartedEvent,
  HeartbeatEvent,
  IJenkinsWebhookService,
  JenkinsWebhookEventName,
  JenkinsWebhookHeaders,
  JenkinsWebhookPayload,
  JenkinsWebhookResult,
} from '@moulinator/api-core-contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../core/audit/audit.service';
import { AbortsQueue } from '../../core/runs/aborts.queue';

const TERMINAL_STATUSES = new Set([
  'passed',
  'failed',
  'error',
  'cancelled',
  'timed_out',
]);

@Injectable()
export class JenkinsWebhookService
  implements IJenkinsWebhookService, OnModuleInit
{
  private readonly logger = new Logger(JenkinsWebhookService.name);
  private secret!: Buffer;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly aborts: AbortsQueue,
  ) {}

  onModuleInit(): void {
    const s = this.config.getOrThrow<string>('JENKINS_WEBHOOK_SECRET');
    this.secret = Buffer.from(s, 'utf8');
  }

  async handle(
    event: JenkinsWebhookEventName,
    rawBody: Buffer,
    parsedBody: JenkinsWebhookPayload,
    headers: JenkinsWebhookHeaders,
  ): Promise<JenkinsWebhookResult> {
    // 1. Verify signature first — cheapest rejection.
    if (!this.verifySignature(rawBody, headers.signature)) {
      // Never attach `entity`/`entityId` on a rejected-signature row — the
      // payload is unverified and `test_run_id` could be attacker-controlled.
      // All metadata keys carry "unverified" semantics by name.
      const rawBodySha = createHash('sha256').update(rawBody).digest('hex');
      await this.audit.log({
        actorId: null,
        action: 'webhook_rejected_signature',
        ip: headers.ip,
        metadata: {
          event_header: headers.event,
          claimed_idempotency_key: headers.idempotencyKey,
          raw_body_sha256_prefix: rawBodySha.slice(0, 16),
        },
      });
      return { status: 'invalid_signature' };
    }

    // 2. Validate idempotency key is a UUID.
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      headers.idempotencyKey,
    )) {
      return { status: 'invalid_payload', detail: 'bad_idempotency_key' };
    }

    const payloadHash = createHash('sha256').update(rawBody).digest();
    const runId = (parsedBody as { test_run_id?: string }).test_run_id;
    if (!runId) {
      return { status: 'invalid_payload', detail: 'missing_test_run_id' };
    }
    const payloadError = validatePayload(event, parsedBody);
    if (payloadError) {
      return { status: 'invalid_payload', detail: payloadError };
    }

    // 3. Idempotency — insert then check recovery/duplicate.
    const existing = await this.prisma.webhookEvent.findUnique({
      where: { idempotency_key: headers.idempotencyKey },
    });
    if (existing) {
      if (!buffersEqual(existing.payload_hash, payloadHash)) {
        return { status: 'duplicate' };
      }
      if (existing.processed_at) {
        return { status: 'duplicate' };
      }
      // Recoverable retry: processed_at still null. Fall through to apply.
    }

    // 4. Dispatch by event inside a single transaction.
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        if (!existing) {
          try {
            await tx.webhookEvent.create({
              data: {
                idempotency_key: headers.idempotencyKey,
                payload_hash: payloadHash,
                event,
              },
            });
          } catch (err) {
            // Unique violation → another request won the race.
            if (isUniqueViolation(err)) {
              return { status: 'duplicate' } as JenkinsWebhookResult;
            }
            throw err;
          }
        }

        return this.applyEvent(tx, event, parsedBody, headers);
      });
      return result;
    } catch (err) {
      this.logger.error(
        `webhook processing failed for ${event}/${headers.idempotencyKey}: ${err instanceof Error ? err.message : String(err)}`,
      );
      // processed_at stays null → Jenkins retries with same key → recovery path.
      throw err;
    }
  }

  private async applyEvent(
    tx: Prisma.TransactionClient,
    event: JenkinsWebhookEventName,
    payload: JenkinsWebhookPayload,
    headers: JenkinsWebhookHeaders,
  ): Promise<JenkinsWebhookResult> {
    const runId = (payload as { test_run_id?: string }).test_run_id!;
    const run = await tx.testRun.findUnique({ where: { id: runId } });
    if (!run) {
      await tx.webhookEvent.update({
        where: { idempotency_key: headers.idempotencyKey },
        data: { processed_at: new Date() },
      });
      return { status: 'not_found' };
    }

    if (TERMINAL_STATUSES.has(run.status)) {
      // Per contract: mark processed, return 410. For late build_started with
      // a fresh jenkins_build_url, enqueue a best-effort abort.
      await tx.webhookEvent.update({
        where: { idempotency_key: headers.idempotencyKey },
        data: { processed_at: new Date() },
      });
      await this.audit.logWith(tx, {
        actorId: null,
        action: `webhook.${event}.terminal_ignored`,
        entity: 'test_run',
        entityId: runId,
        metadata: {
          stored_status: run.status,
          idempotency_key: headers.idempotencyKey,
        },
      });
      if (event === 'build_started') {
        const { jenkins_build_url } = payload as BuildStartedEvent;
        if (jenkins_build_url) {
          // enqueue outside the tx; pass the authoritative URL from the payload
          // so the abort targets the real live build (not a stale queue URL).
          setImmediate(() => {
            this.aborts
              .enqueue(runId, jenkins_build_url)
              .catch((e) =>
                this.logger.warn(`enqueue abort failed: ${describeErr(e)}`),
              );
          });
        }
      }
      return { status: 'terminal' };
    }

    switch (event) {
      case 'build_started':
        return this.handleBuildStarted(
          tx,
          run,
          payload as BuildStartedEvent,
          headers,
        );
      case 'heartbeat':
        return this.handleHeartbeat(
          tx,
          run,
          payload as HeartbeatEvent,
          headers,
        );
      case 'build_completed':
        return this.handleBuildCompleted(
          tx,
          run,
          payload as BuildCompletedEvent,
          headers,
        );
      case 'build_errored':
        return this.handleBuildErrored(
          tx,
          run,
          payload as BuildErroredEvent,
          headers,
        );
      default:
        return { status: 'invalid_payload', detail: `unknown event ${event}` };
    }
  }

  private async handleBuildStarted(
    tx: Prisma.TransactionClient,
    run: {
      id: string;
      status: string;
      runner_image_digest: string | null;
      tests_repo_commit_sha: string | null;
    },
    payload: BuildStartedEvent,
    headers: JenkinsWebhookHeaders,
  ): Promise<JenkinsWebhookResult> {
    // Pin equality check. Pins are write-once at trigger time.
    // Per state machine: mismatch → queued→error with reason='pin_mismatch' +
    // enqueue best-effort abort.
    const storedDigest = run.runner_image_digest ?? null;
    const storedTestsSha = run.tests_repo_commit_sha ?? null;
    const mismatchField =
      storedDigest && storedDigest !== payload.runner_image_digest
        ? 'runner_image_digest'
        : storedTestsSha && storedTestsSha !== payload.tests_repo_commit_sha
          ? 'tests_repo_commit_sha'
          : null;
    if (mismatchField) {
      const upd = await tx.testRun.updateMany({
        where: { id: run.id, status: 'queued' },
        data: {
          status: 'error',
          cancellation_reason: 'pin_mismatch',
          finished_at: new Date(),
          // Persist the URL the webhook reported so the reaper can re-enqueue
          // aborts if the Jenkins build is real.
          jenkins_build_url: payload.jenkins_build_url,
        },
      });
      await this.audit.logWith(tx, {
        actorId: null,
        action: 'webhook.build_started.pinning_mismatch',
        entity: 'test_run',
        entityId: run.id,
        metadata: {
          field: mismatchField,
          stored:
            mismatchField === 'runner_image_digest'
              ? storedDigest
              : storedTestsSha,
          received:
            mismatchField === 'runner_image_digest'
              ? payload.runner_image_digest
              : payload.tests_repo_commit_sha,
          jenkins_build_url: payload.jenkins_build_url,
          transitioned: upd.count === 1,
        },
      });
      await tx.webhookEvent.update({
        where: { idempotency_key: headers.idempotencyKey },
        data: { processed_at: new Date() },
      });
      // Enqueue abort outside tx to avoid holding Redis I/O inside Postgres tx.
      const payloadUrl = payload.jenkins_build_url;
      setImmediate(() => {
        this.aborts
          .enqueue(run.id, payloadUrl)
          .catch((e) =>
            this.logger.warn(`enqueue abort failed: ${describeErr(e)}`),
          );
      });
      // Per team-lead ruling: the state machine has already transitioned the
      // run to 'error', so this webhook is successfully processed from the
      // API's perspective. Return 200 processed — not 422 — so Jenkins does
      // not retry (pin mismatch is an infra bug, not a transient failure).
      return { status: 'processed' };
    }

    // queued → running (CAS)
    const upd = await tx.testRun.updateMany({
      where: { id: run.id, status: 'queued' },
      data: {
        status: 'running',
        started_at: new Date(payload.started_at),
        jenkins_build_url: payload.jenkins_build_url,
        // Allow populating pins if somehow still null (defensive). Never overwrites existing.
        ...(storedDigest
          ? {}
          : { runner_image_digest: payload.runner_image_digest }),
        ...(storedTestsSha
          ? {}
          : { tests_repo_commit_sha: payload.tests_repo_commit_sha }),
      },
    });
    if (upd.count === 0) {
      // Concurrent transition — surface as terminal-ish; re-read not necessary
      // because the outer terminal check already ran.
      return { status: 'terminal' };
    }
    await this.audit.logWith(tx, {
      actorId: null,
      action: 'runs.running',
      entity: 'test_run',
      entityId: run.id,
      metadata: { jenkins_build_url: payload.jenkins_build_url },
    });
    await tx.webhookEvent.update({
      where: { idempotency_key: headers.idempotencyKey },
      data: { processed_at: new Date() },
    });
    return { status: 'processed' };
  }

  private async handleHeartbeat(
    tx: Prisma.TransactionClient,
    run: { id: string; status: string },
    payload: HeartbeatEvent,
    headers: JenkinsWebhookHeaders,
  ): Promise<JenkinsWebhookResult> {
    // Only 'running' runs are updated. If 'queued' (shouldn't happen), ignore.
    const upd = await tx.testRun.updateMany({
      where: { id: run.id, status: 'running' },
      data: { heartbeat_at: new Date(payload.heartbeat_at) },
    });
    await tx.webhookEvent.update({
      where: { idempotency_key: headers.idempotencyKey },
      data: { processed_at: new Date() },
    });
    return upd.count > 0 ? { status: 'processed' } : { status: 'terminal' };
  }

  private async handleBuildCompleted(
    tx: Prisma.TransactionClient,
    run: { id: string; status: string },
    payload: BuildCompletedEvent,
    headers: JenkinsWebhookHeaders,
  ): Promise<JenkinsWebhookResult> {
    if (run.status !== 'running') {
      // Not in a legal transition state; mark processed, return terminal.
      await tx.webhookEvent.update({
        where: { idempotency_key: headers.idempotencyKey },
        data: { processed_at: new Date() },
      });
      return { status: 'terminal' };
    }

    const allPassed =
      payload.cases.length > 0 &&
      payload.cases.every((c) => c.status === 'passed');
    const anyFailed = payload.cases.some((c) => c.status === 'failed');
    const newStatus: 'passed' | 'failed' = anyFailed
      ? 'failed'
      : allPassed
        ? 'passed'
        : 'passed';

    const upd = await tx.testRun.updateMany({
      where: { id: run.id, status: 'running' },
      data: {
        status: newStatus,
        finished_at: new Date(payload.finished_at),
      },
    });
    if (upd.count === 0) {
      await tx.webhookEvent.update({
        where: { idempotency_key: headers.idempotencyKey },
        data: { processed_at: new Date() },
      });
      return { status: 'terminal' };
    }

    // Insert artifacts first so we can resolve artifact_ref → BuildArtifact.id.
    const artifactByKey = new Map<string, string>();
    const now = new Date();
    const defaultRetention = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    for (const a of payload.artifacts ?? []) {
      const id = ulid();
      artifactByKey.set(a.s3_key, id);
      await tx.buildArtifact.create({
        data: {
          id,
          test_run_id: run.id,
          kind: a.kind,
          s3_key: a.s3_key,
          size_bytes: BigInt(a.size_bytes),
          retention_until: defaultRetention,
        },
      });
    }

    for (const c of payload.cases) {
      const artifactRef = c.artifact_ref
        ? (artifactByKey.get(c.artifact_ref) ?? null)
        : null;
      await tx.testCaseResult.create({
        data: {
          id: ulid(),
          test_run_id: run.id,
          name: c.name,
          status: c.status,
          duration_ms: c.duration_ms,
          preview: c.preview,
          artifact_ref: artifactRef,
        },
      });
    }

    await this.audit.logWith(tx, {
      actorId: null,
      action: `runs.${newStatus}`,
      entity: 'test_run',
      entityId: run.id,
      metadata: {
        cases: payload.cases.length,
        artifacts: payload.artifacts?.length ?? 0,
      },
    });
    await tx.webhookEvent.update({
      where: { idempotency_key: headers.idempotencyKey },
      data: { processed_at: new Date() },
    });
    return { status: 'processed' };
  }

  private async handleBuildErrored(
    tx: Prisma.TransactionClient,
    run: { id: string; status: string },
    payload: BuildErroredEvent,
    headers: JenkinsWebhookHeaders,
  ): Promise<JenkinsWebhookResult> {
    if (run.status !== 'running') {
      await tx.webhookEvent.update({
        where: { idempotency_key: headers.idempotencyKey },
        data: { processed_at: new Date() },
      });
      return { status: 'terminal' };
    }

    const upd = await tx.testRun.updateMany({
      where: { id: run.id, status: 'running' },
      data: {
        status: 'error',
        cancellation_reason: payload.error,
        finished_at: new Date(payload.finished_at),
      },
    });
    if (upd.count === 0) {
      await tx.webhookEvent.update({
        where: { idempotency_key: headers.idempotencyKey },
        data: { processed_at: new Date() },
      });
      return { status: 'terminal' };
    }
    await this.audit.logWith(tx, {
      actorId: null,
      action: 'runs.error',
      entity: 'test_run',
      entityId: run.id,
      metadata: { error: payload.error, detail: payload.detail },
    });
    await tx.webhookEvent.update({
      where: { idempotency_key: headers.idempotencyKey },
      data: { processed_at: new Date() },
    });
    return { status: 'processed' };
  }

  private verifySignature(rawBody: Buffer, header: string): boolean {
    if (!header) return false;
    const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
    if (!m) return false;
    const provided = Buffer.from(m[1]!, 'hex');
    const expected = createHmac('sha256', this.secret)
      .update(rawBody)
      .digest();
    if (provided.length !== expected.length) return false;
    return timingSafeEqual(provided, expected);
  }
}

function buffersEqual(a: Buffer | Uint8Array, b: Buffer | Uint8Array): boolean {
  const ba = Buffer.isBuffer(a) ? a : Buffer.from(a);
  const bb = Buffer.isBuffer(b) ? b : Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string }).code;
  return code === 'P2002';
}

function describeErr(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

/**
 * Minimal runtime validator for webhook payloads. Returns null if valid,
 * else a machine-readable reason. Types come from api-core-contracts; this
 * only checks the shape the handler actually relies on.
 */
function validatePayload(
  event: JenkinsWebhookEventName,
  body: unknown,
): string | null {
  if (typeof body !== 'object' || body === null) return 'body_not_object';
  const p = body as Record<string, unknown>;
  if (typeof p.test_run_id !== 'string') return 'missing_test_run_id';
  switch (event) {
    case 'build_started':
      if (typeof p.jenkins_build_url !== 'string')
        return 'missing_jenkins_build_url';
      if (typeof p.started_at !== 'string') return 'missing_started_at';
      if (isNaN(Date.parse(p.started_at as string)))
        return 'invalid_started_at';
      if (typeof p.runner_image_digest !== 'string')
        return 'missing_runner_image_digest';
      if (typeof p.tests_repo_commit_sha !== 'string')
        return 'missing_tests_repo_commit_sha';
      return null;
    case 'heartbeat':
      if (typeof p.heartbeat_at !== 'string') return 'missing_heartbeat_at';
      if (isNaN(Date.parse(p.heartbeat_at as string)))
        return 'invalid_heartbeat_at';
      return null;
    case 'build_completed':
      if (typeof p.finished_at !== 'string') return 'missing_finished_at';
      if (isNaN(Date.parse(p.finished_at as string)))
        return 'invalid_finished_at';
      if (!Array.isArray(p.cases)) return 'missing_cases';
      for (const c of p.cases as unknown[]) {
        if (typeof c !== 'object' || c === null) return 'invalid_case_entry';
        const cc = c as Record<string, unknown>;
        if (typeof cc.name !== 'string') return 'case_missing_name';
        if (
          cc.status !== 'passed' &&
          cc.status !== 'failed' &&
          cc.status !== 'skipped'
        )
          return 'case_invalid_status';
        if (typeof cc.duration_ms !== 'number')
          return 'case_missing_duration_ms';
      }
      if (p.artifacts !== undefined) {
        if (!Array.isArray(p.artifacts)) return 'invalid_artifacts';
        for (const a of p.artifacts as unknown[]) {
          if (typeof a !== 'object' || a === null)
            return 'invalid_artifact_entry';
          const aa = a as Record<string, unknown>;
          if (
            aa.kind !== 'logs' &&
            aa.kind !== 'tarball' &&
            aa.kind !== 'junit'
          )
            return 'artifact_invalid_kind';
          if (typeof aa.s3_key !== 'string') return 'artifact_missing_s3_key';
          if (typeof aa.size_bytes !== 'number')
            return 'artifact_missing_size_bytes';
        }
      }
      return null;
    case 'build_errored':
      if (typeof p.finished_at !== 'string') return 'missing_finished_at';
      if (isNaN(Date.parse(p.finished_at as string)))
        return 'invalid_finished_at';
      if (typeof p.error !== 'string') return 'missing_error';
      return null;
    default:
      return 'unknown_event';
  }
}
