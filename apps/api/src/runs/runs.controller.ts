import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type AuthedUser } from '../auth/current-user.decorator';
import { CreateRunDto } from './dto';
import { ListRunsQuery } from './query';
import { RunsService } from './runs.service';

@Controller()
export class RunsController {
  constructor(private readonly runs: RunsService) {}

  @Post('runs')
  @HttpCode(201)
  trigger(
    @CurrentUser() user: AuthedUser,
    @Body() dto: CreateRunDto,
    @Ip() ip: string,
  ) {
    return this.runs.trigger(user.id, dto.repo_id, dto.commit_sha, ip);
  }

  @Get('runs/:id')
  get(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.runs.get(user.id, id);
  }

  @Delete('runs/:id')
  @HttpCode(204)
  async cancel(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Ip() ip: string,
  ) {
    await this.runs.cancel(user.id, id, ip);
  }

  @Get('repos/:id/runs')
  listForRepo(
    @CurrentUser() user: AuthedUser,
    @Param('id') repoId: string,
    @Query() query: ListRunsQuery,
  ) {
    return this.runs.listForRepo(user.id, repoId, query.cursor, query.limit);
  }

  @Get('runs/:id/results')
  listResults(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.runs.listResults(user.id, id);
  }
}
