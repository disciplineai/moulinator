import { Module } from '@nestjs/common';
import { JENKINS_WEBHOOK_SERVICE } from '@moulinator/api-core-contracts';
import { PrismaModule } from '../../prisma/prisma.module';
import { AuditModule } from '../../core/audit/audit.module';
import { RunsCoreModule } from '../../core/runs/runs-core.module';
import { JenkinsWebhookService } from './jenkins-webhook.service';

@Module({
  imports: [PrismaModule, AuditModule, RunsCoreModule],
  providers: [
    JenkinsWebhookService,
    { provide: JENKINS_WEBHOOK_SERVICE, useExisting: JenkinsWebhookService },
  ],
  exports: [JenkinsWebhookService, JENKINS_WEBHOOK_SERVICE],
})
export class JenkinsWebhookModule {}
