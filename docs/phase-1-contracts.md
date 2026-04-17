# Phase 1 — Backend interface contracts (backend-crud ↔ backend-core)

> Source of truth: `packages/api-core-contracts/src/`. Update this doc in lockstep.
> If backend-core needs a shape to change, open a short discussion with backend-crud
> **before** editing the package — controllers depend on these symbols.

Backend-crud owns HTTP surface + persistence. Backend-core owns domain
behaviour (encryption, GitHub I/O, orchestration, webhook processing,
storage presign). They meet at the symbols below.

## Provider tokens

Register backend-core implementations against these DI tokens (imported
from `@moulinator/api-core-contracts`):

| Token | Interface |
|---|---|
| `CRYPTO_SERVICE` | `ICryptoService` |
| `GITHUB_CLIENT` | `IGithubClient` |
| `RUNS_ORCHESTRATOR` | `IRunsOrchestrator` |
| `JENKINS_WEBHOOK_SERVICE` | `IJenkinsWebhookService` |
| `STORAGE_SERVICE` | `IStorageService` |
| `AUDIT_SERVICE` | `IAuditService` |

`apps/api/src/core-contracts/core-contracts.module.ts` ships with stubs
that throw `ServiceUnavailableException` for the dangerous operations and
log for audit. Backend-core replaces the providers by exporting a module
that re-binds each token with `{ provide, useClass }`. Do **not** edit the
stubs — override them.

## Interface reference

### `ICryptoService`

```ts
encryptPat(plaintext: string): Promise<EncryptedPat>;
decryptPat(blob: EncryptedPat): Promise<string>;
```

`EncryptedPat` is `{ ciphertext, iv, authTag, wrappedDek }` — all `Buffer`s.
Crud persists exactly those bytes to the `github_credentials` table and
passes them back on decrypt. Crud never inspects them.

### `IGithubClient`

```ts
validatePat(token: string): Promise<GithubPatValidation>;
getRepoMeta(token: string, githubUrl: string): Promise<GithubRepoMeta>;
archiveCommit(token: string, githubUrl: string, commitSha: string): Promise<Buffer>;
```

- `validatePat` is called on `POST /me/credentials` before storage. If
  `valid === false`, crud responds `422 pat_invalid` with `reason` as the
  human message.
- `archiveCommit` is consumed by the orchestrator, not by crud directly.

### `IRunsOrchestrator`

```ts
triggerRun(input: { userId, repoId, commitSha }): Promise<{ runId, correlationId, timeoutAt }>;
cancelRun(runId, reason): Promise<void>;
```

Crud invariants:

- `triggerRun` is responsible for **inserting** the `TestRun` row (with
  `status=queued`, `correlation_id`, `timeout_at`) and enqueueing the
  Jenkins trigger. Crud re-reads the row by `runId` to build the
  `201` response — this is why the orchestrator returns the ULID.
- On `cancelRun`, backend-core handles the state-machine transition
  (queued → cancelled, or running → cancelled via Jenkins abort). Crud
  has already validated that the run is non-terminal, and will **not**
  flip the status itself.

### `IJenkinsWebhookService`

```ts
handle(event, rawBody, parsedBody, headers): Promise<JenkinsWebhookResult>;
```

Crud wires a raw-body middleware on `POST /webhooks/jenkins` so
backend-core gets the exact bytes for HMAC verification. `rawBody` is the
unparsed `Buffer`; `parsedBody` is the already-deserialized JSON for
convenience. Backend-core's result string maps 1:1 to HTTP status per
`docs/webhook-contract.md`:

| Result | HTTP |
|---|---|
| `processed` | `200 { status: 'processed' }` |
| `queued` | `200 { status: 'queued' }` (logically `202` per contract) |
| `duplicate` | `409 duplicate_idempotency_key` |
| `not_found` | `404 test_run_not_found` |
| `terminal` | `410 run_terminal` |
| `invalid_signature` | `401 invalid_signature` |
| `invalid_payload` | `422 invalid_payload` |

### `IStorageService`

```ts
presignGet(opts), presignPut(opts), delete(bucket, key)
```

Crud only uses `presignGet` for `GET /artifacts/:id/url`. TTL defaults to
300s. Bucket is chosen from `BuildArtifact.kind`:

| kind | bucket |
|---|---|
| `logs` | `logs` |
| `junit` | `junit` |
| `tarball` | `workspaces` |

### `IAuditService`

```ts
log(entry: AuditEntry): Promise<void>;
```

Crud emits audit logs on every auth event, credential CRUD, repo CRUD,
run trigger, run cancel, and contribution create. Entry shape is
`{ actorId, action, entity?, entityId?, ip?, metadata? }` — backend-core
implements the actual write to `audit_logs`.

## DTOs

`packages/api-core-contracts/src/dto.ts` exports TypeScript shapes that
mirror `openapi.yaml` schemas (`UserDto`, `RepoDto`, `RunDto`, etc.). The
frontend client is free to reference these if convenient, but it is not
a hard contract with the web side — `openapi.yaml` remains the authority.

## Stability

Don't rename tokens. Adding fields to an interface is additive if
optional; removing fields is a breaking change — coordinate first.

## Phase 5 additions (2026-04-17)

Three new DI tokens landed as part of the Phase 3 security review response:

### `CREDENTIALS_SERVICE` → `ICredentialsService`

Exposed by the `CredentialsModule` (Global, backend-crud) so the
orchestrator can stamp `last_used_at` whenever it decrypts a PAT.

```ts
interface ICredentialsService {
  markUsed(credentialId: Ulid): Promise<void>;
}
```

`markUsed` is last-writer-wins — no row lock, no condition. It also
writes an `credentials.used` audit entry. Safe to call concurrently.

### `REFRESH_TOKEN_STORE` → `IRefreshTokenStore`

Owned by backend-core (real implementation lives in
`apps/api/src/core/auth/refresh-token.service.ts`), consumed by
`AuthService` in backend-crud. Backs the cookie-based refresh flow.

```ts
interface IRefreshTokenStore {
  issue(userId, ttlSeconds): Promise<IssuedRefreshToken>;
  verify(token): Promise<VerifiedRefreshToken | null>;
  rotate(oldJti, userId, ttlSeconds): Promise<IssuedRefreshToken>;
  revoke(jti): Promise<void>;
  revokeAllForUser(userId, reason): Promise<void>;
}
```

`rotate` is the theft-detection hook: if the presented jti is already
revoked, `rotate` MUST call `revokeAllForUser(userId, 'reuse_detected')`
and throw — AuthService will surface that as a 401 and the user has to
log in again. Backing table is `refresh_tokens` (see
`prisma/schema.prisma`).

Until backend-core lands the real service, `AuthModule` binds
`StubRefreshTokenStore` at the same token — every mutating method
throws `ServiceUnavailableException({ error: 'refresh_store_not_wired' })`
so an unwired deploy fails loudly rather than silently issuing
non-revocable tokens.

### `ICryptoService.decryptPatToBuffer`

Added by backend-core for F7 (PAT closure scope-down). Returns a mutable
Buffer so callers can `buf.fill(0)` in a finally. Crud still uses the
string-returning `decryptPat` in places where zeroing isn't required;
the orchestrator uses the buffer variant.
