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
    const row = await this.prisma.githubCredential.create({
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
}
