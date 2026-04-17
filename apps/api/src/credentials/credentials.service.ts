import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ulid } from 'ulid';
import {
  AUDIT_SERVICE,
  CRYPTO_SERVICE,
  GITHUB_CLIENT,
  type GithubCredentialMetaDto,
  type IAuditService,
  type ICryptoService,
  type IGithubClient,
} from '@moulinator/api-core-contracts';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class CredentialsService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(CRYPTO_SERVICE) private readonly crypto: ICryptoService,
    @Inject(GITHUB_CLIENT) private readonly github: IGithubClient,
    @Inject(AUDIT_SERVICE) private readonly audit: IAuditService,
  ) {}

  async list(userId: string): Promise<GithubCredentialMetaDto[]> {
    const rows = await this.prisma.githubCredential.findMany({
      where: { user_id: userId },
      orderBy: { created_at: 'desc' },
    });
    return rows.map((r) => ({
      id: r.id,
      label: r.label,
      scopes: r.scopes,
      last_used_at: r.last_used_at ? r.last_used_at.toISOString() : null,
      created_at: r.created_at.toISOString(),
    }));
  }

  async create(
    userId: string,
    token: string,
    label: string | undefined,
    ip?: string,
  ): Promise<GithubCredentialMetaDto> {
    const validation = await this.github.validatePat(token);
    if (!validation.valid) {
      throw new UnprocessableEntityException({
        error: 'pat_invalid',
        message: validation.reason ?? 'GitHub rejected the token',
      });
    }
    const encrypted = await this.crypto.encryptPat(token);
    const id = ulid();

    // F8: enforce "one credential per user" — delete any existing rows and
    // insert the new one in a single transaction.
    const { row, replacedIds } = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.githubCredential.findMany({
        where: { user_id: userId },
        select: { id: true },
      });
      if (existing.length > 0) {
        await tx.githubCredential.deleteMany({ where: { user_id: userId } });
      }
      const created = await tx.githubCredential.create({
        data: {
          id,
          user_id: userId,
          label: label ?? validation.login ?? 'github',
          ciphertext: encrypted.ciphertext,
          iv: encrypted.iv,
          auth_tag: encrypted.authTag,
          wrapped_dek: encrypted.wrappedDek,
          scopes: validation.scopes,
        },
      });
      return { row: created, replacedIds: existing.map((r) => r.id) };
    });

    if (replacedIds.length > 0) {
      await this.audit.log({
        actorId: userId,
        action: 'credentials.replaced',
        entity: 'github_credential',
        entityId: id,
        ip,
        metadata: { replaced: replacedIds },
      });
    }
    await this.audit.log({
      actorId: userId,
      action: 'credentials.create',
      entity: 'github_credential',
      entityId: id,
      ip,
    });
    return {
      id: row.id,
      label: row.label,
      scopes: row.scopes,
      last_used_at: row.last_used_at ? row.last_used_at.toISOString() : null,
      created_at: row.created_at.toISOString(),
    };
  }

  async delete(userId: string, id: string, ip?: string): Promise<void> {
    const row = await this.prisma.githubCredential.findUnique({ where: { id } });
    if (!row || row.user_id !== userId) {
      throw new NotFoundException({ error: 'credential_not_found' });
    }
    await this.prisma.githubCredential.delete({ where: { id } });
    await this.audit.log({
      actorId: userId,
      action: 'credentials.delete',
      entity: 'github_credential',
      entityId: id,
      ip,
    });
  }

  /**
   * F6: unconditional last-writer-wins stamp on `last_used_at`. Called by
   * the orchestrator every time it decrypts a PAT to clone. Safe to run
   * concurrently — no lock; we do not care about `updated_at` drift here.
   */
  async markUsed(credentialId: string): Promise<void> {
    const row = await this.prisma.githubCredential.update({
      where: { id: credentialId },
      data: { last_used_at: new Date() },
      select: { id: true, user_id: true },
    });
    await this.audit.log({
      actorId: row.user_id,
      action: 'credentials.used',
      entity: 'github_credential',
      entityId: row.id,
    });
  }
}
