import {
  Body,
  Controller,
  Get,
  HttpCode,
  Ip,
  Post,
  Query,
} from '@nestjs/common';
import { CurrentUser, type AuthedUser } from '../auth/current-user.decorator';
import { ContributionsService } from './contributions.service';
import { CreateContributionDto, ListContributionsQuery } from './dto';

@Controller('contributions')
export class ContributionsController {
  constructor(private readonly contributions: ContributionsService) {}

  @Get()
  list(
    @CurrentUser() user: AuthedUser,
    @Query() query: ListContributionsQuery,
  ) {
    return this.contributions.list(user.id, query.status);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthedUser,
    @Body() dto: CreateContributionDto,
    @Ip() ip: string,
  ) {
    return this.contributions.create(user.id, dto, ip);
  }
}
