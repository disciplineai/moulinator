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
  /**
   * Variant that returns the plaintext as a mutable Buffer. Callers MUST
   * `buf.fill(0)` in a `finally` as soon as the PAT is no longer needed.
   * Prefer this over `decryptPat` for server-side archive flows so that the
   * token lives in a buffer we can zero rather than an immutable string.
   */
  decryptPatToBuffer(blob: EncryptedPat): Promise<Buffer>;
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

/**
 * Minimal surface the orchestrator needs from the credentials module so it
 * can stamp `last_used_at` on every PAT use. Keeps a direct orchestrator →
 * CredentialsService import from creating a module cycle.
 */
export interface ICredentialsService {
  markUsed(credentialId: Ulid): Promise<void>;
}

/**
 * Refresh-token persistence + rotation. Implemented by backend-core
 * (apps/api/src/core/auth/refresh-token.service.ts) against the
 * `refresh_tokens` Prisma table; consumed by AuthService.
 *
 * Signed JWT payload is `{ sub: userId, jti, typ: 'refresh', iat, exp }`.
 * No role/email — that's the access token's job.
 */
export interface IssuedRefreshToken {
  token: string;
  jti: string;
  expiresAt: Date;
}

export interface VerifiedRefreshToken {
  userId: Ulid;
  jti: string;
}

export interface IRefreshTokenStore {
  /** Insert a new refresh-token row + return the signed JWT. */
  issue(userId: Ulid, ttlSeconds: number): Promise<IssuedRefreshToken>;
  /**
   * Verify JWT signature + DB state (exists, not expired, not revoked).
   * Returns null for any failure — caller maps null to 401.
   */
  verify(token: string): Promise<VerifiedRefreshToken | null>;
  /**
   * Rotate: mark the old jti revoked + insert a new jti in one transaction.
   * If the old row is already revoked, the store MUST treat that as reuse,
   * call `revokeAllForUser(userId, 'reuse_detected')`, and throw.
   */
  rotate(
    oldJti: string,
    userId: Ulid,
    ttlSeconds: number,
  ): Promise<IssuedRefreshToken>;
  /** Revoke a single jti (idempotent). */
  revoke(jti: string): Promise<void>;
  /** Revoke every non-revoked token for a user — theft response + logout-all. */
  revokeAllForUser(userId: Ulid, reason: string): Promise<void>;
}

export const CRYPTO_SERVICE = Symbol('ICryptoService');
export const GITHUB_CLIENT = Symbol('IGithubClient');
export const RUNS_ORCHESTRATOR = Symbol('IRunsOrchestrator');
export const JENKINS_WEBHOOK_SERVICE = Symbol('IJenkinsWebhookService');
export const STORAGE_SERVICE = Symbol('IStorageService');
export const AUDIT_SERVICE = Symbol('IAuditService');
export const CREDENTIALS_SERVICE = Symbol('ICredentialsService');
export const REFRESH_TOKEN_STORE = Symbol('IRefreshTokenStore');
