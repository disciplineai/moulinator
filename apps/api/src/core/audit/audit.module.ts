import { Module } from '@nestjs/common';
import { AUDIT_SERVICE } from '@moulinator/api-core-contracts';
import { AuditService } from './audit.service';

@Module({
  providers: [
    AuditService,
    { provide: AUDIT_SERVICE, useExisting: AuditService },
  ],
  exports: [AuditService, AUDIT_SERVICE],
})
export class AuditModule {}
