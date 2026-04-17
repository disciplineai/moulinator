# Phase 1 — Backend Core

**Agent:** backend-core
**Scope:** domain services under `apps/api/src/core/*` and `apps/api/src/webhooks/jenkins/*` — the implementations behind the interfaces exported by `packages/api-core-contracts/`. Backend-crud's controllers delegate to these via the `*_SERVICE` IoC tokens.

## What shipped

| Deliverable | Path | Purpose |
|---|---|---|
| Crypto | `apps/api/src/core/crypto/` | AES-256-GCM envelope encryption of GitHub PATs |
| GitHub client | `apps/api/src/core/github/` | PAT validation, repo meta, tarball archive, tests-repo HEAD resolver |
| Storage | `apps/api/src/core/storage/` | MinIO client: presigned URLs, bucket lifecycle, internal PUTs |
| Jenkins client | `apps/api/src/core/jenkins/` | Parameterised pipeline trigger + abort |
| Audit | `apps/api/src/core/audit/` | Append-only `AuditLog` writes, transaction-aware |
| Runs orchestrator | `apps/api/src/core/runs/runs.orchestrator.ts` | trigger + cancel; concurrency limit; pins at trigger time |
| Runs reaper | `apps/api/src/core/runs/runs.reaper.ts` | BullMQ repeatable job: heartbeat/wall-clock timeouts + late-abort retries |
| Aborts queue | `apps/api/src/core/runs/aborts.queue.ts` | BullMQ durable retry of Jenkins abort calls |
| Webhook receiver | `apps/api/src/webhooks/jenkins/jenkins-webhook.service.ts` | HMAC + idempotent + atomic state transitions |
| Root core module | `apps/api/src/core/core.module.ts` | Binds all interfaces to real implementations; replaces stubs in `AppModule` |

## Design decisions (why, not what)

### 1. AES-256-GCM with a per-row random DEK wrapped by the master key

Each PAT ciphertext is encrypted with a **fresh** 32-byte DEK; that DEK is then wrapped under `MASTER_KEY_HEX` using AES-256-GCM with its own random 12-byte IV. The three fixed-size fields (`iv`, `auth_tag`, `wrapped_dek`) map directly onto the `github_credentials` schema. Packing of `wrapped_dek` is `iv(12) || ciphertext(32) || authTag(16) = 60 bytes`.

Why envelope encryption over a single key derivation (e.g. HKDF(master, row_id))? Two reasons:

- Key rotation without re-encrypting ciphertext: re-wrap just the DEKs under a new master, leave the outer ciphertext untouched.
- Per-row compromise isolation: leaking one row's DEK does not leak others.

DEK buffers are zeroed in a `finally` block on both encrypt and decrypt paths. Plaintext PATs are strings (immutable in JS) — we never log them and drop them as soon as `archiveCommit` returns. The master key never leaves `CryptoService`.

### 2. Minimal hand-rolled GitHub client (no `@octokit/*`)

`@octokit/rest` v21+ is pure-ESM and pulls in a long dependency chain. Using the three REST endpoints we need (`GET /user`, `GET /repos/:owner/:repo`, `GET /repos/:owner/:repo/tarball/:sha`, `GET /repos/:owner/:repo/branches/:branch`) via `fetch` is ~100 lines and keeps ts-jest happy without babel transform hacks. Unit tests replace `global.fetch` with a per-test stub; this gives us exact control over 401/403/404/5xx branches.

The PAT rides on the `Authorization` header only; it is never included in a log line, never written to disk. The tarball is fetched into a `Buffer` in memory and handed to the orchestrator for immediate upload to MinIO. We rely on HTTP redirects being followed by default (`redirect: 'follow'`).

### 3. Tests-repo HEAD resolution path

The SSH `TESTS_REPO_URL` + deploy key belongs to the runner plane. The control plane cannot use it. The student's PAT is the wrong scope. So backend-core resolves the tests-repo HEAD via the GitHub REST API at trigger time, using three new env vars that `devops-expert` owns on `.env.template`:

- `TESTS_REPO_HTTPS_URL` — explicit https clone URL (derivation from `TESTS_REPO_URL` as fallback).
- `TESTS_REPO_READ_TOKEN` — optional PAT with `contents:read` on the tests-repo. Only required if the tests-repo is private.
- `TESTS_REPO_DEFAULT_BRANCH` — default `main`.

The resolved SHA is written into the `TestRun.tests_repo_commit_sha` column **before** Jenkins is called. This is the authoritative value for the reproducibility invariant; the `build_started` webhook later confirms it matches.

### 4. Concurrency limit + CAS transitions

The orchestrator enforces "one non-terminal run per user" with a read-then-create pattern. Under load this is best-effort; strict enforcement would require either `SERIALIZABLE` isolation or a per-user advisory lock (Postgres `pg_advisory_xact_lock(hashtext(user_id))`). For MVP the limit is a UX fence, not a billing boundary — collisions are rare, the worst-case is two queued rows per user.

