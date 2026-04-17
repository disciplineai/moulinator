# Phase 5 — fix loop

Phase 3 produced 1 CRITICAL + 12 MAJOR + 17 MINOR findings across three parallel reviewers. Phase 5 closes the CRIT + every MAJOR in a single iteration across four agents. No iteration 2 needed — every fix landed clean on the first pass.

## Codex status

All agents hit the OpenAI usage limit at ~17:25 UTC (quota resets ~19:27 UTC). Each fell back to a focused self-review on their own diff, caught one issue (devops-expert's `cleanup_rules` DOCKER-USER leak), and documented the rerun is still queued for when the quota clears.

## Shipped by owner

### backend-crud

| F# | Title |
|---|---|
| F1 (CRIT) + F2 + F3 | Refresh token moved to httpOnly cookie (`mou_rt`, `SameSite=Lax`, `Path=/auth`), new `POST /auth/logout` (204, idempotent), new `POST /auth/refresh` now reads cookie + requires `X-Moulinator-Refresh: 1` header (CSRF-lite), audit coverage for `auth.refresh`, `auth.refresh_failed`, `auth.logout` |
| F6 | `CredentialsService.markUsed(credentialId)` exposed on `ICredentialsService`; writes `credentials.used` audit row |
| F8 | `CredentialsService.create` now runs delete-then-insert in one transaction; writes `credentials.replaced` + `credentials.create` |

Contract changes: `AuthTokens` schema dropped `refresh_token`; OpenAPI got `/auth/logout` + updated `/auth/refresh` header parameter. Shipped `StubRefreshTokenStore` as placeholder until backend-core's real implementation landed.

Prisma migrations directory created with an initial baseline migration (`20260417120000_init`) covering the whole schema plus the post-commit `runner_image_repo` delta plus the new `RefreshToken` table.

### backend-core

| F# | Title |
|---|---|
| F1 (CRIT, server half) | `RefreshTokenService` under `apps/api/src/core/auth/` implementing `IRefreshTokenStore`: JWT `{sub, jti, typ:'refresh'}`, Prisma-backed state, atomic `rotate` with reuse detection (mark `replaced_by != null` → `revokeAllForUser(userId, 'reuse_detected')` + throw), audit events `auth.refresh.issued | rotated | revoked | revoke_all | reuse_detected` |
| F4 | Rejected-signature webhook audit row no longer carries attacker-controlled `entity`/`entityId`; metadata sanitized to `{event_header, claimed_idempotency_key, raw_body_sha256_prefix}`; IP threaded in; `@Throttle({ short: { limit: 60, ttl: 60_000 } })` on the controller via `@nestjs/throttler` + global `ThrottlerGuard` |
| F5 | `archiveCommit` uses `redirect: 'manual'`; on 3xx drops `Authorization` and follows `Location` without creds. Covers the Node <20 / old undici gap. Added `"engines": { "node": ">=20" }` to `apps/api/package.json` |
| F7 | New `decryptAndArchive` helper scopes the plaintext PAT to one call; `decryptPatToBuffer(blob) → Buffer` on `ICryptoService`; buffer `.fill(0)` in `finally`; orchestrator closure no longer holds the PAT past the archive |

### devops-expert

| F# | Title |
|---|---|
| F9 | Jenkinsfile + orchestrator both reject `^sha256:0{64}$` placeholder digests with machine code `runner_image_digest_placeholder` (409 from API; pipeline `error()` with the same string) |
| F10 | SSH tests-repo URL now requires a non-empty readable `TESTS_REPO_KNOWN_HOSTS_PATH` regardless of deploy-key presence; `GIT_SSH_COMMAND` uses `StrictHostKeyChecking=yes -o UserKnownHostsFile=...` unconditionally for SSH URLs |
| F11 | Firewall sidecar installs the per-build chain in `DOCKER-USER` (auto-created if absent, Docker ≥ 17.06 assumed); `cleanup_rules` also drains DOCKER-USER + legacy FORWARD to survive sidecar upgrades |
| F12 | `/work` tmpfs now carries `nosuid,nodev`; `noexec` deliberately omitted because the C harness execs compiled binaries from `/work` (documented in-line) |
| F13 | tests-repo fetch fallback bounded: `fetch --depth 1 <sha>` → `fetch --depth 50` → `fetch --deepen 200` → hard fail unless operator sets `ALLOW_TESTS_REPO_UNSHALLOW=1` |
| §4b | `docs/phase-1-devops.md §4b` updated with the rogue-agent-registration escalation flagged by security-runner-sandbox |

### frontend-designer (triggered by backend-crud's auth contract change)

Regenerated typed client from the updated `openapi.yaml`, switched `/auth/login` + `/auth/signup` + `/auth/refresh` to cookie flow (`credentials: 'include'`, sets `X-Moulinator-Refresh: 1` on refresh), wired `POST /auth/logout` into the user menu, dropped `refresh_token` from the access-token store. No residual uses of the old JSON-body contract.

## Validation sweep (Phase 5 gate)

| Gate | Command | Result |
|---|---|---|
| Install | `pnpm install --no-frozen-lockfile` | OK |
| Typecheck (all 4 projects) | `pnpm -r typecheck` + `pnpm -C apps/api typecheck` | Clean |
| API tests | `MOULINATOR_DISABLE_QUEUES=1 MOULINATOR_SKIP_BUCKET_BOOTSTRAP=1 pnpm -C apps/api test` | **12 suites, 90 tests, all green** (up from 71) |
| Web lint | `pnpm -C apps/web lint` | 0 warnings |
| Web build | `pnpm -C apps/web build` | 10 routes compile |
| Compose control | `docker compose -f docker-compose.control.yml config` | OK |
| Compose runners | `docker compose --env-file .env -f docker-compose.runners.yml config` | OK |

## Deferred items (carried forward, not blockers)

All MINOR findings. Tracked against the source reports:
- `build_completed` empty-cases → `passed` should be `error`
- `CryptoService.equal` dead code cleanup
- Decrypted plaintext Buffer not zeroed (string returns still the limiting factor)
- `DAY` / `_TxHint` dead symbols
- Webhook clock-skew soft-warn not implemented
- Heartbeat secret via `/proc/*/environ`
- `egress_allowlist_json` size cap on controller JVM
- `fileSize` called after upload (timing fragility)
- Apt cleanup no-op in `c.Dockerfile`
- Firewall sidecar `handle_line` read-size cap
- Shadow `runId` variable in webhook service
- `require('crypto')` inline in orchestrator
- OpenAPI conformance is structural-only (not response-body validation)

## Codex rerun plan

When the OpenAI quota resets (~19:27 UTC), each agent's diff will be re-reviewed via `codex exec`. Any new findings will land as a short appendix to `docs/phase-3-review.md` and be folded into Phase 6 deploy smoke or a follow-up PR. This is consistent with the 3-iteration cap in CLAUDE.md — iteration 1 closed all critical + major issues, iteration 2 will cover only what codex might surface that the self-reviews missed.

## Phase 4 compliance gate — not yet run

Phase 4 compliance agent runs against this commit, verifying:
- Every plan deliverable is present.
- No undocumented scope expansion.
- Non-negotiable rules from CLAUDE.md §Non-negotiable rules still hold post-fixes.
- Documented trade-offs (mTLS, runtime `docker build` untested outside devops-expert's host, Prisma migrations linear history) are captured.

Next up: spawn `compliance-agent`.
