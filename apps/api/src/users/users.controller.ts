import { Controller, Get, NotFoundException } from '@nestjs/common';
import type { UserDto } from '@moulinator/api-core-contracts';
import { CurrentUser, type AuthedUser } from '../auth/current-user.decorator';
import { PrismaService } from '../prisma/prisma.service';

@Controller('me')
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  async me(@CurrentUser() authed: AuthedUser): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: authed.id } });
    if (!user) throw new NotFoundException({ error: 'user_not_found' });
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      created_at: user.created_at.toISOString(),
    };
  }
}
