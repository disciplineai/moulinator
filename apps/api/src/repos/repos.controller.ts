import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Ip,
  Param,
  Post,
} from '@nestjs/common';
import { CurrentUser, type AuthedUser } from '../auth/current-user.decorator';
import { CreateRepoDto } from './dto';
import { ReposService } from './repos.service';

@Controller('repos')
export class ReposController {
  constructor(private readonly repos: ReposService) {}

  @Get()
  list(@CurrentUser() user: AuthedUser) {
    return this.repos.list(user.id);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthedUser,
    @Body() dto: CreateRepoDto,
    @Ip() ip: string,
  ) {
    return this.repos.create(user.id, dto, ip);
  }

  @Get(':id')
  get(@CurrentUser() user: AuthedUser, @Param('id') id: string) {
    return this.repos.get(user.id, id);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Ip() ip: string,
  ) {
    await this.repos.delete(user.id, id, ip);
  }
}
