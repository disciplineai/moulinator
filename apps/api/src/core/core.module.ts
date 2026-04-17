import { Global, Module } from '@nestjs/common';
import {
  AUDIT_SERVICE,
  CRYPTO_SERVICE,
  GITHUB_CLIENT,
  JENKINS_WEBHOOK_SERVICE,
  RUNS_ORCHESTRATOR,
  STORAGE_SERVICE,
} from '@moulinator/api-core-contracts';
import { CryptoModule } from './crypto/crypto.module';
import { GithubModule } from './github/github.module';
import { StorageModule } from './storage/storage.module';
import { JenkinsModule } from './jenkins/jenkins.module';
import { AuditModule } from './audit/audit.module';
import { RunsCoreModule } from './runs/runs-core.module';
import { JenkinsWebhookModule } from '../webhooks/jenkins/jenkins-webhook.module';

/**
 * Aggregates every backend-core module and re-exports the IoC symbols the
 * backend-crud controllers depend on. Importing this module in AppModule
 * replaces the stubs in CoreContractsModule with real implementations.
 */
@Global()
@Module({
  imports: [
    CryptoModule,
    GithubModule,
    StorageModule,
    JenkinsModule,
    AuditModule,
    RunsCoreModule,
    JenkinsWebhookModule,
  ],
  exports: [
    CryptoModule,
    GithubModule,
    StorageModule,
    JenkinsModule,
    AuditModule,
    RunsCoreModule,
    JenkinsWebhookModule,
  ],
})
export class CoreModule {
  /** Tokens re-exported for clarity. */
  static readonly tokens = {
    CRYPTO_SERVICE,
    GITHUB_CLIENT,
    STORAGE_SERVICE,
    AUDIT_SERVICE,
    RUNS_ORCHESTRATOR,
    JENKINS_WEBHOOK_SERVICE,
  };
}
