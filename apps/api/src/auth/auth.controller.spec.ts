import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ConflictException, UnauthorizedException } from '@nestjs/common';
import { AUDIT_SERVICE } from '@moulinator/api-core-contracts';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { PrismaService } from '../prisma/prisma.service';

type PrismaMock = {
  user: {
    findUnique: jest.Mock;
    create: jest.Mock;
  };
};

describe('AuthController', () => {
  let controller: AuthController;
  let service: AuthService;
  let prisma: PrismaMock;
  let audit: { log: jest.Mock };

  beforeEach(async () => {
    prisma = {
      user: {
        findUnique: jest.fn(),
        create: jest.fn(),
      },
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        AuthService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: JwtService,
          useValue: { signAsync: jest.fn().mockResolvedValue('tok') },
        },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string) => {
              if (key === 'JWT_ACCESS_SECRET') return 'access-secret';
              if (key === 'JWT_REFRESH_SECRET') return 'refresh-secret';
              if (key === 'JWT_ACCESS_TTL_SECONDS') return 900;
              if (key === 'JWT_REFRESH_TTL_SECONDS') return 86_400;
              return undefined;
            },
          },
        },
        { provide: AUDIT_SERVICE, useValue: audit },
      ],
    }).compile();

    controller = moduleRef.get(AuthController);
    service = moduleRef.get(AuthService);
  });

  describe('signup', () => {
    it('creates user and returns tokens', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      prisma.user.create.mockImplementation(async ({ data }) => ({
        id: data.id,
        email: data.email,
        role: 'student',
      }));

      const tokens = await controller.signup(
        { email: 'a@b.co', password: 'longenough1' },
        '127.0.0.1',
      );
      expect(tokens.access_token).toBe('tok');
      expect(tokens.refresh_token).toBe('tok');
      expect(tokens.expires_in).toBe(900);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.signup' }),
      );
    });

    it('rejects duplicate email', async () => {
      prisma.user.findUnique.mockResolvedValue({ id: 'x', email: 'a@b.co' });
      await expect(
        controller.signup(
          { email: 'a@b.co', password: 'longenough1' },
          '127.0.0.1',
        ),
      ).rejects.toBeInstanceOf(ConflictException);
    });
  });

  describe('login', () => {
    it('rejects unknown email', async () => {
      prisma.user.findUnique.mockResolvedValue(null);
      await expect(
        controller.login({ email: 'a@b.co', password: 'longenough1' }, '127.0.0.1'),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login_failed' }),
      );
    });

    it('returns tokens on good password', async () => {
      const password_hash = await (await import('bcrypt')).hash('longenough1', 4);
      prisma.user.findUnique.mockResolvedValue({
        id: '01HXYZ',
        email: 'a@b.co',
        role: 'student',
        password_hash,
      });
      const tokens = await controller.login(
        { email: 'a@b.co', password: 'longenough1' },
        '127.0.0.1',
      );
      expect(tokens.access_token).toBe('tok');
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'auth.login' }),
      );
    });
  });

  it('wires service', () => {
    expect(service).toBeDefined();
  });
});
