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
import { CredentialsService } from './credentials.service';
import { CreateCredentialDto } from './dto';

@Controller('me/credentials')
export class CredentialsController {
  constructor(private readonly credentials: CredentialsService) {}

  @Get()
  list(@CurrentUser() user: AuthedUser) {
    return this.credentials.list(user.id);
  }

  @Post()
  @HttpCode(201)
  create(
    @CurrentUser() user: AuthedUser,
    @Body() dto: CreateCredentialDto,
    @Ip() ip: string,
  ) {
    return this.credentials.create(user.id, dto.token, dto.label, ip);
  }

  @Delete(':id')
  @HttpCode(204)
  async delete(
    @CurrentUser() user: AuthedUser,
    @Param('id') id: string,
    @Ip() ip: string,
  ) {
    await this.credentials.delete(user.id, id, ip);
  }
}
