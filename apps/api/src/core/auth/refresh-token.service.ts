import {
  Injectable,
  Logger,
  OnModuleInit,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { randomUUID } from 'crypto';
import { ulid } from 'ulid';
import type { Prisma } from '@prisma/client';
import type {
  IRefreshTokenStore,
  IssuedRefreshToken,
  VerifiedRefreshToken,
} from '@moulinator/api-core-contracts';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';

interface RefreshJwtPayload {
  sub: string;
  jti: string;
  typ: 'refresh';
  iat?: number;
  exp?: number;
}

interface IssuedInternal extends IssuedRefreshToken {
  rowId: string;
}

type TxOrPrisma = Prisma.TransactionClient | PrismaService;

@Injectable()
export class RefreshTokenService implements IRefreshTokenStore, OnModuleInit {
  private readonly logger = new Logger(RefreshTokenService.name);
  private refreshSecret!: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly audit: AuditService,
  ) {}

  onModuleInit(): void {
    this.refreshSecret = this.config.getOrThrow<string>('JWT_REFRESH_SECRET');
  }

  async issue(userId: string, ttlSeconds: number): Promise<IssuedRefreshToken> {
    const { rowId: _rowId, ...issued } = await this.issueWith(
      this.prisma,
      userId,
      ttlSeconds,
      'issued',
    );
    return issued;
  }

  async verify(token: string): Promise<VerifiedRefreshToken | null> {
    let payload: RefreshJwtPayload;
    try {
      payload = await this.jwt.verifyAsync<RefreshJwtPayload>(token, {
        secret: this.refreshSecret,
      });
    } catch {
      return null;
    }
    if (payload.typ !== 'refresh' || !payload.jti || !payload.sub) {
      return null;
    }
    const row = await this.prisma.refreshToken.findUnique({
      where: { jti: payload.jti },
    });
    if (!row) return null;
    if (row.user_id !== payload.sub) return null;
    if (row.revoked_at !== null) return null;
    if (row.expires_at.getTime() <= Date.now()) return null;
    return { userId: row.user_id, jti: row.jti };
  }

  async rotate(
    oldJti: string,
    userId: string,
    ttlSeconds: number,
  ): Promise<IssuedRefreshToken> {
    return this.prisma.$transaction(async (tx) => {
      const old = await tx.refreshToken.findUnique({ where: { jti: oldJti } });
      if (!old || old.user_id !== userId) {
        throw new UnauthorizedException({ error: 'invalid_refresh' });
      }
      // Reuse detection: the old row was already rotated forward. The caller
      // is presenting a leaked/stale refresh copy. Revoke every active
      // session for the user and reject.
      if (old.replaced_by !== null) {
        await this.revokeAllWith(tx, userId, 'reuse_detected');
        await this.audit.logWith(tx, {
          actorId: userId,
          action: 'auth.refresh.reuse_detected',
          entity: 'refresh_token',
          entityId: old.id,
          metadata: { old_jti_prefix: oldJti.slice(0, 8) },
        });
        throw new UnauthorizedException({ error: 'refresh_reuse_detected' });
      }
      if (old.revoked_at !== null) {
        throw new UnauthorizedException({ error: 'refresh_revoked' });
      }
      if (old.expires_at.getTime() <= Date.now()) {
        throw new UnauthorizedException({ error: 'refresh_expired' });
      }
      const issued = await this.issueWith(tx, userId, ttlSeconds, 'rotated');
      await tx.refreshToken.update({
        where: { id: old.id },
        data: { revoked_at: new Date(), replaced_by: issued.rowId },
      });
      const { rowId: _rowId, ...out } = issued;
      return out;
    });
  }

  async revoke(jti: string, reason = 'revoked'): Promise<void> {
    const row = await this.prisma.refreshToken.findUnique({ where: { jti } });
    if (!row) return;
    if (row.revoked_at !== null) return;
    await this.prisma.$transaction(async (tx) => {
      await tx.refreshToken.update({
        where: { id: row.id },
        data: { revoked_at: new Date() },
      });
      await this.audit.logWith(tx, {
        actorId: row.user_id,
        action: 'auth.refresh.revoked',
        entity: 'refresh_token',
        entityId: row.id,
        metadata: { jti_prefix: jti.slice(0, 8), reason },
      });
    });
  }

  async revokeAllForUser(userId: string, reason: string): Promise<void> {
    await this.prisma.$transaction((tx) =>
      this.revokeAllWith(tx, userId, reason),
    );
  }

  private async revokeAllWith(
    tx: Prisma.TransactionClient,
    userId: string,
    reason: string,
  ): Promise<number> {
    const res = await tx.refreshToken.updateMany({
      where: { user_id: userId, revoked_at: null },
      data: { revoked_at: new Date() },
    });
    if (res.count > 0) {
      await this.audit.logWith(tx, {
        actorId: userId,
        action: 'auth.refresh.revoke_all',
        entity: 'user',
        entityId: userId,
        metadata: { reason, revoked_count: res.count },
      });
    }
    return res.count;
  }

  private async issueWith(
    tx: TxOrPrisma,
    userId: string,
    ttlSeconds: number,
    auditSuffix: 'issued' | 'rotated',
  ): Promise<IssuedInternal> {
    if (ttlSeconds <= 0) {
      throw new Error('refresh_ttl_must_be_positive');
    }
    const jti = randomUUID();
    const rowId = ulid();
    const now = new Date();
    const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
    // Sign first — if signing fails we never write the row.
    const token = await this.jwt.signAsync(
      { sub: userId, jti, typ: 'refresh' } satisfies RefreshJwtPayload,
      { secret: this.refreshSecret, expiresIn: ttlSeconds },
    );
    await tx.refreshToken.create({
      data: {
        id: rowId,
        user_id: userId,
        jti,
        issued_at: now,
        expires_at: expiresAt,
      },
    });
    await this.audit.logWith(tx as Prisma.TransactionClient, {
      actorId: userId,
      action: `auth.refresh.${auditSuffix}`,
      entity: 'refresh_token',
      entityId: rowId,
      metadata: {
        jti_prefix: jti.slice(0, 8),
        expires_at: expiresAt.toISOString(),
      },
    });
    return { token, jti, expiresAt, rowId };
  }
}
