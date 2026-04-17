import { SetMetadata } from '@nestjs/common';
import type { Role } from '@moulinator/api-core-contracts';

export const ROLES_KEY = 'requiredRoles';
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
