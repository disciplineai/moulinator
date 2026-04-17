import 'reflect-metadata';
import { createHmac } from 'crypto';
import { ConfigService } from '@nestjs/config';
import { JenkinsWebhookService } from './jenkins-webhook.service';
import type { AuditService } from '../../core/audit/audit.service';
import type { AbortsQueue } from '../../core/runs/aborts.queue';
import type { PrismaService } from '../../prisma/prisma.service';

const SECRET = 'webhook-secret';

/** Lightweight in-memory Prisma double. */
class PrismaDouble {
  testRuns = new Map<string, any>();
  webhookEvents = new Map<string, any>();
  testCaseResults: any[] = [];
  buildArtifacts: any[] = [];
  auditLogs: any[] = [];
  uniqueViolationOnNextCreate = false;

  get webhookEvent() {
    const self = this;
    return {
      findUnique: async ({
        where,
      }: {
        where: { idempotency_key: string };
      }) => self.webhookEvents.get(where.idempotency_key) ?? null,
      create: async ({ data }: { data: any }) => {
        if (self.uniqueViolationOnNextCreate) {
          self.uniqueViolationOnNextCreate = false;
          const e = new Error('unique') as any;
          e.code = 'P2002';
          throw e;
        }
        if (self.webhookEvents.has(data.idempotency_key)) {
          const e = new Error('unique') as any;
          e.code = 'P2002';
          throw e;
        }
        const row = { ...data, received_at: new Date(), processed_at: null };
        self.webhookEvents.set(data.idempotency_key, row);
        return row;
      },
      update: async ({
        where,
        data,
      }: {
        where: { idempotency_key: string };
        data: any;
      }) => {
        const row = self.webhookEvents.get(where.idempotency_key);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
    };
  }

  get testRun() {
    const self = this;
    return {
      findUnique: async ({ where }: { where: { id: string } }) =>
        self.testRuns.get(where.id) ?? null,
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; status?: string };
        data: any;
      }) => {
        const row = self.testRuns.get(where.id);
        if (!row) return { count: 0 };
        if (where.status && row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    };
  }

  get testCaseResult() {
    const self = this;
    return {
      create: async ({ data }: { data: any }) => {
        self.testCaseResults.push(data);
        return data;
      },
    };
  }

  get buildArtifact() {
    const self = this;
    return {
      create: async ({ data }: { data: any }) => {
        self.buildArtifacts.push(data);
        return data;
      },
    };
  }

  get auditLog() {
    const self = this;
    return {
      create: async ({ data }: { data: any }) => {
        self.auditLogs.push(data);
        return data;
      },
    };
  }

  async $transaction<T>(fn: (tx: PrismaDouble) => Promise<T>): Promise<T> {
    // Single-thread in-memory; no isolation needed.
    return fn(this);
  }
}

function sign(body: Buffer): string {
  return 'sha256=' + createHmac('sha256', SECRET).update(body).digest('hex');
}

function makeService() {
  const prisma = new PrismaDouble();
  const config = new ConfigService({ JENKINS_WEBHOOK_SECRET: SECRET });
  const audit = {
    log: jest.fn(async (entry: any) => {
      prisma.auditLogs.push(entry);
    }),
    logWith: jest.fn(async (_tx: any, entry: any) => {
      prisma.auditLogs.push(entry);
    }),
  } as unknown as AuditService;
  const aborts = {
    enqueue: jest.fn(async () => {}),
  } as unknown as AbortsQueue;
  const svc = new JenkinsWebhookService(
    config as unknown as ConfigService,
    prisma as unknown as PrismaService,
    audit,
    aborts,
  );
  svc.onModuleInit();
  return { svc, prisma, audit, aborts };
}

