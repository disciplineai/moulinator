import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ulid } from 'ulid';
import {
  AUDIT_SERVICE,
  type IAuditService,
  type RepoDto,
  type RepoListDto,
} from '@moulinator/api-core-contracts';
import { PrismaService } from '../prisma/prisma.service';

const GITHUB_URL_REGEX = /^https:\/\/github\.com\/[^\/\s]+\/[^\/\s]+?(?:\.git)?$/i;

@Injectable()
export class ReposService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_SERVICE) private readonly audit: IAuditService,
  ) {}

  async list(userId: string): Promise<RepoListDto> {
    const rows = await this.prisma.repository.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });
    return {
      items: rows.map((r) => this.toDto(r)),
      next_cursor: null,
    };
  }

  async get(userId: string, id: string): Promise<RepoDto> {
    const row = await this.prisma.repository.findUnique({ where: { id } });
    if (!row || row.user_id !== userId) {
      throw new NotFoundException({ error: 'repo_not_found' });
    }
    return this.toDto(row);
  }

  async create(
    userId: string,
    input: { project_id: string; github_url: string; default_branch?: string },
    ip?: string,
  ): Promise<RepoDto> {
    if (!GITHUB_URL_REGEX.test(input.github_url)) {
      throw new UnprocessableEntityException({
        error: 'invalid_github_url',
        message: 'github_url must look like https://github.com/<owner>/<repo>',
      });
    }
    const project = await this.prisma.projectDefinition.findUnique({
      where: { id: input.project_id },
    });
    if (!project) {
      throw new UnprocessableEntityException({ error: 'project_not_found' });
    }
    const id = ulid();
    try {
      const row = await this.prisma.repository.create({
        data: {
          id,
          user_id: userId,
          project_id: input.project_id,
          github_url: input.github_url,
          default_branch: input.default_branch ?? 'main',
        },
      });
      await this.audit.log({
        actorId: userId,
        action: 'repos.create',
        entity: 'repository',
        entityId: id,
        ip,
      });
      return this.toDto(row);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException({ error: 'repo_already_registered' });
      }
      throw err;
    }
  }

  async delete(userId: string, id: string, ip?: string): Promise<void> {
    const row = await this.prisma.repository.findUnique({ where: { id } });
    if (!row || row.user_id !== userId) {
      throw new NotFoundException({ error: 'repo_not_found' });
    }
    await this.prisma.repository.delete({ where: { id } });
    await this.audit.log({
      actorId: userId,
      action: 'repos.delete',
      entity: 'repository',
      entityId: id,
      ip,
    });
  }

  private toDto(row: {
    id: string;
    project_id: string;
    github_url: string;
    default_branch: string;
    created_at: Date;
  }): RepoDto {
    return {
      id: row.id,
      project_id: row.project_id,
      github_url: row.github_url,
      default_branch: row.default_branch,
      created_at: row.created_at.toISOString(),
    };
  }
}
