import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  BadRequestException,
  ConflictException,
  UnauthorizedException,
} from '@nestjs/common';
import {
  AUDIT_SERVICE,
  REFRESH_TOKEN_STORE,
} from '@moulinator/api-core-contracts';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

type PrismaMock = {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
};

function makeResponse() {
  return {
    cookie: jest.fn(),
    clearCookie: jest.fn(),
    status: jest.fn(),
  } as unknown as import('express').Response & {
    cookie: jest.Mock;
    clearCookie: jest.Mock;
  };
}

function makeRequest(cookies: Record<string, string> = {}) {
  return { cookies } as unknown as import('express').Request;
}

describe('AuthController', () => {
  let controller: AuthController;
  let service: AuthService;
  let prisma: PrismaMock;
  let audit: { log: jest.Mock };
  let refreshStore: {
    issue: jest.Mock;
    verify: jest.Mock;
    rotate: jest.Mock;
    revoke: jest.Mock;
    revokeAllForUser: jest.Mock;
  };

  const futureExpiry = () => new Date(Date.now() + 60_000);

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };
    refreshStore = {
      issue: jest.fn().mockResolvedValue({
        token: 'refresh-tok',
        jti: 'JTI-1',
        expiresAt: futureExpiry(),
      }),
      verify: jest.fn(),
      rotate: jest.fn(),
      revoke: jest.fn().mockResolvedValue(undefined),
      revokeAllForUser: jest.fn().mockResolvedValue(undefined),
    };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn().mockResolvedValue('access-tok') },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'JWT_ACCESS_SECRET') return 'access-secret';
              if (key === 'JWT_ACCESS_TTL_SECONDS') return 900;
              if (key === 'JWT_REFRESH_TTL_SECONDS') return 86_400;
              if (key === 'NODE_ENV') return 'test';
              return undefined;
            },
          },
        },
        { provide: AUDIT_SERVICE, useValue: audit },
        { provide: REFRESH_TOKEN_STORE, useValue: refreshStore },
      ],
    }).compile();

    controller = moduleRef.get(AuthController);
    service = moduleRef.get(AuthService);
  });

  describe('signup', () => {
    it('creates user, returns access token, sets refresh cookie', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }) => ({
        id: data.id,
        email: data.email,
        role: 'student',
      }));

      const res = makeResponse();
      const tokens = await controller.signup(
        { email: 'a@b.co', password: 'longenough1' },
        '127.0.0.1',
        res,
      );
      expect(tokens.access_token).toBe('access-tok');
      expect(tokens.expires_in).toBe(900);
      expect(tokens).not.toHaveProperty('refresh_token');
      expect(res.cookie).toHaveBeenCalledWith(
        'mou_rt',
        'refresh-tok',
        expect.objectContaining({ httpOnly: true, sameSite: 'lax', path: '/auth' }),
      );
      expect(refreshStore.issue).toHaveBeenCalledWith(expect.any(String), 86_400);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.signup' }),
      );
    });

    it('rejects duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'x', email: 'a@b.co' });
      const res = makeResponse();
      await expect(
        controller.signup(
          { email: 'a@b.co', password: 'longenough1' },
          '127.0.0.1',
          res,
        ),
      ).rejects.toBeInstanceOf(ConflictException);
      expect(res.cookie).not.toHaveBeenCalled();
    });
  });

  describe('login', () => {
    it('rejects unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      const res = makeResponse();
      await expect(
        controller.login(
          { email: 'a@b.co', password: 'longenough1' },
          '127.0.0.1',
          res,
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login_failed' }),
      );
      expect(res.cookie).not.toHaveBeenCalled();
    });

    it('returns access token and sets cookie on good password', async () => {
      const password_hash = await (await import('bcrypt')).hash('longenough1', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: '01HXYZ',
        email: 'a@b.co',
        role: 'student',
        password_hash,
      });
      const res = makeResponse();
      const tokens = await controller.login(
        { email: 'a@b.co', password: 'longenough1' },
        '127.0.0.1',
        res,
      );
      expect(tokens.access_token).toBe('access-tok');
      expect(res.cookie).toHaveBeenCalled();
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login' }),
      );
    });
  });

  describe('refresh', () => {
    it('400s without CSRF header', async () => {
      await expect(
        controller.refresh(
          makeRequest({ mou_rt: 'x' }),
          undefined,
          '127.0.0.1',
          makeResponse(),
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(refreshStore.verify).not.toHaveBeenCalled();
    });

    it('401s when cookie missing', async () => {
      await expect(
        controller.refresh(
          makeRequest({}),
          '1',
          '127.0.0.1',
          makeResponse(),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.refresh_failed',
          metadata: expect.objectContaining({ reason: 'missing_cookie' }),
        }),
      );
    });

    it('rotates and sets new cookie on success', async () => {
      refreshStore.verify.mockResolvedValue({ userId: 'U1', jti: 'JTI-A' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'U1',
        email: 'a@b.co',
        role: 'student',
      });
      refreshStore.rotate.mockResolvedValue({
        token: 'new-refresh',
        jti: 'JTI-B',
        expiresAt: futureExpiry(),
      });

      const res = makeResponse();
      const tokens = await controller.refresh(
        makeRequest({ mou_rt: 'old-refresh' }),
        '1',
        '127.0.0.1',
        res,
      );
      expect(tokens.access_token).toBe('access-tok');
      expect(refreshStore.rotate).toHaveBeenCalledWith('JTI-A', 'U1', 86_400);
      expect(res.cookie).toHaveBeenCalledWith(
        'mou_rt',
        'new-refresh',
        expect.objectContaining({ httpOnly: true }),
      );
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.refresh', actorId: 'U1' }),
      );
    });

    it('audits refresh_failed on rotate throw (reuse detected by store)', async () => {
      refreshStore.verify.mockResolvedValue({ userId: 'U1', jti: 'JTI-A' });
      prisma.user.findUnique.mockResolvedValue({
        id: 'U1',
        email: 'a@b.co',
        role: 'student',
      });
      refreshStore.rotate.mockRejectedValue(new Error('reuse_detected'));

      await expect(
        controller.refresh(
          makeRequest({ mou_rt: 'old-refresh' }),
          '1',
          '127.0.0.1',
          makeResponse(),
        ),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'auth.refresh_failed',
          metadata: expect.objectContaining({ reason: 'rotate_failed' }),
        }),
      );
    });
  });

  describe('logout', () => {
    it('is idempotent when no cookie is present', async () => {
      const res = makeResponse();
      await expect(
        controller.logout(makeRequest({}), '127.0.0.1', res),
      ).resolves.toBeUndefined();
      expect(refreshStore.revoke).not.toHaveBeenCalled();
      expect(res.clearCookie).toHaveBeenCalledWith('mou_rt', expect.any(Object));
    });

    it('revokes jti and audits when cookie is valid', async () => {
      refreshStore.verify.mockResolvedValue({ userId: 'U1', jti: 'JTI-A' });
      const res = makeResponse();
      await controller.logout(
        makeRequest({ mou_rt: 'tok' }),
        '127.0.0.1',
        res,
      );
      expect(refreshStore.revoke).toHaveBeenCalledWith('JTI-A');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.logout', actorId: 'U1' }),
      );
      expect(res.clearCookie).toHaveBeenCalled();
    });
  });

  it('wires service', () => {
    expect(service).toBeDefined();
  });
});
