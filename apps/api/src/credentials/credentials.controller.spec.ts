import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import {
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AUDIT_SERVICE,
  CRYPTO_SERVICE,
  GITHUB_CLIENT,
} from '@moulinator/api-core-contracts';
import { CredentialsController } from './credentials.controller';
import { CredentialsService } from './credentials.service';
import { PrismaService } from '../prisma/prisma.service';

describe('CredentialsController', () => {
  let controller: CredentialsController;
  let prisma: {
    githubCredential: {
      findMany: jest.Mock;
      create: jest.Mock;
      findUnique: jest.Mock;
      delete: jest.Mock;
    };
  };
  let crypto: { encryptPat: jest.Mock; decryptPat: jest.Mock };
  let github: { validatePat: jest.Mock; getRepoMeta: jest.Mock; archiveCommit: jest.Mock };
  let audit: { log: jest.Mock };

  const user = { id: 'USER_ID', email: 'a@b.co', role: 'student' as const };

  beforeEach(async () => {
    prisma = {
      githubCredential: {
        findMany: jest.fn(),
        create: jest.fn(),
        findUnique: jest.fn(),
        delete: jest.fn(),
      },
    };
    crypto = {
      encryptPat: jest.fn(),
      decryptPat: jest.fn(),
    };
    github = {
      validatePat: jest.fn(),
      getRepoMeta: jest.fn(),
      archiveCommit: jest.fn(),
    };
    audit = { log: jest.fn().mockResolvedValue(undefined) };

    const moduleRef = await Test.createTestingModule({
      controllers: [CredentialsController],
      providers: [
        CredentialsService,
        { provide: PrismaService, useValue: prisma },
        { provide: CRYPTO_SERVICE, useValue: crypto },
        { provide: GITHUB_CLIENT, useValue: github },
        { provide: AUDIT_SERVICE, useValue: audit },
      ],
    }).compile();

    controller = moduleRef.get(CredentialsController);
  });

  describe('create', () => {
    it('rejects invalid PAT with 422', async () => {
      github.validatePat.mockResolvedValue({
        valid: false,
        scopes: [],
        reason: 'bad scope',
      });
      await expect(
        controller.create(user, { token: 'gh_invalid123' }, '127.0.0.1'),
      ).rejects.toBeInstanceOf(UnprocessableEntityException);
      expect(crypto.encryptPat).not.toHaveBeenCalled();
    });

    it('stores encrypted blob and returns meta', async () => {
      github.validatePat.mockResolvedValue({
        valid: true,
        scopes: ['repo'],
        login: 'octocat',
      });
      crypto.encryptPat.mockResolvedValue({
        ciphertext: Buffer.from('c'),
        iv: Buffer.from('i'),
        authTag: Buffer.from('t'),
        wrappedDek: Buffer.from('d'),
      });
      prisma.githubCredential.create.mockImplementation(async ({ data }) => ({
        id: data.id,
        label: data.label,
        scopes: data.scopes,
        last_used_at: null,
        created_at: new Date('2026-04-17T00:00:00Z'),
      }));

      const meta = await controller.create(
        user,
        { token: 'gh_pat_abc123xyz' },
        '127.0.0.1',
      );
      expect(meta.label).toBe('octocat');
      expect(meta.scopes).toEqual(['repo']);
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'credentials.create' }),
      );
    });
  });

  describe('delete', () => {
    it('404s when credential belongs to someone else', async () => {
      prisma.githubCredential.findUnique.mockResolvedValue({
        id: 'CRED_ID',
        user_id: 'SOMEONE_ELSE',
      });
      await expect(
        controller.delete(user, 'CRED_ID', '127.0.0.1'),
      ).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.githubCredential.delete).not.toHaveBeenCalled();
    });

    it('deletes and audits when owned', async () => {
      prisma.githubCredential.findUnique.mockResolvedValue({
        id: 'CRED_ID',
        user_id: user.id,
      });
      prisma.githubCredential.delete.mockResolvedValue({ id: 'CRED_ID' });

      await expect(
        controller.delete(user, 'CRED_ID', '127.0.0.1'),
      ).resolves.toBeUndefined();
      expect(prisma.githubCredential.delete).toHaveBeenCalledWith({
        where: { id: 'CRED_ID' },
      });
      expect(audit.log).toHaveBeenCalledWith(
        expect.objectContaining({ action: 'credentials.delete' }),
      );
    });
  });
});
