# TestRun state machine

> Contract-freeze artifact. Owned by main agent. Any state transition not listed here is a bug.

## States

| State | Meaning | Terminal? |
|---|---|---|
| `queued` | API accepted the trigger, not yet sent to Jenkins | no |
| `running` | Jenkins confirmed start; heartbeat expected | no |
| `passed` | All test cases passed | yes |
| `failed` | At least one test case failed | yes |
| `error` | Infrastructure error (runner crashed, webhook malformed, image pull failed) | yes |
| `cancelled` | User or admin cancelled the run | yes |
| `timed_out` | Heartbeat or wall-clock timeout exceeded | yes |

Terminal states are immutable. Re-running produces a **new** `TestRun` row with its own `correlation_id`.

## Transitions

```
                  ┌──────────── user trigger ────────────┐
                  │                                      ▼
                  │                                 ┌─────────┐
                  │         ┌───enqueue fails──────▶│  error  │
                  │         │                       └─────────┘
              (start)       │
                  │         │          ┌──── jenkins start ACK ────┐
                  ▼         │          ▼                           │
             ┌─────────┐────┴────▶┌─────────┐──webhook: all pass──▶┌─────────┐
             │ queued  │          │ running │                       │ passed  │
             └────┬────┘          └────┬────┘                       └─────────┘
                  │                    │
                  │                    ├──webhook: any fail───────▶┌─────────┐
     user/admin   │                    │                            │ failed  │
      cancel      │                    │                            └─────────┘
                  │                    │
                  ▼                    ├──heartbeat stale ────────▶┌──────────┐
              ┌───────────┐            │                            │timed_out │
              │ cancelled │            │                            └──────────┘
              └───────────┘            │
                                       ├──user/admin cancel ──────▶┌──────────┐
                                       │                            │cancelled │
                                       │                            └──────────┘
                                       │
                                       └──infra error ─────────────▶┌─────────┐
                                                                     │  error  │
                                                                     └─────────┘
```

## Transition ownership

| From → To | Trigger | Emitter |
|---|---|---|
| (none) → `queued` | POST `/runs` | NestJS `runs.controller` |
| `queued` → `running` | Jenkins webhook `build_started` | NestJS `webhooks/jenkins` |
| `queued` → `error` | Jenkins trigger returns non-2xx | NestJS `core/runs.orchestrator` |
| `queued` → `error` | `build_started` pins don't match what orchestrator pinned (`cancellation_reason='pin_mismatch'`); best-effort Jenkins abort enqueued | NestJS `webhooks/jenkins` |
| `queued` → `error` | `timeout_at < now()` with no `build_started` received (`cancellation_reason='timeout_before_start'`) | NestJS `core/runs.reaper` (cron) |
| `queued` → `cancelled` | DELETE `/runs/:id` before Jenkins ACKs | NestJS `runs.controller` |
| `running` → `passed` | Jenkins webhook `build_completed` with all cases passed | NestJS `webhooks/jenkins` |
| `running` → `failed` | Jenkins webhook `build_completed` with ≥1 case failed | NestJS `webhooks/jenkins` |
| `running` → `error` | Jenkins webhook `build_errored` or result parser fails | NestJS `webhooks/jenkins` |
| `running` → `cancelled` | DELETE `/runs/:id` + Jenkins abort succeeds | NestJS `runs.controller` |
| `running` → `timed_out` | Heartbeat > `HEARTBEAT_TIMEOUT_SECONDS` OR wall-clock past `timeout_at` | NestJS `core/runs.reaper` (cron) |

## Heartbeat

- Runner emits a heartbeat webhook every `HEARTBEAT_INTERVAL_SECONDS` (default 30s).
- NestJS `runs.reaper` runs every 60s with three scans:
  1. `running` rows with `heartbeat_at < now() - HEARTBEAT_TIMEOUT_SECONDS` (default 120s) → `timed_out`.
  2. `running` rows with `timeout_at < now()` → `timed_out`.
  3. `queued` rows with `timeout_at < now()` → `error` (`cancellation_reason='timeout_before_start'`). Covers the case where Jenkins never ACKs with `build_started`.
- On any reaper transition, NestJS calls Jenkins abort API (best-effort) to release the agent / cancel the queued build.

## Cancellation semantics

- `queued` cancel: mark `cancelled` immediately. If a late `build_started` webhook arrives for this terminal run, the handler returns `410 Gone` (no state mutation) AND enqueues a durable abort job (BullMQ, keyed on `test_run_id`) that calls Jenkins abort using the `jenkins_build_url` from the payload. Abort job retries with backoff; never mutates the terminal `TestRun` row.
- `running` cancel: call Jenkins abort first; on success, mark `cancelled` with `cancellation_reason`. If abort fails, flag as `error` with reason `abort_failed`.

## Idempotency on webhooks

Every webhook carries an `idempotency_key`. If a duplicate arrives (same key, already-processed event in `WebhookEvent`), the receiver returns `409 Conflict` without re-emitting transitions. See `docs/webhook-contract.md`.

## Fields per state

| Field | `queued` | `running` | terminal |
|---|---|---|---|
| `started_at` | null | set on `running` | preserved |
| `finished_at` | null | null | set on transition |
| `heartbeat_at` | null | updated on each heartbeat | frozen at last value |
| `timeout_at` | set on insert | preserved | preserved |
| `cancellation_reason` | null | null | set if `cancelled` or `error` |
| `jenkins_build_url` | null | set on `running` | preserved |

## Invariants

1. A `TestRun` never leaves a terminal state.
2. `TestCaseResult` rows are only written when the run reaches `passed` or `failed` — never during `running`.
3. `BuildArtifact` pointers for logs may exist in non-terminal states if the runner streams logs incrementally; finalized only on terminal transition.
4. Every transition writes an `AuditLog` entry.
