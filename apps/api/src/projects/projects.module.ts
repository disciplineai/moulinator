import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { RolesGuard } from '../auth/roles.guard';

@Module({
  controllers: [ProjectsController],
  providers: [RolesGuard],
})
export class ProjectsModule {}
