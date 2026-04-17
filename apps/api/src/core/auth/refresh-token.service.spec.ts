import 'reflect-metadata';
import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { RefreshTokenService } from './refresh-token.service';

class PrismaDouble {
  rows = new Map<string, any>();
  byJti = new Map<string, any>();
  auditLogs: any[] = [];
  get refreshToken() {
    const self = this;
    return {
      findUnique: async ({ where }: any) => {
        if (where.jti) return self.byJti.get(where.jti) ?? null;
        return self.rows.get(where.id) ?? null;
      },
      create: async ({ data }: any) => {
        const row = { ...data, revoked_at: null, replaced_by: null };
        self.rows.set(data.id, row);
        self.byJti.set(data.jti, row);
        return row;
      },
      update: async ({ where, data }: any) => {
        const row = self.rows.get(where.id);
        if (!row) throw new Error('not found');
        Object.assign(row, data);
        return row;
      },
      updateMany: async ({ where, data }: any) => {
        let count = 0;
        for (const row of self.rows.values()) {
          if (where.user_id && row.user_id !== where.user_id) continue;
          if (where.revoked_at === null && row.revoked_at !== null) continue;
          Object.assign(row, data);
          count++;
        }
        return { count };
      },
    };
  }
  get auditLog() {
    const self = this;
    return {
      create: async ({ data }: any) => {
        self.auditLogs.push(data);
        return data;
      },
    };
  }
  async $transaction<T>(fn: (tx: any) => Promise<T>): Promise<T> {
    return fn(this);
  }
}

function makeService() {
  const prisma = new PrismaDouble();
  const config = new ConfigService({
    JWT_REFRESH_SECRET: 'test-secret-that-is-long-enough',
  });
  const jwt = new JwtService({});
  const audit = {
    log: jest.fn(async () => {}),
    logWith: jest.fn(async (_tx: any, entry: any) => {
      prisma.auditLogs.push(entry);
    }),
  } as any;
  const svc = new RefreshTokenService(
    prisma as any,
    jwt,
    config as unknown as ConfigService,
    audit,
  );
  svc.onModuleInit();
  return { svc, prisma };
}

describe('RefreshTokenService', () => {
  const userId = '01J000000000000000000000AA';

  it('issues a signed token and persists a row', async () => {
    const { svc, prisma } = makeService();
    const out = await svc.issue(userId, 3600);
    expect(out.token.split('.').length).toBe(3);
    expect(out.jti).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    expect(prisma.byJti.get(out.jti)).toBeTruthy();
    expect(
      prisma.auditLogs.some((e) => e.action === 'auth.refresh.issued'),
    ).toBe(true);
  });

  it('verify returns the userId+jti for a fresh token', async () => {
    const { svc } = makeService();
    const out = await svc.issue(userId, 3600);
    const v = await svc.verify(out.token);
    expect(v).toEqual({ userId, jti: out.jti });
  });

  it('verify returns null for a revoked token', async () => {
    const { svc } = makeService();
    const out = await svc.issue(userId, 3600);
    await svc.revoke(out.jti);
    expect(await svc.verify(out.token)).toBeNull();
  });

  it('verify returns null for a malformed JWT', async () => {
    const { svc } = makeService();
    expect(await svc.verify('not.a.jwt')).toBeNull();
  });

  it('rotate revokes old, issues new, links via replaced_by', async () => {
    const { svc, prisma } = makeService();
    const first = await svc.issue(userId, 3600);
    const second = await svc.rotate(first.jti, userId, 3600);
    expect(second.jti).not.toBe(first.jti);
    const oldRow = prisma.byJti.get(first.jti);
    expect(oldRow.revoked_at).toBeInstanceOf(Date);
    expect(oldRow.replaced_by).toBeTruthy();
    expect(
      prisma.auditLogs.some((e) => e.action === 'auth.refresh.rotated'),
    ).toBe(true);
  });

  it('rotate on an already-rotated jti triggers reuse detection + revokeAll', async () => {
    const { svc, prisma } = makeService();
    const first = await svc.issue(userId, 3600);
    const second = await svc.rotate(first.jti, userId, 3600);
    // Attacker replays the original first.jti after legitimate rotation.
    await expect(svc.rotate(first.jti, userId, 3600)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    // All active tokens now revoked.
    const secondRow = prisma.byJti.get(second.jti);
    expect(secondRow.revoked_at).toBeInstanceOf(Date);
    expect(
      prisma.auditLogs.some(
        (e) => e.action === 'auth.refresh.reuse_detected',
      ),
    ).toBe(true);
    expect(
      prisma.auditLogs.some((e) => e.action === 'auth.refresh.revoke_all'),
    ).toBe(true);
  });

  it('revoke is a no-op for unknown jti', async () => {
    const { svc, prisma } = makeService();
    await svc.revoke('f47ac10b-58cc-4372-a567-0e02b2c3d479');
    expect(prisma.auditLogs).toHaveLength(0);
  });

  it('revokeAllForUser bulk-marks every active row + single audit', async () => {
    const { svc, prisma } = makeService();
    await svc.issue(userId, 3600);
    await svc.issue(userId, 3600);
    await svc.issue(userId, 3600);
    await svc.revokeAllForUser(userId, 'admin_action');
    for (const row of prisma.rows.values()) {
      expect(row.revoked_at).toBeInstanceOf(Date);
    }
    expect(
      prisma.auditLogs.filter((e) => e.action === 'auth.refresh.revoke_all'),
    ).toHaveLength(1);
  });
});
