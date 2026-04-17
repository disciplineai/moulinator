import { Controller, Get, Param } from '@nestjs/common';
import { CurrentUser, type AuthedUser } from '../auth/current-user.decorator';
import { ArtifactsService } from './artifacts.service';

@Controller()
export class ArtifactsController {
  constructor(private readonly artifacts: ArtifactsService) {}

  @Get('runs/:id/artifacts')
  listForRun(@CurrentUser() user: AuthedUser, @Param('id') runId: string) {
    return this.artifacts.listForRun(user.id, runId);
  }

  @Get('artifacts/:id/url')
  presign(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.artifacts.presign(user.id, id);
  }
}
