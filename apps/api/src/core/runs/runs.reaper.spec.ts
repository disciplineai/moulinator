import 'reflect-metadata';
import { ConfigService } from '@nestjs/config';
import { RunsReaper } from './runs.reaper';

class PrismaMock {
  runs: any[] = [];
  auditLogs: any[] = [];
  get testRun() {
    const self = this;
    return {
      findMany: async ({ where, take }: any) => {
        const now = new Date();
        const filtered = self.runs.filter((r) => {
          // Scan for stuck-queued rows.
          if (where.status === 'queued') {
            if (r.status !== 'queued') return false;
            if (where.timeout_at?.lt && r.timeout_at < where.timeout_at.lt)
              return true;
            return false;
          }
          // Scan for terminal runs with a jenkins_build_url.
          if (where.status?.in) {
            if (!where.status.in.includes(r.status)) return false;
            if (!r.jenkins_build_url) return false;
            if (where.finished_at?.gt && r.finished_at <= where.finished_at.gt)
              return false;
            return true;
          }
          // Scan for stale running rows.
          const heartbeatCutoff = where.OR?.[0]?.heartbeat_at?.lt;
          const startedCutoff = where.OR?.[1]?.started_at?.lt;
          const timeoutCutoff = where.OR?.[2]?.timeout_at?.lt;
          if (r.status !== 'running') return false;
          if (heartbeatCutoff && r.heartbeat_at && r.heartbeat_at < heartbeatCutoff)
            return true;
          if (
            startedCutoff &&
            r.heartbeat_at === null &&
            r.started_at &&
            r.started_at < startedCutoff
          )
            return true;
          if (timeoutCutoff && r.timeout_at < now) return true;
          return false;
        });
        return take ? filtered.slice(0, take) : filtered;
      },
      updateMany: async ({ where, data }: any) => {
        const row = self.runs.find((r) => r.id === where.id);
        if (!row) return { count: 0 };
        if (where.status && row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    };
  }
  get auditLog() {
    const self = this;
    return {
      create: async ({ data }: any) => {
        self.auditLogs.push(data);
        return data;
      },
    };
  }
  async $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

describe('RunsReaper.sweep', () => {
  it('transitions a running run with stale heartbeat → timed_out', async () => {
    const prisma = new PrismaMock();
    const now = new Date();
    prisma.runs.push({
      id: 'r1',
      status: 'running',
      heartbeat_at: new Date(now.getTime() - 10 * 60 * 1000),
      timeout_at: new Date(now.getTime() + 60 * 60 * 1000),
      started_at: new Date(now.getTime() - 15 * 60 * 1000),
    });
    const aborts = { enqueue: jest.fn(async () => {}) };
    const audit = {
      log: jest.fn(async () => {}),
      logWith: jest.fn(async (_tx, entry) => {
        prisma.auditLogs.push(entry);
      }),
    } as any;
    const reaper = new RunsReaper(
      new ConfigService({ HEARTBEAT_TIMEOUT_SECONDS: '120', REDIS_URL: 'x' }) as any,
      prisma as any,
      audit,
      aborts as any,
    );
    const res = await reaper.sweep();
    expect(res.timedOut).toBe(1);
    expect(prisma.runs[0].status).toBe('timed_out');
    expect(prisma.runs[0].cancellation_reason).toBe('heartbeat_timeout');
  });

  it('transitions a running run past its wall-clock timeout → timed_out', async () => {
    const prisma = new PrismaMock();
    const now = new Date();
    prisma.runs.push({
      id: 'r2',
      status: 'running',
      heartbeat_at: new Date(now.getTime() - 5_000),
      timeout_at: new Date(now.getTime() - 60_000),
      started_at: new Date(now.getTime() - 10 * 60 * 1000),
    });
    const audit = {
      log: jest.fn(async () => {}),
      logWith: jest.fn(async () => {}),
    } as any;
    const aborts = { enqueue: jest.fn(async () => {}) };
    const reaper = new RunsReaper(
      new ConfigService({ HEARTBEAT_TIMEOUT_SECONDS: '120', REDIS_URL: 'x' }) as any,
      prisma as any,
      audit,
      aborts as any,
    );
    const res = await reaper.sweep();
    expect(res.timedOut).toBe(1);
    expect(prisma.runs[0].status).toBe('timed_out');
    expect(prisma.runs[0].cancellation_reason).toBe('wall_clock_timeout');
  });

  it('transitions stuck queued rows past timeout_at → error (timeout_before_start)', async () => {
    const prisma = new PrismaMock();
    const now = new Date();
    prisma.runs.push({
      id: 'rq',
      status: 'queued',
      timeout_at: new Date(now.getTime() - 60_000),
    });
    const audit = {
      log: jest.fn(async () => {}),
      logWith: jest.fn(async (_tx: any, entry: any) => {
        prisma.auditLogs.push(entry);
      }),
    } as any;
    const aborts = { enqueue: jest.fn(async () => {}) };
    const reaper = new RunsReaper(
      new ConfigService({ HEARTBEAT_TIMEOUT_SECONDS: '120', REDIS_URL: 'x' }) as any,
      prisma as any,
      audit,
      aborts as any,
    );
    const res = await reaper.sweep();
    expect(res.queuedToError).toBe(1);
    expect(prisma.runs[0].status).toBe('error');
    expect(prisma.runs[0].cancellation_reason).toBe('timeout_before_start');
  });

  it('re-enqueues abort jobs for terminal runs with a jenkins_build_url', async () => {
    const prisma = new PrismaMock();
    const now = new Date();
    prisma.runs.push({
      id: 'r3',
      status: 'cancelled',
      jenkins_build_url: 'https://j/1',
      finished_at: new Date(now.getTime() - 10_000),
    });
    const aborts = { enqueue: jest.fn(async () => {}) };
    const audit = {
      log: jest.fn(async () => {}),
      logWith: jest.fn(async () => {}),
    } as any;
    const reaper = new RunsReaper(
      new ConfigService({ HEARTBEAT_TIMEOUT_SECONDS: '120', REDIS_URL: 'x' }) as any,
      prisma as any,
      audit,
      aborts as any,
    );
    const res = await reaper.sweep();
    expect(res.abortsRequeued).toBe(1);
    expect(aborts.enqueue).toHaveBeenCalledWith('r3');
  });
});
