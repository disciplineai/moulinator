import {
  Body,
  ConflictException,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Post,
  Put,
  Param,
  Req,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Matches,
  Min,
} from 'class-validator';
import { ulid } from 'ulid';
import { Prisma } from '@prisma/client';
import type {
  AdminProjectDefinitionDto,
  ProjectDefinitionDto,
  IAuditService,
} from '@moulinator/api-core-contracts';
import { AUDIT_SERVICE } from '@moulinator/api-core-contracts';
import { PrismaService } from '../prisma/prisma.service';
import { Roles } from '../auth/roles.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { CurrentUser } from '../auth/current-user.decorator';

type Language = 'c' | 'cpp' | 'python' | 'bash' | 'haskell';

class CreateProjectBody {
  @IsString() @IsNotEmpty() @Matches(/^[a-z0-9][a-z0-9_-]{0,63}$/) slug!: string;
  @IsString() @IsNotEmpty() name!: string;
  @IsEnum(['c', 'cpp', 'python', 'bash', 'haskell']) language!: Language;
  @IsString() @IsNotEmpty() tests_path!: string;
  @IsString() @IsNotEmpty() runner_image_repo!: string;
  @IsString() @IsNotEmpty() runner_image_digest!: string;
  @IsString() @IsNotEmpty() harness_entrypoint!: string;
  @IsOptional() @IsBoolean() hermetic?: boolean;
  @IsOptional() @IsInt() @Min(1) timeout_seconds?: number;
  @IsOptional() @IsArray() egress_allowlist?: unknown[];
  @IsOptional() @IsObject() resource_limits?: Record<string, unknown>;
}

class UpdateProjectBody {
  @IsOptional() @IsString() @IsNotEmpty() name?: string;
  @IsOptional() @IsEnum(['c', 'cpp', 'python', 'bash', 'haskell']) language?: Language;
  @IsOptional() @IsString() @IsNotEmpty() tests_path?: string;
  @IsOptional() @IsString() @IsNotEmpty() runner_image_repo?: string;
  @IsOptional() @IsString() @IsNotEmpty() runner_image_digest?: string;
  @IsOptional() @IsString() @IsNotEmpty() harness_entrypoint?: string;
  @IsOptional() @IsBoolean() hermetic?: boolean;
  @IsOptional() @IsInt() @Min(1) timeout_seconds?: number;
  @IsOptional() @IsArray() egress_allowlist?: unknown[];
  @IsOptional() @IsObject() resource_limits?: Record<string, unknown>;
}

interface AuthedUser { id: string; email: string; role: string }

