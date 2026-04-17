import { Module } from '@nestjs/common';
import { RUNS_ORCHESTRATOR } from '@moulinator/api-core-contracts';
import { PrismaModule } from '../../prisma/prisma.module';
import { CryptoModule } from '../crypto/crypto.module';
import { GithubModule } from '../github/github.module';
import { StorageModule } from '../storage/storage.module';
import { JenkinsModule } from '../jenkins/jenkins.module';
import { AuditModule } from '../audit/audit.module';
import { RunsOrchestrator } from './runs.orchestrator';
import { RunsReaper } from './runs.reaper';
import { AbortsQueue } from './aborts.queue';

@Module({
  imports: [
    PrismaModule,
    CryptoModule,
    GithubModule,
    StorageModule,
    JenkinsModule,
    AuditModule,
  ],
  providers: [
    AbortsQueue,
    RunsOrchestrator,
    { provide: RUNS_ORCHESTRATOR, useExisting: RunsOrchestrator },
    RunsReaper,
  ],
  exports: [RunsOrchestrator, RUNS_ORCHESTRATOR, AbortsQueue, RunsReaper],
})
export class RunsCoreModule {}