describe('JenkinsWebhookService', () => {
  const runId = '01J000000000000000000000AA';
  const digest = 'sha256:' + 'd'.repeat(64);
  const testsSha = 'f'.repeat(40);

  function seedQueuedRun(prisma: PrismaDouble) {
    prisma.testRuns.set(runId, {
      id: runId,
      status: 'queued',
      runner_image_digest: digest,
      tests_repo_commit_sha: testsSha,
      jenkins_build_url: null,
      started_at: null,
      finished_at: null,
      heartbeat_at: null,
      timeout_at: new Date(Date.now() + 600_000),
    });
  }

  it('rejects bad signature with sanitized audit (no entityId, unverified metadata)', async () => {
    const { svc, prisma } = makeService();
    seedQueuedRun(prisma);
    const body = Buffer.from(JSON.stringify({ test_run_id: runId, jenkins_build_url: 'x', started_at: '2026-04-17T12:00:00Z', runner_image_digest: digest, tests_repo_commit_sha: testsSha }));
    const res = await svc.handle(
      'build_started',
      body,
      JSON.parse(body.toString()) as any,
      {
        signature: 'sha256=' + '0'.repeat(64),
        idempotencyKey: '11111111-1111-1111-1111-111111111111',
        event: 'build_started',
        ip: '10.0.0.42',
      },
    );
    expect(res.status).toBe('invalid_signature');
    const rejected = prisma.auditLogs.find(
      (e) => e.action === 'webhook_rejected_signature',
    );
    expect(rejected).toBeTruthy();
    // F4 hardening: entity/entityId not attached because payload is unverified.
    expect(rejected.entity).toBeUndefined();
    expect(rejected.entityId).toBeUndefined();
    // Metadata keys renamed to show "unverified" semantics.
    expect(rejected.metadata).toEqual({
      event_header: 'build_started',
      claimed_idempotency_key: '11111111-1111-1111-1111-111111111111',
      raw_body_sha256_prefix: expect.stringMatching(/^[0-9a-f]{16}$/),
    });
    expect(rejected.ip).toBe('10.0.0.42');
  });

  it('applies build_started queued→running and audits', async () => {
    const { svc, prisma } = makeService();
    seedQueuedRun(prisma);
    const payload = {
      test_run_id: runId,
      jenkins_build_url: 'https://jenkins.test/42/',
      started_at: '2026-04-17T12:00:00Z',
      runner_image_digest: digest,
      tests_repo_commit_sha: testsSha,
    };
    const body = Buffer.from(JSON.stringify(payload));
    const res = await svc.handle('build_started', body, payload as any, {
      signature: sign(body),
      idempotencyKey: '22222222-2222-2222-2222-222222222222',
      event: 'build_started',
    });
    expect(res.status).toBe('processed');
    const run = prisma.testRuns.get(runId);
    expect(run.status).toBe('running');
    expect(run.jenkins_build_url).toBe(payload.jenkins_build_url);
    expect(prisma.webhookEvents.get('22222222-2222-2222-2222-222222222222').processed_at).toBeTruthy();
    expect(
      prisma.auditLogs.some((e) => e.action === 'runs.running'),
    ).toBe(true);
  });

  it('transitions queued→error with reason=pin_mismatch when pins differ', async () => {
    const { svc, prisma, aborts } = makeService();
    seedQueuedRun(prisma);
    const payload = {
      test_run_id: runId,
      jenkins_build_url: 'https://jenkins.test/42/',
      started_at: '2026-04-17T12:00:00Z',
      runner_image_digest: 'sha256:' + 'e'.repeat(64),
      tests_repo_commit_sha: testsSha,
    };
    const body = Buffer.from(JSON.stringify(payload));
    const res = await svc.handle('build_started', body, payload as any, {
      signature: sign(body),
      idempotencyKey: '33333333-3333-3333-3333-333333333333',
      event: 'build_started',
    });
    expect(res.status).toBe('processed');
    const run = prisma.testRuns.get(runId);
    expect(run.status).toBe('error');
    expect(run.cancellation_reason).toBe('pin_mismatch');
    expect(run.jenkins_build_url).toBe('https://jenkins.test/42/');
    expect(
      prisma.webhookEvents.get('33333333-3333-3333-3333-333333333333')
        .processed_at,
    ).toBeTruthy();
    expect(
      prisma.auditLogs.some(
        (e) => e.action === 'webhook.build_started.pinning_mismatch',
      ),
    ).toBe(true);
    // Abort enqueue happens in setImmediate and uses the payload URL.
    await new Promise((r) => setImmediate(r));
    expect((aborts.enqueue as jest.Mock).mock.calls[0]).toEqual([
      runId,
      'https://jenkins.test/42/',
    ]);
  });

  it('build_completed transitions running→passed and writes results + artifacts', async () => {
    const { svc, prisma } = makeService();
    seedQueuedRun(prisma);
    // Move to running.
    const startPayload = {
      test_run_id: runId,
      jenkins_build_url: 'https://jenkins.test/42/',
      started_at: '2026-04-17T12:00:00Z',
      runner_image_digest: digest,
      tests_repo_commit_sha: testsSha,
    };
    const startBody = Buffer.from(JSON.stringify(startPayload));
    await svc.handle('build_started', startBody, startPayload as any, {
      signature: sign(startBody),
      idempotencyKey: '44444444-4444-4444-4444-444444444444',
      event: 'build_started',
    });
    // Heartbeat.
    const hbPayload = {
      test_run_id: runId,
      heartbeat_at: '2026-04-17T12:00:30Z',
    };
    const hbBody = Buffer.from(JSON.stringify(hbPayload));
    const hbRes = await svc.handle('heartbeat', hbBody, hbPayload as any, {
      signature: sign(hbBody),
      idempotencyKey: '55555555-5555-5555-5555-555555555555',
      event: 'heartbeat',
    });
    expect(hbRes.status).toBe('processed');
    expect(prisma.testRuns.get(runId).heartbeat_at).toBeInstanceOf(Date);

    const completedPayload = {
      test_run_id: runId,
      finished_at: '2026-04-17T12:02:15Z',
      cases: [
        { name: 'a', status: 'passed', duration_ms: 10 },
        { name: 'b', status: 'passed', duration_ms: 12, artifact_ref: 'logs/x/b.log' },
      ],
      artifacts: [
        { kind: 'logs', s3_key: 'logs/x/full.log', size_bytes: 1024 },
      ],
    };
    const body = Buffer.from(JSON.stringify(completedPayload));
    const res = await svc.handle(
      'build_completed',
      body,
      completedPayload as any,
      {
        signature: sign(body),
        idempotencyKey: '66666666-6666-6666-6666-666666666666',
        event: 'build_completed',
      },
    );
    expect(res.status).toBe('processed');
    const run = prisma.testRuns.get(runId);
    expect(run.status).toBe('passed');
    expect(prisma.testCaseResults).toHaveLength(2);
    expect(prisma.buildArtifacts).toHaveLength(1);
    // artifact_ref without matching s3_key → null
    expect(prisma.testCaseResults[1].artifact_ref).toBeNull();
  });

  it('build_completed → failed when any case failed', async () => {
    const { svc, prisma } = makeService();
    seedQueuedRun(prisma);
    prisma.testRuns.get(runId).status = 'running';
    const p = {
      test_run_id: runId,
      finished_at: '2026-04-17T12:02:15Z',
      cases: [
        { name: 'a', status: 'passed', duration_ms: 10 },
        { name: 'b', status: 'failed', duration_ms: 12 },
      ],
    };
    const body = Buffer.from(JSON.stringify(p));
    const res = await svc.handle('build_completed', body, p as any, {
      signature: sign(body),
      idempotencyKey: '77777777-7777-7777-7777-777777777777',
      event: 'build_completed',
    });
    expect(res.status).toBe('processed');
    expect(prisma.testRuns.get(runId).status).toBe('failed');
  });

  it('duplicate idempotency key returns duplicate and does not re-transition', async () => {
    const { svc, prisma } = makeService();
    seedQueuedRun(prisma);
    const payload = {
      test_run_id: runId,
      jenkins_build_url: 'https://jenkins.test/42/',
      started_at: '2026-04-17T12:00:00Z',
      runner_image_digest: digest,
      tests_repo_commit_sha: testsSha,
    };
    const body = Buffer.from(JSON.stringify(payload));
    const h = {
      signature: sign(body),
      idempotencyKey: '88888888-8888-8888-8888-888888888888',
      event: 'build_started' as const,
    };
    const a = await svc.handle('build_started', body, payload as any, h);
    expect(a.status).toBe('processed');
    const b = await svc.handle('build_started', body, payload as any, h);
    expect(b.status).toBe('duplicate');
    expect(prisma.testRuns.get(runId).status).toBe('running');
  });

  it('terminal run returns terminal and enqueues abort on build_started', async () => {
    const { svc, prisma, aborts } = makeService();
    prisma.testRuns.set(runId, {
      id: runId,
      status: 'cancelled',
      runner_image_digest: digest,
      tests_repo_commit_sha: testsSha,
      jenkins_build_url: null,
    });
    const payload = {
      test_run_id: runId,
      jenkins_build_url: 'https://jenkins.test/99/',
      started_at: '2026-04-17T12:00:00Z',
      runner_image_digest: digest,
      tests_repo_commit_sha: testsSha,
    };
    const body = Buffer.from(JSON.stringify(payload));
    const res = await svc.handle('build_started', body, payload as any, {
      signature: sign(body),
      idempotencyKey: '99999999-9999-9999-9999-999999999999',
      event: 'build_started',
    });
    expect(res.status).toBe('terminal');
    expect(prisma.testRuns.get(runId).status).toBe('cancelled');
    // Abort enqueued in next tick.
    await new Promise((r) => setImmediate(r));
    expect((aborts.enqueue as jest.Mock).mock.calls[0]?.[0]).toBe(runId);
  });

  it('build_errored transitions running → error', async () => {
    const { svc, prisma } = makeService();
    seedQueuedRun(prisma);
    prisma.testRuns.get(runId).status = 'running';
    const p = {
      test_run_id: runId,
      finished_at: '2026-04-17T12:01:00Z',
      error: 'runner_image_pull_failed',
      detail: 'manifest not found',
    };
    const body = Buffer.from(JSON.stringify(p));
    const res = await svc.handle('build_errored', body, p as any, {
      signature: sign(body),
      idempotencyKey: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
      event: 'build_errored',
    });
    expect(res.status).toBe('processed');
    const run = prisma.testRuns.get(runId);
    expect(run.status).toBe('error');
    expect(run.cancellation_reason).toBe('runner_image_pull_failed');
  });

  it('rejects malformed idempotency key', async () => {
    const { svc, prisma } = makeService();
    seedQueuedRun(prisma);
    const body = Buffer.from('{}');
    const res = await svc.handle('heartbeat', body, {} as any, {
      signature: sign(body),
      idempotencyKey: 'not-a-uuid',
      event: 'heartbeat',
    });
    expect(res.status).toBe('invalid_payload');
  });

  it('rejects build_completed missing cases array without crashing', async () => {
    const { svc, prisma } = makeService();
    seedQueuedRun(prisma);
    prisma.testRuns.get(runId).status = 'running';
    const p = { test_run_id: runId, finished_at: '2026-04-17T12:02:15Z' };
    const body = Buffer.from(JSON.stringify(p));
    const res = await svc.handle('build_completed', body, p as any, {
      signature: sign(body),
      idempotencyKey: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
      event: 'build_completed',
    });
    expect(res.status).toBe('invalid_payload');
    if (res.status === 'invalid_payload') {
      expect(res.detail).toBe('missing_cases');
    }
    // Run should still be in 'running' — no state mutation.
    expect(prisma.testRuns.get(runId).status).toBe('running');
  });

  it('rejects build_started with invalid timestamp', async () => {
    const { svc, prisma } = makeService();
    seedQueuedRun(prisma);
    const payload = {
      test_run_id: runId,
      jenkins_build_url: 'https://j/',
      started_at: 'not-a-date',
      runner_image_digest: digest,
      tests_repo_commit_sha: testsSha,
    };
    const body = Buffer.from(JSON.stringify(payload));
    const res = await svc.handle('build_started', body, payload as any, {
      signature: sign(body),
      idempotencyKey: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
      event: 'build_started',
    });
    expect(res.status).toBe('invalid_payload');
  });
});
