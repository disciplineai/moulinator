import { Injectable, Logger } from '@nestjs/common';
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  AuditEntry,
  IAuditService,
} from '@moulinator/api-core-contracts';
import { PrismaService } from '../../prisma/prisma.service';

type PrismaLike = Pick<PrismaClient, 'auditLog'> | Prisma.TransactionClient;

@Injectable()
export class AuditService implements IAuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async log(entry: AuditEntry): Promise<void> {
    return this.logWith(this.prisma, entry);
  }

  /** Allows callers holding a transaction client to write inside it. */
  async logWith(tx: PrismaLike, entry: AuditEntry): Promise<void> {
    await tx.auditLog.create({
      data: {
        actor_id: entry.actorId,
        action: entry.action,
        entity: entry.entity,
        entity_id: entry.entityId,
        ip: entry.ip,
        metadata:
          entry.metadata === undefined
            ? undefined
            : (entry.metadata as Prisma.InputJsonValue),
      },
    });
    this.logger.debug(
      `audit ${entry.action} actor=${entry.actorId ?? 'system'} entity=${entry.entity ?? '-'}`,
    );
  }
}
