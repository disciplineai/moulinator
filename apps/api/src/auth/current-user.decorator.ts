import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from '@moulinator/api-core-contracts';

export interface AuthedUser {
  id: string;
  email: string;
  role: Role;
}

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthedUser => {
    const req = ctx.switchToHttp().getRequest();
    return req.user as AuthedUser;
  },
);
