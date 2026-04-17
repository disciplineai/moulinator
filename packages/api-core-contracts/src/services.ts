import type { Ulid } from './dto';
import type {
  JenkinsWebhookEventName,
  JenkinsWebhookPayload,
  JenkinsWebhookHeaders,
} from './events';

export interface EncryptedPat {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
  wrappedDek: Buffer;
}

export interface ICryptoService {
  encryptPat(plaintext: string): Promise<EncryptedPat>;
  decryptPat(blob: EncryptedPat): Promise<string>;
}

export interface GithubRepoMeta {
  owner: string;
  repo: string;
  defaultBranch: string;
  private: boolean;
}

export interface GithubPatValidation {
  valid: boolean;
  scopes: string[];
  login?: string;
  reason?: string;
}

export interface IGithubClient {
  validatePat(token: string): Promise<GithubPatValidation>;
  getRepoMeta(token: string, githubUrl: string): Promise<GithubRepoMeta>;
  archiveCommit(
    token: string,
    githubUrl: string,
    commitSha: string,
  ): Promise<Buffer>;
}

export interface TriggerRunInput {
  userId: Ulid;
  repoId: Ulid;
  commitSha: string;
}

export interface TriggerRunResult {
  runId: Ulid;
  correlationId: string;
  timeoutAt: Date;
}

export interface IRunsOrchestrator {
  triggerRun(input: TriggerRunInput): Promise<TriggerRunResult>;
  cancelRun(runId: Ulid, reason: string): Promise<void>;
}

export type JenkinsWebhookResult =
  | { status: 'processed' }
  | { status: 'queued' }
  | { status: 'duplicate' }
  | { status: 'not_found' }
  | { status: 'terminal' }
  | { status: 'invalid_signature' }
  | { status: 'invalid_payload'; detail?: string };

export interface IJenkinsWebhookService {
  handle(
    event: JenkinsWebhookEventName,
    rawBody: Buffer,
    parsedBody: JenkinsWebhookPayload,
    headers: JenkinsWebhookHeaders,
  ): Promise<JenkinsWebhookResult>;
}

export interface PresignOptions {
  key: string;
  bucket: string;
  expiresInSeconds?: number;
  contentType?: string;
}

export interface PresignedUrl {
  url: string;
  expiresAt: Date;
}

export interface IStorageService {
  presignGet(opts: PresignOptions): Promise<PresignedUrl>;
  presignPut(opts: PresignOptions): Promise<PresignedUrl>;
  delete(bucket: string, key: string): Promise<void>;
}

export interface AuditEntry {
  actorId: Ulid | null;
  action: string;
  entity?: string;
  entityId?: string;
  ip?: string;
  metadata?: Record<string, unknown>;
}

export interface IAuditService {
  log(entry: AuditEntry): Promise<void>;
}

export const CRYPTO_SERVICE = Symbol('ICryptoService');
export const GITHUB_CLIENT = Symbol('IGithubClient');
export const RUNS_ORCHESTRATOR = Symbol('IRunsOrchestrator');
export const JENKINS_WEBHOOK_SERVICE = Symbol('IJenkinsWebhookService');
export const STORAGE_SERVICE = Symbol('IStorageService');
export const AUDIT_SERVICE = Symbol('IAuditService');
