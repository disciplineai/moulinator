import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  STORAGE_SERVICE,
  type BuildArtifactDto,
  type IStorageService,
  type PresignedUrlDto,
} from '@moulinator/api-core-contracts';
import { PrismaService } from '../prisma/prisma.service';

const KIND_BUCKET: Record<BuildArtifactDto['kind'], string> = {
  logs: 'logs',
  junit: 'junit',
  tarball: 'workspaces',
};

@Injectable()
export class ArtifactsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(STORAGE_SERVICE) private readonly storage: IStorageService,
  ) {}

  async listForRun(userId: string, runId: string): Promise<BuildArtifactDto[]> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      include: { repo: true },
    });
    if (!run || run.repo.user_id !== userId) {
      throw new NotFoundException({ error: 'run_not_found' });
    }
    const rows = await this.prisma.buildArtifact.findMany({
      where: { test_run_id: runId },
      orderBy: { created_at: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      test_run_id: r.test_run_id,
      kind: r.kind,
      size_bytes: Number(r.size_bytes),
      retention_until: r.retention_until.toISOString(),
    }));
  }

  async presign(userId: string, artifactId: string): Promise<PresignedUrlDto> {
    const row = await this.prisma.buildArtifact.findUnique({
      where: { id: artifactId },
      include: { run: { include: { repo: true } } },
    });
    if (!row || row.run.repo.user_id !== userId) {
      throw new NotFoundException({ error: 'artifact_not_found' });
    }
    const { url, expiresAt } = await this.storage.presignGet({
      bucket: KIND_BUCKET[row.kind],
      key: row.s3_key,
      expiresInSeconds: 300,
    });
    return { url, expires_at: expiresAt.toISOString() };
  }
}
