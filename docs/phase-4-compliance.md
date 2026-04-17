# Phase 4 — compliance gate

Compliance agent reviewed the shipped implementation against the approved plan and the non-negotiable rules in `CLAUDE.md`.

**Verdict:** SIGNED_OFF on code. Single documentation gap (acceptable-use memo) fixed in the same commit as this doc. Code was not touched.

## Verified

1. **Every plan "Critical files" deliverable is on disk.** All paths from the plan's `Critical files` section (docs/, openapi.yaml, fixtures/, docker-compose.\*.yml, dokploy/, Jenkinsfile, docker/runners/, apps/api/\*\*, apps/web/\*\*) exist and carry non-trivial content.

2. **Non-negotiable rules hold post-Phase-5:**
   - **PATs never leave control plane.** `Jenkinsfile` has no PAT parameter. `apps/api/src/core/runs/runs.orchestrator.ts` decrypts + zeros a Buffer scoped to the new `decryptAndArchive` helper (Phase 5 F7) and hands Jenkins only a pre-signed MinIO URL.
   - **Runner plane firewall.** `scripts/firewall.sh:91-93` hooks `DOCKER-USER` (per F11). Allowed outbound paths match `docs/ARCHITECTURE.md §2.1` exactly: Jenkins agent + MinIO + per-project allowlist.
   - **TestRun pins.** `runs.orchestrator.ts:70-108` pins `tests_repo_commit_sha` + `runner_image_digest` BEFORE calling Jenkins. `jenkins-webhook.service.ts:232-292` CAS-transitions `queued → error` on pin mismatch with `cancellation_reason='pin_mismatch'` + enqueued abort.
   - **Webhook HMAC + idempotency.** `timingSafeEqual` constant-time compare. `WebhookEvent(idempotency_key)` unique with `payload_hash` mismatch detection.
   - **AuditLog coverage.** Auth events (signup / login / login_failed / refresh / refresh_failed / logout / refresh-rotation), credentials.create/delete/replaced/used, runs.trigger/cancel/running/passed/failed/error/timed_out/abort_ok/abort_failed, contributions.create, webhook_rejected_signature, pin-mismatch — all write-through.

3. **No scope creep.** No grading, no cheating detection, no SSO, no GitHub App install-token path, no offline CLI — all explicitly out-of-scope in the plan.

4. **Contract-freeze rule respected.** Only `openapi.yaml`, `project-config.schema.yaml`, `apps/api/prisma/schema.prisma`, and `docs/run-state-machine.md` were edited under team-lead-blessed rulings traceable in phase docs.

5. **Prisma migrations shipped.** Initial migration `20260417120000_init` covers the full schema plus `runner_image_repo` plus `refresh_tokens`.

## Documented trade-offs (accepted)

- **Agent ↔ controller is TLS + shared-secret, not real client-cert mTLS.** Owned in `docs/phase-1-devops.md §4b` with the rogue-agent-registration escalation noted. MinIO pre-signed URL TTLs are the load-bearing mitigation.
- **Fixture runner digests are placeholders.** Both `runs.orchestrator` and `Jenkinsfile` actively refuse `^sha256:0{64}$` with machine code `runner_image_digest_placeholder` (Phase 5 F9). CI must publish real images + update fixtures before production use.

## Delta fixed in this commit

**[DOC BLOCKER → resolved]** The plan's Phase 0 step-1 "policy gate" (acceptable-use for AT-trace-reconstruction) was green-lit verbally but not recorded in-repo. Fix: added `docs/policy-acceptable-use.md` recording the decision, approver, scope, out-of-scope items, and revisitation terms. `README.md` links to it.

## Minor notes (not blockers, carry forward)

- **Moderator-side contribution state transitions** (open→merged→rejected) aren't implemented. OpenAPI doesn't declare them either, so there's no contract/impl mismatch — but Phase 6 must decide whether moderation happens via the UI or via a GitHub-PR webhook sync.
- **Fixture extension mismatch:** plan says `fixtures/reference-repo.txt`, shipped as `.md`. Content obligation met; if strict naming matters, rename to `.txt`. Not a blocker.

## Summary

**SIGNED_OFF.** Phase 6 deploy can proceed once the CI job that publishes real runner images lands — that work is carried forward in `docs/phase-5.md §Deferred items` and `docs/phase-1-devops.md §9`.
