import { Controller, Get } from '@nestjs/common';
import type { ProjectDefinitionDto } from '@moulinator/api-core-contracts';
import { PrismaService } from '../prisma/prisma.service';

@Controller('projects')
export class ProjectsController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
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
}
