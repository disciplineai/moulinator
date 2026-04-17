import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { REFRESH_TOKEN_STORE } from '@moulinator/api-core-contracts';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../audit/audit.module';
import { RefreshTokenService } from './refresh-token.service';

@Module({
  imports: [PrismaModule, AuditModule, JwtModule.register({})],
  providers: [
    RefreshTokenService,
    { provide: REFRESH_TOKEN_STORE, useExisting: RefreshTokenService },
  ],
  exports: [RefreshTokenService, REFRESH_TOKEN_STORE],
})
export class RefreshTokenModule {}