@Controller()
export class ProjectsController {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(AUDIT_SERVICE) private readonly audit: IAuditService,
  ) {}

  @Get('projects')
  async list(): Promise<ProjectDefinitionDto[]> {
    const rows = await this.prisma.projectDefinition.findMany({
      orderBy: { slug: 'asc' },
    });
    return rows.map((r) => ({
      id: r.id,
      slug: r.slug,
      name: r.name,
      language: r.language,
      tests_path: r.tests_path,
      hermetic: r.hermetic,
      runner_image_digest: r.runner_image_digest,
    }));
  }

  @Get('admin/projects')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async adminList(): Promise<AdminProjectDefinitionDto[]> {
    const rows = await this.prisma.projectDefinition.findMany({
      orderBy: { slug: 'asc' },
    });
    return rows.map(toAdminDto);
  }

  @Post('admin/projects')
  @HttpCode(201)
  @UseGuards(RolesGuard)
  @Roles('admin')
  async create(
    @Body() dto: CreateProjectBody,
    @CurrentUser() user: AuthedUser,
    @Req() req: { ip?: string },
  ): Promise<AdminProjectDefinitionDto> {
    let row;
    try {
      row = await this.prisma.projectDefinition.create({
        data: {
          id: ulid(),
          slug: dto.slug,
          name: dto.name,
          language: dto.language,
          tests_path: dto.tests_path,
          runner_image_repo: dto.runner_image_repo,
          runner_image_digest: dto.runner_image_digest,
          hermetic: dto.hermetic ?? true,
          egress_allowlist: (dto.egress_allowlist ?? []) as Prisma.InputJsonValue,
          timeout_seconds: dto.timeout_seconds ?? 600,
          resource_limits: (dto.resource_limits ?? { memory_mb: 2048, cpus: 2, pids: 512, disk_mb: 1024 }) as Prisma.InputJsonValue,
          harness_entrypoint: dto.harness_entrypoint,
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException({ error: 'conflict', message: `Project slug '${dto.slug}' already exists` });
      }
      throw e;
    }

    await this.audit.log({
      actorId: user.id,
      action: 'projects.create',
      entity: 'ProjectDefinition',
      entityId: row.id,
      ip: req.ip,
      metadata: { slug: row.slug },
    });

    return toAdminDto(row);
  }

  @Put('admin/projects/:slug')
  @UseGuards(RolesGuard)
  @Roles('admin')
  async update(
    @Param('slug') slug: string,
    @Body() dto: UpdateProjectBody,
    @CurrentUser() user: AuthedUser,
    @Req() req: { ip?: string },
  ): Promise<AdminProjectDefinitionDto> {
    const existing = await this.prisma.projectDefinition.findUnique({ where: { slug } });
    if (!existing) throw new NotFoundException({ error: 'not_found', message: `Project '${slug}' not found` });

    let row;
    try {
      row = await this.prisma.projectDefinition.update({
        where: { slug },
        data: {
          ...(dto.name !== undefined && { name: dto.name }),
          ...(dto.language !== undefined && { language: dto.language }),
          ...(dto.tests_path !== undefined && { tests_path: dto.tests_path }),
          ...(dto.runner_image_repo !== undefined && { runner_image_repo: dto.runner_image_repo }),
          ...(dto.runner_image_digest !== undefined && { runner_image_digest: dto.runner_image_digest }),
          ...(dto.hermetic !== undefined && { hermetic: dto.hermetic }),
          ...(dto.egress_allowlist !== undefined && { egress_allowlist: dto.egress_allowlist as Prisma.InputJsonValue }),
          ...(dto.timeout_seconds !== undefined && { timeout_seconds: dto.timeout_seconds }),
          ...(dto.resource_limits !== undefined && { resource_limits: dto.resource_limits as Prisma.InputJsonValue }),
          ...(dto.harness_entrypoint !== undefined && { harness_entrypoint: dto.harness_entrypoint }),
        },
      });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2025') {
        throw new NotFoundException({ error: 'not_found', message: `Project '${slug}' not found` });
      }
      throw e;
    }

    await this.audit.log({
      actorId: user.id,
      action: 'projects.update',
      entity: 'ProjectDefinition',
      entityId: row.id,
      ip: req.ip,
      metadata: { slug: row.slug, changes: Object.keys(dto) },
    });

    return toAdminDto(row);
  }

  @Delete('admin/projects/:slug')
  @HttpCode(204)
  @UseGuards(RolesGuard)
  @Roles('admin')
  async remove(
    @Param('slug') slug: string,
    @CurrentUser() user: AuthedUser,
    @Req() req: { ip?: string },
  ): Promise<void> {
    const existing = await this.prisma.projectDefinition.findUnique({ where: { slug } });
    if (!existing) throw new NotFoundException({ error: 'not_found', message: `Project '${slug}' not found` });

    try {
      await this.prisma.projectDefinition.delete({ where: { slug } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError) {
        if (e.code === 'P2003') {
          throw new UnprocessableEntityException({
            error: 'conflict',
            message: `Project '${slug}' still has linked repositories or contributions — remove them first`,
          });
        }
        if (e.code === 'P2025') {
          throw new NotFoundException({ error: 'not_found', message: `Project '${slug}' not found` });
        }
      }
      throw e;
    }

    await this.audit.log({
      actorId: user.id,
      action: 'projects.delete',
      entity: 'ProjectDefinition',
      entityId: existing.id,
      ip: req.ip,
      metadata: { slug },
    });
  }
}

function toAdminDto(r: {
  id: string; slug: string; name: string; language: string;
  tests_path: string; runner_image_repo: string; runner_image_digest: string;
  hermetic: boolean; egress_allowlist: unknown; timeout_seconds: number;
  resource_limits: unknown; harness_entrypoint: string;
  created_at: Date; updated_at: Date;
}): AdminProjectDefinitionDto {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    language: r.language as AdminProjectDefinitionDto['language'],
    tests_path: r.tests_path,
    runner_image_repo: r.runner_image_repo,
    runner_image_digest: r.runner_image_digest,
    hermetic: r.hermetic,
    egress_allowlist: (r.egress_allowlist as unknown[]) ?? [],
    timeout_seconds: r.timeout_seconds,
    resource_limits: r.resource_limits as Record<string, unknown>,
    harness_entrypoint: r.harness_entrypoint,
    created_at: r.created_at.toISOString(),
    updated_at: r.updated_at.toISOString(),
  };
}