All status transitions use **compare-and-swap** via `updateMany({ where: { id, status: expectedPrev }, data: ... })` inside a transaction. If `count === 0`, another writer transitioned the row; we respond accordingly (webhook returns `terminal`, cancel re-reads).

### 5. Webhook receiver — HMAC, idempotency, atomic transitions

The receiver follows `docs/webhook-contract.md` strictly:

1. **Signature** — constant-time HMAC-SHA256 verify against `JENKINS_WEBHOOK_SECRET`. Bad → audit `webhook_rejected_signature`, return `invalid_signature`.
2. **Idempotency** — `sha256(rawBody)` is the `payload_hash`. Lookup existing `WebhookEvent` by key:
   - Missing → insert inside the transaction; unique-violation race → `duplicate`.
   - Present with mismatched hash → `duplicate` (body substitution detection).
   - Present with hash match + `processed_at` set → `duplicate`.
   - Present with hash match + `processed_at` null → **recoverable retry**, fall through to apply (matches `webhook-contract.md:26`).
3. **Transaction** — from `WebhookEvent` insert through transition + `TestCaseResult`/`BuildArtifact` writes + `AuditLog` entry + `processed_at` update, everything is one `prisma.$transaction`. Nothing leaks a half-applied state.
4. **Terminal runs** — return `terminal` and mark `processed_at` now. For a late `build_started` on a terminal row, we enqueue an abort job (via `AbortsQueue`) using the payload's `jenkins_build_url`. We never mutate the terminal `TestRun` row (pins are write-once; terminal state is immutable per `run-state-machine.md:17`).

### 6. Pin equality check on `build_started`

Pins are written at trigger time. When `build_started` arrives:

- If `runner_image_digest` or `tests_repo_commit_sha` in the payload differs from what's stored, the receiver:
  1. CAS transitions `queued → error` with `cancellation_reason='pin_mismatch'`.
  2. Persists `jenkins_build_url` from the payload so the abort job can reach the real Jenkins build.
  3. Audits the diff.
  4. Marks `WebhookEvent.processed_at = now()`.
  5. Enqueues a BullMQ abort job for the reported `jenkins_build_url`.
  6. Returns `processed` (HTTP 200) — the webhook *is* successfully processed from the API's perspective (an error state is a legal, documented outcome), and Jenkins should not retry a pin mismatch because it is an unrecoverable infra bug.

  The `queued → error` transition was blessed by team-lead and added to `docs/run-state-machine.md`.
- If pins match, CAS `queued → running`, populate `started_at` + `jenkins_build_url`, audit.

### 7. Reaper — BullMQ repeatable job, every 60s

One repeatable `runs-reaper` BullMQ job, fired every 60s with `jobId: 'sweep:tick'` (dedupes across restarts). Each tick:

- Finds `running` rows with stale heartbeat (`heartbeat_at < now() - HEARTBEAT_TIMEOUT_SECONDS`) OR wall-clock expired (`timeout_at < now()`) → CAS to `timed_out` with `cancellation_reason`.
- Re-enqueues abort jobs for terminal rows (`cancelled`/`timed_out`/`error`) that still have a `jenkins_build_url` and `finished_at` within the last 24h. This is the late-abort safety net; BullMQ jobId dedupe makes it idempotent.

The reaper also scans `queued` rows past their `timeout_at` and transitions them to `error` with `cancellation_reason='timeout_before_start'`. This transition was blessed by team-lead and added to `docs/run-state-machine.md`. It catches the case where Jenkins never ACKs with `build_started` — a failure mode that otherwise leaves queued rows stuck forever.

### 8. AbortsQueue — durable late-abort

Separate BullMQ queue `runs-aborts`. Each job has:

- `jobId: abort:<testRunId>` — dedupes re-enqueues.
- `attempts: 10`, exponential backoff with 30s base.
- `removeOnComplete: true`, `removeOnFail: false` (failed jobs stay for audit).

Worker calls `JenkinsClient.abortBuild`; 200/404 → success (build already gone or aborted). Other 4xx/5xx/network → retry. After 10 attempts the job goes to the failed set — an operator alert.

### 9. Storage — two S3 clients

`StorageService` holds two S3 clients sharing credentials:

- **Internal** (`MINIO_ENDPOINT`) — for PUTs from the control plane (workspace tarballs) and DELETEs.
- **Presigner** (`MINIO_PUBLIC_ENDPOINT`) — for signed URLs that runners can resolve across the plane boundary.

Bucket creation + lifecycle policies are applied on boot (idempotent). Lifecycle: `workspaces/` 1 day, `logs/` 30 days, `junit/` 30 days. Boot failure is non-fatal — logs a warning and continues. Disable via `MOULINATOR_SKIP_BUCKET_BOOTSTRAP=1`.

### 10. Jenkins client — fetch + Basic auth + CSRF crumb

No NPM Jenkins library — the REST surface we use is `POST /job/{name}/buildWithParameters`, `GET /crumbIssuer/api/json`, `POST {build}/stop`, `POST {queue}/cancelQueue`. All go over Node's native `fetch`. Crumb is cached per-process; on a 403 we invalidate and retry once.

