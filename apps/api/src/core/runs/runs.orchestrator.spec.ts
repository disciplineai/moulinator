import 'reflect-metadata';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { RunsOrchestrator } from './runs.orchestrator';

class PrismaMock {
  repositories = new Map<string, any>();
  credentials: any[] = [];
  testRuns = new Map<string, any>();
  artifacts: any[] = [];
  auditLogs: any[] = [];
  activeCount = 0;

  get repository() {
    const self = this;
    return {
      findUnique: async ({ where }: any) => self.repositories.get(where.id) ?? null,
    };
  }
  get githubCredential() {
    const self = this;
    return {
      findFirst: async () => self.credentials[0] ?? null,
    };
  }
  get testRun() {
    const self = this;
    return {
      count: async () => self.activeCount,
      create: async ({ data }: any) => {
        self.testRuns.set(data.id, { ...data });
        return self.testRuns.get(data.id);
      },
      findUnique: async ({ where }: any) =>
        self.testRuns.get(where.id) ?? null,
      update: async ({ where, data }: any) => {
        const row = self.testRuns.get(where.id);
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        const row = self.testRuns.get(where.id);
        if (!row) return { count: 0 };
        if (where.status && row.status !== where.status) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    };
  }
  get buildArtifact() {
    const self = this;
    return {
      create: async ({ data }: any) => {
        self.artifacts.push(data);
        return data;
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

  async $executeRawUnsafe(): Promise<number> {
    return 1;
  }
}

function makeOrch(overrides: {
  prisma?: any;
  crypto?: any;
  github?: any;
  storage?: any;
  jenkins?: any;
  audit?: any;
  testsRepoResolver?: any;
  aborts?: any;
  config?: any;
} = {}) {
  const prisma = overrides.prisma ?? new PrismaMock();
  const crypto = overrides.crypto ?? {
    decryptPat: jest.fn(async () => 'ghp_decrypted'),
  };
  const github = overrides.github ?? {
    archiveCommit: jest.fn(async () => Buffer.from('tarball')),
  };
  const storage = overrides.storage ?? {
    bucketNames: () => ({
      workspaces: 'workspaces',
      logs: 'logs',
      junit: 'junit',
    }),
    putObject: jest.fn(async () => ({ sizeBytes: 42 })),
    presignGet: jest.fn(async () => ({
      url: 'https://minio/get',
      expiresAt: new Date(),
    })),
    presignPut: jest.fn(async () => ({
      url: 'https://minio/put',
      expiresAt: new Date(),
    })),
    delete: jest.fn(async () => {}),
  };
  const jenkins = overrides.jenkins ?? {
    triggerBuild: jest.fn(async () => ({
      jenkinsBuildUrl: 'https://jenkins/job/moulinator-run/42/',
    })),
    abortBuild: jest.fn(async () => {}),
  };
  const audit = overrides.audit ?? {
    log: jest.fn(async () => {}),
    logWith: jest.fn(async () => {}),
  };
  const testsRepoResolver = overrides.testsRepoResolver ?? {
    resolveHead: jest.fn(async () => 'f'.repeat(40)),
  };
  const aborts = overrides.aborts ?? { enqueue: jest.fn(async () => {}) };
  const config =
    overrides.config ??
    new ConfigService({
      PUBLIC_API_URL: 'https://api.test',
      TESTS_REPO_URL: 'git@github.com:org/tests.git',
    });
  const orch = new RunsOrchestrator(
    prisma,
    crypto,
    github,
    storage,
    jenkins,
    audit,
    testsRepoResolver,
    aborts,
    config,
  );
  return { orch, prisma, crypto, github, storage, jenkins, audit, aborts };
}

describe('RunsOrchestrator.triggerRun', () => {
  it('creates a queued run, archives, uploads, triggers, returns result', async () => {
    const { orch, prisma, jenkins, github, storage } = makeOrch();
    prisma.repositories.set('repo-1', {
      id: 'repo-1',
      user_id: 'user-1',
      github_url: 'https://github.com/u/w',
      project: {
        id: 'proj-1',
        slug: 'cpool-day06',
        runner_image_digest: 'sha256:' + 'a'.repeat(64),
        timeout_seconds: 600,
        hermetic: true,
        egress_allowlist: [],
        harness_entrypoint: 'tests/harness.sh',
        resource_limits: { memory_mb: 2048, cpus: 2, pids: 512 },
      },
    });
    prisma.credentials.push({
      id: 'cred-1',
      user_id: 'user-1',
      ciphertext: Buffer.alloc(1),
      iv: Buffer.alloc(12),
      auth_tag: Buffer.alloc(16),
      wrapped_dek: Buffer.alloc(60),
    });
    const res = await orch.triggerRun({
      userId: 'user-1',
      repoId: 'repo-1',
      commitSha: 'a'.repeat(40),
    });
    expect(res.runId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(res.correlationId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    const run = prisma.testRuns.get(res.runId);
    expect(run.status).toBe('queued');
    expect(run.jenkins_build_url).toBe('https://jenkins/job/moulinator-run/42/');
    expect(run.tests_repo_commit_sha).toBe('f'.repeat(40));
    expect(jenkins.triggerBuild).toHaveBeenCalledWith(
      expect.objectContaining({
        testRunId: res.runId,
        hermetic: true,
        testsCommitSha: 'f'.repeat(40),
      }),
    );
    expect(github.archiveCommit).toHaveBeenCalledWith(
      'ghp_decrypted',
      'https://github.com/u/w',
      'a'.repeat(40),
    );
    expect(storage.putObject).toHaveBeenCalled();
    expect(prisma.artifacts).toHaveLength(1);
  });

  it('rejects when a non-terminal run already exists (429)', async () => {
    const { orch, prisma } = makeOrch();
    prisma.repositories.set('repo-1', {
      id: 'repo-1',
      user_id: 'u',
      github_url: 'https://github.com/u/w',
      project: { timeout_seconds: 600, hermetic: true, egress_allowlist: [], resource_limits: {}, harness_entrypoint: 't', runner_image_digest: 'sha256:' + 'a'.repeat(64), slug: 's' },
    });
    prisma.credentials.push({
      id: 'c',
      user_id: 'u',
      ciphertext: Buffer.alloc(1),
      iv: Buffer.alloc(12),
      auth_tag: Buffer.alloc(16),
      wrapped_dek: Buffer.alloc(60),
    });
    prisma.activeCount = 1;
    await expect(
      orch.triggerRun({ userId: 'u', repoId: 'repo-1', commitSha: 'a'.repeat(40) }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects unknown repo with 404', async () => {
    const { orch } = makeOrch();
    await expect(
      orch.triggerRun({ userId: 'u', repoId: 'missing', commitSha: 'a'.repeat(40) }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('marks the run as error if jenkins trigger fails', async () => {
    const jenkins = {
      triggerBuild: jest.fn(async () => {
        throw new Error('jenkins_trigger_failed status=500');
      }),
      abortBuild: jest.fn(async () => {}),
    };
    const { orch, prisma } = makeOrch({ jenkins });
    prisma.repositories.set('repo-1', {
      id: 'repo-1',
      user_id: 'u',
      github_url: 'https://github.com/u/w',
      project: {
        timeout_seconds: 600,
        hermetic: true,
        egress_allowlist: [],
        resource_limits: {},
        harness_entrypoint: 'h',
        runner_image_digest: 'sha256:' + 'a'.repeat(64),
        slug: 's',
      },
    });
    prisma.credentials.push({
      id: 'c',
      user_id: 'u',
      ciphertext: Buffer.alloc(1),
      iv: Buffer.alloc(12),
      auth_tag: Buffer.alloc(16),
      wrapped_dek: Buffer.alloc(60),
    });
    await expect(
      orch.triggerRun({ userId: 'u', repoId: 'repo-1', commitSha: 'a'.repeat(40) }),
    ).rejects.toThrow(/jenkins_trigger_failed/);
    const run = [...prisma.testRuns.values()][0];
    expect(run.status).toBe('error');
    expect(run.cancellation_reason).toContain('jenkins_trigger_failed');
  });
});

describe('RunsOrchestrator.cancelRun', () => {
  it('marks a queued run as cancelled without calling Jenkins', async () => {
    const { orch, prisma, jenkins } = makeOrch();
    prisma.testRuns.set('r1', { id: 'r1', status: 'queued' });
    await orch.cancelRun('r1', 'user_cancelled');
    expect(prisma.testRuns.get('r1').status).toBe('cancelled');
    expect(jenkins.abortBuild).not.toHaveBeenCalled();
  });

  it('aborts then cancels a running run', async () => {
    const { orch, prisma, jenkins } = makeOrch();
    prisma.testRuns.set('r1', {
      id: 'r1',
      status: 'running',
      jenkins_build_url: 'https://j/job/1',
    });
    await orch.cancelRun('r1', 'user_cancelled');
    expect(jenkins.abortBuild).toHaveBeenCalledWith('https://j/job/1');
    expect(prisma.testRuns.get('r1').status).toBe('cancelled');
  });

  it('marks running run as error when abort fails', async () => {
    const jenkins = {
      triggerBuild: jest.fn(async () => ({ jenkinsBuildUrl: '' })),
      abortBuild: jest.fn(async () => {
        throw new Error('jenkins_down');
      }),
    };
    const aborts = { enqueue: jest.fn(async () => {}) };
    const { orch, prisma } = makeOrch({ jenkins, aborts });
    prisma.testRuns.set('r1', {
      id: 'r1',
      status: 'running',
      jenkins_build_url: 'https://j/job/1',
    });
    await expect(
      orch.cancelRun('r1', 'user_cancelled'),
    ).rejects.toThrow(/jenkins_down/);
    expect(prisma.testRuns.get('r1').status).toBe('error');
    expect(prisma.testRuns.get('r1').cancellation_reason).toBe('abort_failed');
    expect(aborts.enqueue).toHaveBeenCalledWith('r1');
  });

  it('throws ConflictException on terminal run', async () => {
    const { orch, prisma } = makeOrch();
    prisma.testRuns.set('r1', { id: 'r1', status: 'passed' });
    await expect(orch.cancelRun('r1', 'x')).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});
