# Phase 3 — review aggregation

Three reviewers ran in parallel. One skill (Codex) hit its usage limit mid-phase; the main agent ran the correctness rubric manually, flagged as a fallback per the Phase 0 plan's skill-availability clause.

## Reviewers

| Reviewer | Status | Scope | Verdict |
|---|---|---|---|
| codex-review (main agent fallback) | **fallback completed**, codex re-run queued for when quota resets | Correctness, state machine, Prisma, OpenAPI, frontend polling, compose | NEEDS_FIX: 1 MAJOR + 6 MINOR |
| security-pat-crypto | complete | PAT storage, clone-then-isolate, webhook HMAC, audit, refresh tokens | NEEDS_FIX: 1 CRITICAL + 6 MAJOR + 4 MINOR |
| security-runner-sandbox | complete | Two-plane separation, Jenkinsfile, runner hardening, firewall, tests-repo trust | NEEDS_FIX: 0 CRITICAL + 5 MAJOR + 7 MINOR |

**Totals across all reviewers:** 1 CRITICAL + 12 MAJOR + 17 MINOR.

## Fix classification

Phase 5 fix loop takes the CRITICAL + every MAJOR. MINORs are tagged `defer-to-later` unless they piggyback on a MAJOR fix.

### Must-fix before Phase 4 sign-off

| ID | Title | Owner | Severity |
|---|---|---|---|
| F1 | Refresh-token lifetime cannot be revoked (no logout, no jti, not audited) | backend-crud + backend-core | CRITICAL |
| F2 | Refresh token returned in JSON body (fold into F1) | backend-crud | MAJOR |
| F3 | `auth.refresh` not audited (fold into F1) | backend-crud | MAJOR |
| F4 | Rejected-webhook AuditLog poisoning via attacker-controlled `entity_id` | backend-core | MAJOR |
| F5 | `archiveCommit` uses `redirect: 'follow'` with PAT header | backend-core | MAJOR |
| F6 | `GithubCredential.last_used_at` never written | backend-crud or backend-core | MAJOR |
| F7 | Plaintext PAT string lives in orchestrator closure for whole trigger tail | backend-core | MAJOR |
| F8 | Orchestrator blindly picks most-recent credential — multi-credential users footgun | backend-crud | MAJOR |
| F9 | Placeholder `sha256:0…0` digest accepted by pipeline + orchestrator | devops-expert + backend-core | MAJOR |
| F10 | SSH known-hosts enforcement conditional on `M_DEPLOY_KEY` being non-empty | devops-expert | MAJOR |
| F11 | Firewall sidecar installs chain in `FORWARD`, not `DOCKER-USER` | devops-expert | MAJOR |
| F12 | `--tmpfs /work` missing `noexec,nosuid,nodev` | devops-expert | MAJOR |
| F13 | Tests-repo fallback does unbounded `git fetch --unshallow` | devops-expert | MAJOR |

### Defer-to-later (MINOR, cheap to fold in opportunistically)

Tracked in `docs/phase-3-minors.md` (not written this phase — list is in the three source reports at `/tmp/phase-3-*.md`). Representative items: `build_completed` empty-cases → passed, Prisma migrations dir missing (already blocked on Phase 6 deploy smoke), CryptoService.equal dead code, clock-skew soft-warn absent, heartbeat secret via environ, agent-mTLS rogue-agent escalation note.

## Fix loop plan

Per CLAUDE.md: 3-iteration cap. Strategy for iteration 1:

- **backend-crud** picks up F1 (controller + DTO + logout route) + F2 (cookie move) + F3 (audit) + F6 (last_used write path) + F8 (credential selection).
- **backend-core** picks up F1 (RefreshToken entity / Redis jti set) + F4 (audit hardening) + F5 (manual-redirect fetch) + F7 (scope-down PAT).
- **devops-expert** picks up F9 (placeholder reject in Jenkinsfile), F10 (unconditional known-hosts for SSH), F11 (DOCKER-USER chain), F12 (tmpfs flags), F13 (bounded fallback).

Some items (F1, F9) span two agents; lead sequences them so the DB schema for F1 is decided before backend-crud wires the controller.

## Deferred items carried forward

- **Real client-cert mTLS** for Jenkins agent (runner-sandbox MINOR, phase-1-devops.md §4b). Phase 3 review confirms MVP trade-off acceptable *provided* §4b is updated with the rogue-agent-registration escalation. That doc update is part of F-prep.
- **Prisma `migrations/` directory** (correctness MINOR). Deferred to Phase 6 deploy smoke per phase-2.md.
- **Testcontainers integration suite** for backend-core. Deferred.
- **Docker build against real source** for api + web. Devops-expert already ran it while fixing the Dockerfile port/healthcheck — the `docker build` pass + express-dep fix in commit `b471bdc` closed this.

## Re-run log

- Codex quota reset ~19:27 UTC (2026-04-17). If codex surfaces anything beyond what was caught in the manual pass, it will be appended here before Phase 4.

## Source reports

- Correctness: `/Users/sobsh/tmp-phase-3-codex-review.md`
- PAT / crypto / webhook: `/tmp/phase-3-security-pat-crypto.md`
- Runner sandbox: `/tmp/phase-3-security-runner-sandbox.md`
