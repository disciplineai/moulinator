import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AUDIT_SERVICE,
  RUNS_ORCHESTRATOR,
  type IAuditService,
  type IRunsOrchestrator,
  type RunDto,
  type RunListDto,
  type TestCaseResultDto,
} from '@moulinator/api-core-contracts';
import { PrismaService } from '../prisma/prisma.service';
import {
  clampLimit,
  decodeCursor,
  encodeCursor,
  InvalidCursorError,
} from '../common/pagination';
import { caseRowToDto, runRowToDto } from './mapper';

const TERMINAL_STATUSES: ReadonlySet<string> = new Set([
  'passed',
  'failed',
  'error',
  'cancelled',
  'timed_out',
]);

@Injectable()
export class RunsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(RUNS_ORCHESTRATOR) private readonly orchestrator: IRunsOrchestrator,
    @Inject(AUDIT_SERVICE) private readonly audit: IAuditService,
  ) {}

  async trigger(
    userId: string,
    repoId: string,
    commitSha: string,
    ip?: string,
  ): Promise<RunDto> {
    const repo = await this.prisma.repository.findUnique({ where: { id: repoId } });
    if (!repo || repo.user_id !== userId) {
      throw new NotFoundException({ error: 'repo_not_found' });
    }

    const { runId } = await this.orchestrator.triggerRun({
      userId,
      repoId,
      commitSha,
    });
    const created = await this.prisma.testRun.findUnique({ where: { id: runId } });
    if (!created) {
      throw new NotFoundException({ error: 'run_not_found_after_trigger' });
    }
    await this.audit.log({
      actorId: userId,
      action: 'runs.trigger',
      entity: 'test_run',
      entityId: runId,
      ip,
    });
    return runRowToDto(created);
  }

  async get(userId: string, id: string): Promise<RunDto> {
    const row = await this.prisma.testRun.findUnique({
      where: { id },
      include: { repo: true },
    });
    if (!row || row.repo.user_id !== userId) {
      throw new NotFoundException({ error: 'run_not_found' });
    }
    return runRowToDto(row);
  }

  async cancel(userId: string, id: string, ip?: string): Promise<void> {
    const row = await this.prisma.testRun.findUnique({
      where: { id },
      include: { repo: true },
    });
    if (!row || row.repo.user_id !== userId) {
      throw new NotFoundException({ error: 'run_not_found' });
    }
    if (TERMINAL_STATUSES.has(row.status)) {
      throw new ConflictException({
        error: 'run_terminal',
        message: `run is already ${row.status}`,
      });
    }
    await this.orchestrator.cancelRun(id, 'user_cancelled');
    await this.audit.log({
      actorId: userId,
      action: 'runs.cancel',
      entity: 'test_run',
      entityId: id,
      ip,
    });
  }

  async listForRepo(
    userId: string,
    repoId: string,
    cursor?: string,
    limit?: number,
  ): Promise<RunListDto> {
    const repo = await this.prisma.repository.findUnique({ where: { id: repoId } });
    if (!repo || repo.user_id !== userId) {
      throw new NotFoundException({ error: 'repo_not_found' });
    }

    const take = clampLimit(limit);
    let decoded;
    try {
      decoded = decodeCursor(cursor);
    } catch (err) {
      if (err instanceof InvalidCursorError) {
        throw new UnprocessableEntityException({ error: 'invalid_cursor' });
      }
      throw err;
    }
    const rows = await this.prisma.testRun.findMany({
      where: {
        repo_id: repoId,
        ...(decoded
          ? {
              OR: [
                { created_at: { lt: new Date(decoded.createdAt) } },
                {
                  created_at: new Date(decoded.createdAt),
                  id: { lt: decoded.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: take + 1,
    });

    const hasMore = rows.length > take;
    const page = hasMore ? rows.slice(0, take) : rows;
    const last = page[page.length - 1];
    const next_cursor =
      hasMore && last
        ? encodeCursor({ createdAt: last.created_at.toISOString(), id: last.id })
        : null;
    return { items: page.map((r) => runRowToDto(r)), next_cursor };
  }

  async listResults(userId: string, runId: string): Promise<TestCaseResultDto[]> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      include: { repo: true },
    });
    if (!run || run.repo.user_id !== userId) {
      throw new NotFoundException({ error: 'run_not_found' });
    }
    const cases = await this.prisma.testCaseResult.findMany({
      where: { test_run_id: runId },
      orderBy: [{ created_at: 'asc' }, { id: 'asc' }],
    });
    return cases.map((c) => caseRowToDto(c));
  }
}
