import {
  ConflictException,
  Inject,
  Injectable,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ulid } from 'ulid';
import {
  AUDIT_SERVICE,
  type ContributionStatus,
  type IAuditService,
  type TestContributionDto,
} from '@moulinator/api-core-contracts';
import { PrismaService } from '../prisma/prisma.service';

const GITHUB_PR_REGEX =
  /^https:\/\/github\.com\/[^\/\s]+\/[^\/\s]+\/pull\/\d+(?:\/.*)?$/i;

@Injectable()
export class ContributionsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_SERVICE) private readonly audit: IAuditService,
  ) {}

  async list(
    userId: string,
    status?: ContributionStatus,
  ): Promise<TestContributionDto[]> {
    const rows = await this.prisma.testContribution.findMany({
      where: {
        user_id: userId,
        ...(status ? { status } : {}),
      },
      orderBy: { created_at: 'desc' },
    });
    return rows.map((r) => this.toDto(r));
  }

  async create(
    userId: string,
    input: { project_slug: string; github_pr_url: string },
    ip?: string,
  ): Promise<TestContributionDto> {
    if (!GITHUB_PR_REGEX.test(input.github_pr_url)) {
      throw new UnprocessableEntityException({
        error: 'invalid_pr_url',
        message: 'github_pr_url must look like https://github.com/<owner>/<repo>/pull/<n>',
      });
    }
    const project = await this.prisma.projectDefinition.findUnique({
      where: { slug: input.project_slug },
    });
    if (!project) {
      throw new UnprocessableEntityException({ error: 'project_not_found' });
    }
    const id = ulid();
    try {
      const row = await this.prisma.testContribution.create({
        data: {
          id,
          user_id: userId,
          project_id: project.id,
          github_pr_url: input.github_pr_url,
        },
      });
      await this.audit.log({
        actorId: userId,
        action: 'contributions.create',
        entity: 'test_contribution',
        entityId: id,
        ip,
      });
      return this.toDto(row);
    } catch (err) {
      if ((err as { code?: string }).code === 'P2002') {
        throw new ConflictException({ error: 'pr_already_registered' });
      }
      throw err;
    }
  }

  private toDto(row: {
    id: string;
    user_id: string;
    project_id: string;
    github_pr_url: string;
    status: ContributionStatus;
    merged_commit_sha: string | null;
    created_at: Date;
  }): TestContributionDto {
    return {
      id: row.id,
      user_id: row.user_id,
      project_id: row.project_id,
      github_pr_url: row.github_pr_url,
      status: row.status,
      merged_commit_sha: row.merged_commit_sha,
      created_at: row.created_at.toISOString(),
    };
  }
}
