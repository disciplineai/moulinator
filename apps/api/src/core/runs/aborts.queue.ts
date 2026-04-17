import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Queue, Worker, type Job } from 'bullmq';
import IORedis, { type Redis } from 'ioredis';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { JenkinsClient } from '../jenkins/jenkins.client';

const QUEUE_NAME = 'runs-aborts';

interface AbortJob {
  testRunId: string;
  jenkinsBuildUrl: string;
}

@Injectable()
export class AbortsQueue implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AbortsQueue.name);
  private connection!: Redis;
  private queue!: Queue<AbortJob>;
  private worker!: Worker<AbortJob>;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly jenkins: JenkinsClient,
    private readonly audit: AuditService,
  ) {}

  async onModuleInit(): Promise<void> {
    if (process.env.MOULINATOR_DISABLE_QUEUES === '1') return;
    const url = this.config.getOrThrow<string>('REDIS_URL');
    this.connection = new IORedis(url, { maxRetriesPerRequest: null });
    this.queue = new Queue<AbortJob>(QUEUE_NAME, {
      connection: this.connection,
    });
    this.worker = new Worker<AbortJob>(
      QUEUE_NAME,
      async (job) => this.process(job),
      {
        connection: this.connection,
        concurrency: 4,
      },
    );
    this.worker.on('failed', (job, err) => {
      this.logger.warn(
        `abort job ${job?.id} failed: ${err.message} (attempts=${job?.attemptsMade})`,
      );
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.worker?.close().catch(() => {});
    await this.queue?.close().catch(() => {});
    await this.connection?.quit().catch(() => {});
  }

  /**
   * Enqueue an abort for a test run. Caller may pass the authoritative
   * jenkinsBuildUrl (e.g. from a late build_started webhook payload) — this
   * takes priority over whatever is stored on the TestRun row. If no URL is
   * passed and the DB doesn't have one yet, the enqueue is a no-op.
   *
   * Deduplicates on testRunId via jobId, but if a fresh URL is supplied and
   * differs from a previously enqueued one, we cancel the stale job and
   * re-enqueue so the newer URL wins.
   */
  async enqueue(testRunId: string, jenkinsBuildUrl?: string): Promise<void> {
    if (!this.queue) return;
    let url = jenkinsBuildUrl;
    if (!url) {
      const run = await this.prisma.testRun.findUnique({
        where: { id: testRunId },
      });
      url = run?.jenkins_build_url ?? undefined;
    }
    if (!url) return;

    const jobId = `abort:${testRunId}`;
    if (jenkinsBuildUrl) {
      // Caller asserted this URL is the authoritative one. If a prior job
      // exists with a different URL, remove it so the new URL can be retried.
      const existing = await this.queue.getJob(jobId);
      if (existing && existing.data.jenkinsBuildUrl !== jenkinsBuildUrl) {
        await existing.remove().catch(() => {});
      }
    }
    await this.queue.add(
      'abort',
      { testRunId, jenkinsBuildUrl: url },
      {
        jobId,
        attempts: 10,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  }

  private async process(job: Job<AbortJob>): Promise<void> {
    const { testRunId, jenkinsBuildUrl } = job.data;
    this.logger.log(
      `abort attempt ${job.attemptsMade + 1} for run=${testRunId}`,
    );
    try {
      await this.jenkins.abortBuild(jenkinsBuildUrl);
      await this.audit.log({
        actorId: null,
        action: 'runs.abort_ok',
        entity: 'test_run',
        entityId: testRunId,
        metadata: { attempts: job.attemptsMade + 1 },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      await this.audit.log({
        actorId: null,
        action: 'runs.abort_failed',
        entity: 'test_run',
        entityId: testRunId,
        metadata: { attempts: job.attemptsMade + 1, reason: msg },
      });
      throw err;
    }
  }
}