Trigger params match the `Jenkinsfile` declarations exactly (`test_run_id`, `workspace_url`, `tests_repo_url`, `tests_commit_sha`, `runner_image_digest`, `project_slug`, `harness_entrypoint`, `timeout_seconds`, `memory_mb`, `cpus`, `pids`, `hermetic`, `egress_allowlist_json`, `logs_upload_url`, `junit_upload_url`, `webhook_url`). No PAT ever passes to Jenkins.

## Testing

```
pnpm -C apps/api test
```

Current state: **11 suites, 68 tests, all green**. Coverage:

- `crypto.service.spec.ts` — master-key validation, round-trip, fresh IV per encrypt, tampering detection on ciphertext / authTag / wrappedDek, cross-key failure, input validation.
- `storage.service.spec.ts` — presign GET/PUT, putObject/delete command wiring, idempotent lifecycle/bucket creation.
- `github.client.spec.ts` — URL parsing (https, scp-ssh, ssh://), PAT validation + scopes, repo meta, 404 mapping, tarball body as Buffer, commit-sha regex guard, `getBranchHead`.
- `jenkins.client.spec.ts` — crumb + buildWithParameters happy path, no-crumb fallback, 500 → error, `/stop` on builds, `cancelQueue` on queue items, 404 tolerance on abort.
- `jenkins-webhook.service.spec.ts` — full replay (`build_started` → heartbeat → `build_completed = passed`), pin-mismatch 422 without transition, duplicate key, HMAC mismatch, `build_errored` → error, `build_completed` with a failed case → failed, terminal-run abort enqueue, malformed idempotency key.
- `runs.orchestrator.spec.ts` — happy-path trigger, 429 on concurrent, 404 on unknown repo, jenkins-trigger failure → run marked error, cancel queued/running/abort-failure/terminal.
- `runs.reaper.spec.ts` — stale heartbeat → timed_out, wall-clock expired → timed_out, terminal run with URL → abort enqueued.
- Plus the pre-existing backend-crud controller suites (auth, runs, credentials).

All tests run with no DB, no Redis, no MinIO, no Jenkins, no network. `MOULINATOR_DISABLE_QUEUES=1` disables BullMQ wiring in tests.

## State-machine map

Every transition this agent owns:

| From → To | Owner | Inside |
|---|---|---|
| (none) → `queued` | `RunsOrchestrator.triggerRun` | one transaction with the `TestRun` + artifact + audit rows |
| `queued` → `error` (trigger failure) | `RunsOrchestrator.triggerRun` | same transaction; CAS `status='queued'` |
| `queued` → `error` (pin mismatch) | `JenkinsWebhookService` (build_started) | CAS + audit + `WebhookEvent.processed_at` + abort enqueue |
| `queued` → `error` (timeout before start) | `RunsReaper.sweep` | CAS + audit |
| `queued` → `cancelled` | `RunsOrchestrator.cancelRun` | CAS + audit |
| `queued` → `running` | `JenkinsWebhookService` (build_started) | CAS + audit + `WebhookEvent.processed_at` |
| `running` → `passed`/`failed` | `JenkinsWebhookService` (build_completed) | CAS + `TestCaseResult[]` + `BuildArtifact[]` + audit + processed_at |
| `running` → `error` | `JenkinsWebhookService` (build_errored) OR `RunsOrchestrator.cancelRun` (abort failed) | CAS + audit |
| `running` → `cancelled` | `RunsOrchestrator.cancelRun` | abort first; CAS + audit |
| `running` → `timed_out` | `RunsReaper.sweep` | CAS + audit |

Everything is idempotent under duplicate webhook deliveries because: (a) the `WebhookEvent` table dedupes, (b) all transitions are CAS keyed on the expected prior status.

## Security notes

- Plaintext PATs: memory-only, scoped to one `archiveCommit` call. No log statements along that path include the token.
- `MASTER_KEY_HEX` validation is strict (exactly 64 hex chars). Mismatched lengths throw on boot.
- The HMAC secret is a Buffer pinned at boot; `timingSafeEqual` is used for both the header comparison and `payload_hash` lookups.
- CSP-style no-stringification: `audit.metadata` never includes raw bodies or PATs.

## Open items / trade-offs

1. **Integration tests against real Postgres.** The current suite uses in-memory Prisma doubles. A `pnpm test:int` target with testcontainers Postgres would catch schema drift the doubles miss (foreign keys, enum coercions). Not shipped yet; doubles are sufficient for the contract-level assertions.
2. **Concurrency limit under load.** See §4 — strict enforcement requires a lock/isolation upgrade. Acceptable for MVP.
3. **Queued-row timeout.** Pending team-lead decision on whether the reaper can transition `queued → error` on `timeout_at` expiry, or whether that stays on the orchestrator alone. See the top-of-file message in `SendMessage` to team-lead.
4. **Env vars.** `TESTS_REPO_HTTPS_URL`, `TESTS_REPO_READ_TOKEN`, `TESTS_REPO_DEFAULT_BRANCH` have been requested from `devops-expert` for inclusion in `.env.template`.
