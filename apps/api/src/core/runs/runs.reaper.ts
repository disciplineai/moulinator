import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AbortsQueue } from './aborts.queue';

const QUEUE_NAME = 'runs-reaper';
const JOB_NAME = 'sweep';

/**
 * Periodic reaper that:
 *  • transitions running rows with stale heartbeats or past timeout_at → timed_out
 *  • re-enqueues abort jobs for terminal rows that still have a live jenkins_build_url
 */
@Injectable()
export class RunsReaper implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RunsReaper.name);
  private connection!: Redis;
  private queue!: Queue;
  private worker!: Worker;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly aborts: AbortsQueue,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.MOULINATOR_DISABLE_QUEUES === '1') return;
    const url = this.config.getOrThrow<string>('REDIS_URL');
    this.connection = new IORedis(url, { maxRetriesPerRequest: null });
    this.queue = new Queue(QUEUE_NAME, { connection: this.connection });

    // Every 60s. Repeatable jobs are idempotent; previous jobs are cleaned up.
    await this.queue.add(
      JOB_NAME,
      {},
      {
        repeat: { every: 60_000 },
        jobId: `${JOB_NAME}:tick`,
        removeOnComplete: 50,
        removeOnFail: 50,
      },
    );
    this.worker = new Worker(
      QUEUE_NAME,
      async () => this.sweep(),
      { connection: this.connection, concurrency: 1 },
    );
    this.worker.on('failed', (_job, err) => {
      this.logger.warn(`reaper sweep failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => {});
    await this.queue?.close().catch(() => {});
    await this.connection?.quit().catch(() => {});
  }

  /** Exposed for tests. */
  async sweep(): Promise<{
    timedOut: number;
    queuedToError: number;
    abortsRequeued: number;
  }> {
    const heartbeatTimeout = Number(
      this.config.get<string>('HEARTBEAT_TIMEOUT_SECONDS') ?? '120',
    );
    const now = new Date();
    const heartbeatCutoff = new Date(now.getTime() - heartbeatTimeout * 1000);

    // Scan 1+2: running rows with stale heartbeat OR past wall-clock.
    let timedOut = 0;
    const stale = await this.prisma.testRun.findMany({
      where: {
        status: 'running',
        OR: [
          { heartbeat_at: { lt: heartbeatCutoff } },
          { heartbeat_at: null, started_at: { lt: heartbeatCutoff } },
          { timeout_at: { lt: now } },
        ],
      },
      select: { id: true, timeout_at: true, heartbeat_at: true },
    });
    for (const row of stale) {
      const reason =
        row.timeout_at < now ? 'wall_clock_timeout' : 'heartbeat_timeout';
      const res = await this.transitionRunningToTimedOut(row.id, reason);
      if (res) timedOut += 1;
    }

    // Scan 3: queued rows past timeout_at (Jenkins never ACKd build_started).
    let queuedToError = 0;
    const stuckQueued = await this.prisma.testRun.findMany({
      where: { status: 'queued', timeout_at: { lt: now } },
      select: { id: true },
      take: 100,
    });
    for (const row of stuckQueued) {
      const res = await this.transitionQueuedToError(
        row.id,
        'timeout_before_start',
      );
      if (res) queuedToError += 1;
    }

    // Re-enqueue aborts for terminal runs that still have a build URL.
    const terminalWithUrl = await this.prisma.testRun.findMany({
      where: {
        status: { in: ['cancelled', 'timed_out', 'error'] },
        jenkins_build_url: { not: null },
        // Bound the scan; old runs should already have been aborted.
        finished_at: {
          gt: new Date(now.getTime() - 24 * 60 * 60 * 1000),
        },
      },
      select: { id: true },
      take: 100,
    });
    for (const row of terminalWithUrl) {
      await this.aborts.enqueue(row.id).catch(() => {});
    }
    return {
      timedOut,
      queuedToError,
      abortsRequeued: terminalWithUrl.length,
    };
  }

  private async transitionQueuedToError(
    runId: string,
    reason: string,
  ): Promise<boolean> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const upd = await tx.testRun.updateMany({
        where: { id: runId, status: 'queued' },
        data: {
          status: 'error',
          cancellation_reason: reason,
          finished_at: now,
        },
      });
      if (upd.count === 0) return false;
      await this.audit.logWith(tx, {
        actorId: null,
        action: 'runs.queued_to_error',
        entity: 'test_run',
        entityId: runId,
        metadata: { reason },
      });
      return true;
    });
  }

  private async transitionRunningToTimedOut(
    runId: string,
    reason: string,
  ): Promise<boolean> {
    const now = new Date();
    return this.prisma.$transaction(async (tx) => {
      const upd = await tx.testRun.updateMany({
        where: { id: runId, status: 'running' },
        data: {
          status: 'timed_out',
          cancellation_reason: reason,
          finished_at: now,
        },
      });
      if (upd.count === 0) return false;
      await this.audit.logWith(tx, {
        actorId: null,
        action: 'runs.timed_out',
        entity: 'test_run',
        entityId: runId,
        metadata: { reason },
      });
      return true;
    });
  }
}
