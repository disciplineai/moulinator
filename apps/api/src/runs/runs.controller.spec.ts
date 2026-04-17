import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import {
  AUDIT_SERVICE,
  RUNS_ORCHESTRATOR,
} from '@moulinator/api-core-contracts';
import { RunsController } from './runs.controller';
import { RunsService } from './runs.service';
import { PrismaService } from '../prisma/prisma.service';

describe('RunsController', () => {
  let controller: RunsController;
  let prisma: {
    repository: { findUnique: jest.Mock };
    testRun: { findUnique: jest.Mock; findMany: jest.Mock };
    testCaseResult: { findMany: jest.Mock };
  };
  let orchestrator: { triggerRun: jest.Mock; cancelRun: jest.Mock };
  let audit: { log: jest.Mock };

  const authedUser = { id: 'OWNER_ULID_26', email: 'a@b.co', role: 'student' as const };

  beforeEach(async () => {
    prisma = {
      repository: { findUnique: jest.fn() },
      testRun: { findUnique: jest.fn(), findMany: jest.fn() },
      testCaseResult: { findMany: jest.fn() },
    };
    orchestrator = {
      triggerRun: jest.fn(),
      cancelRun: jest.fn().mockResolvedValue(undefined),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      controllers: [RunsController],
      providers: [
        RunsService,
        { provide: PrismaService, useValue: prisma },
        { provide: RUNS_ORCHESTRATOR, useValue: orchestrator },
        { provide: AUDIT_SERVICE, useValue: audit },
      ],
    }).compile();

    controller = moduleRef.get(RunsController);
  });

  describe('trigger', () => {
    it('delegates to orchestrator and returns the created run', async () => {
      prisma.repository.findUnique.mockResolvedValue({
        id: 'REPO_ID',
        user_id: authedUser.id,
      });
      orchestrator.triggerRun.mockResolvedValue({
        runId: 'RUN_ID',
        correlationId: 'c-1',
        timeoutAt: new Date('2026-04-18T00:00:00Z'),
      });
      prisma.testRun.findUnique.mockResolvedValue({
        id: 'RUN_ID',
        repo_id: 'REPO_ID',
        commit_sha: 'a'.repeat(40),
        tests_repo_commit_sha: null,
        runner_image_digest: null,
        status: 'queued',
        cancellation_reason: null,
        jenkins_build_url: null,
        correlation_id: 'c-1',
        heartbeat_at: null,
        started_at: null,
        finished_at: null,
        timeout_at: new Date('2026-04-18T00:00:00Z'),
        created_at: new Date('2026-04-17T00:00:00Z'),
      });

      const run = await controller.trigger(
        authedUser,
        { repo_id: 'REPO_ID', commit_sha: 'a'.repeat(40) },
        '127.0.0.1',
      );
      expect(run.id).toBe('RUN_ID');
      expect(run.status).toBe('queued');
      expect(orchestrator.triggerRun).toHaveBeenCalledWith({
        userId: authedUser.id,
        repoId: 'REPO_ID',
        commitSha: 'a'.repeat(40),
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'runs.trigger' }),
      );
    });

    it('404s when repo belongs to someone else', async () => {
      prisma.repository.findUnique.mockResolvedValue({
        id: 'REPO_ID',
        user_id: 'SOMEONE_ELSE',
      });
      await expect(
        controller.trigger(
          authedUser,
          { repo_id: 'REPO_ID', commit_sha: 'a'.repeat(40) },
          '127.0.0.1',
        ),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('cancel', () => {
    it('409s if run already terminal', async () => {
      prisma.testRun.findUnique.mockResolvedValue({
        id: 'RUN_ID',
        status: 'passed',
        repo: { user_id: authedUser.id },
      });
      await expect(
        controller.cancel(authedUser, 'RUN_ID', '127.0.0.1'),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(orchestrator.cancelRun).not.toHaveBeenCalled();
    });

    it('delegates cancel to orchestrator when running', async () => {
      prisma.testRun.findUnique.mockResolvedValue({
        id: 'RUN_ID',
        status: 'running',
        repo: { user_id: authedUser.id },
      });
      await expect(
        controller.cancel(authedUser, 'RUN_ID', '127.0.0.1'),
      ).resolves.toBeUndefined();
      expect(orchestrator.cancelRun).toHaveBeenCalledWith('RUN_ID', 'user_cancelled');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'runs.cancel' }),
      );
    });
  });
});
