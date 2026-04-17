# Jenkins → NestJS webhook contract

> Contract-freeze artifact. Owned by main agent. Build agents consume this; they do not modify it.

## Endpoint

```
POST /webhooks/jenkins
Content-Type: application/json
X-Moulinator-Signature: sha256=<hmac_hex>
X-Moulinator-Idempotency-Key: <uuid-v4>
X-Moulinator-Event: build_started | heartbeat | build_completed | build_errored
```

## Authentication — HMAC-SHA256

- Shared secret `JENKINS_WEBHOOK_SECRET` is loaded into both Jenkins (as a credential) and NestJS (as env var).
- Jenkins computes `hmac_sha256(secret, raw_body)` and sends it as `X-Moulinator-Signature: sha256=<hex>`.
- NestJS `webhooks/jenkins` verifies constant-time. Mismatches return `401` and are logged to `AuditLog` with action `webhook_rejected_signature`.

## Idempotency

- Jenkins generates one `X-Moulinator-Idempotency-Key` (UUID v4) per webhook emission. Retries reuse the same key.
- NestJS inserts `(idempotency_key)` into `WebhookEvent` with `payload_hash = sha256(body)`.
  - Unique constraint violation → return `409 Conflict`, body `{"status":"duplicate"}`. Do not emit state transitions.
  - On processing failure, the row keeps `processed_at = null` and Jenkins can retry — same key allows recovery.
- Key TTL is 14 days (vacuumed by cron).

## Events and payloads

### `build_started`

```json
{
  "test_run_id": "01J...",
  "jenkins_build_url": "https://jenkins.../job/moulinator/42/",
  "started_at": "2026-04-17T12:00:00Z",
  "runner_image_digest": "sha256:abc...",
  "tests_repo_commit_sha": "def456..."
}
```

Transitions `queued → running`. Populates `started_at`, `jenkins_build_url`. Confirms pinned fields.

### `heartbeat`

```json
{
  "test_run_id": "01J...",
  "heartbeat_at": "2026-04-17T12:00:30Z",
  "stage": "running_tests"
}
```

Updates `heartbeat_at`. No state transition.

### `build_completed`

```json
{
  "test_run_id": "01J...",
  "finished_at": "2026-04-17T12:02:15Z",
  "cases": [
    { "name": "basic_case_01", "status": "passed", "duration_ms": 12 },
    { "name": "basic_case_02", "status": "failed", "duration_ms": 8, "artifact_ref": "logs/01J.../case_02.log" }
  ],
  "artifacts": [
    { "kind": "logs", "s3_key": "logs/01J.../full.log", "size_bytes": 10240 },
    { "kind": "junit", "s3_key": "junit/01J.../results.xml", "size_bytes": 2048 }
  ]
}
```

Transitions `running → passed` (if every case `passed`) or `running → failed` (if any case `failed`). Writes `TestCaseResult` rows and `BuildArtifact` rows atomically with the transition.

### `build_errored`

```json
{
  "test_run_id": "01J...",
  "finished_at": "2026-04-17T12:01:00Z",
  "error": "runner_image_pull_failed",
  "detail": "manifest not found"
}
```

Transitions `running → error`. `cancellation_reason` = `<error>`.

## Response codes

| Code | Meaning |
|---|---|
| `200 OK` | Event accepted and processed |
| `202 Accepted` | Event queued for async processing |
| `401 Unauthorized` | Signature invalid |
| `404 Not Found` | `test_run_id` does not exist |
| `409 Conflict` | Duplicate `idempotency_key` |
| `410 Gone` | `test_run_id` is in a terminal state; event ignored |
| `422 Unprocessable Entity` | Payload schema invalid |
| `500 Internal Server Error` | Server fault — Jenkins should retry |

## Retry policy (Jenkins side)

- `200`, `202`, `409`, `410`, `422` → no retry.
- `401`, `404` → no retry (configuration error; surface in Jenkins build log).
- `5xx`, network error → exponential backoff with jitter, 6 attempts over ~10 minutes, same idempotency key.

## Replay protection

- Signature includes raw body, so body tampering fails verification.
- `idempotency_key` + `payload_hash` prevents duplicate processing and detects body substitution on retry (mismatch → `409`).
- `received_at` > 5 minutes after Jenkins clock drift tolerance → soft-warn in logs (not rejected, since clocks can drift).

## Backend processing rules

1. Verify signature (constant-time) → else `401`.
2. Insert into `WebhookEvent` with `(idempotency_key, payload_hash)` → unique violation → `409`.
3. Load `TestRun` by `test_run_id` → not found → `404`.
4. If `TestRun.status` terminal → update `WebhookEvent.processed_at`, return `410`.
5. Apply transition per state machine. Must be atomic with `TestCaseResult` / `BuildArtifact` inserts and `AuditLog` entry.
6. Set `WebhookEvent.processed_at = now()`.
