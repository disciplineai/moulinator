# Phase 2 — integration

**Status:** complete. No code changes required; Phase 1 agents' worktree outputs composed cleanly.

## What Phase 2 is

The moment of truth after four agents worked in parallel isolated worktrees. The main agent's job: stitch everything together, run every validator, run the smoke test, and surface any collisions before review.

## What surfaced

**Nothing broke.** The contract-freeze (Phase 0) did its job: interfaces, Prisma schema, OpenAPI contract, state machine, and webhook contract were stable enough that the four agents never drifted.

The only cross-team item to land mid-phase was one **post-commit contract change** (landed in commit `f19c11b`, not technically Phase 2):

- devops-expert's pipeline required a `runner_image_repo` param (full OCI repo path) to pull as `<repo>@<digest>` unambiguously across runner-c and runner-python.
- Team-lead added `runner_image_repo` to `ProjectDefinition` in `project-config.schema.yaml`, `prisma/schema.prisma`, and both fixtures.
- backend-core threaded it through `core/jenkins.client` + `core/runs.orchestrator` + matching specs.
- 71 tests remained green after the change.

## Validation gates (all green)

| Gate | Command | Result |
|---|---|---|
| Install | `pnpm install --no-frozen-lockfile` | OK — lockfile up to date, `api-core-contracts` prepare step built its dist |
| Prisma client | `pnpm -C apps/api prisma generate` | OK — new `runner_image_repo` field present on `ProjectDefinition` |
| Typecheck | `pnpm -r typecheck` (3 projects) + `pnpm -C apps/api typecheck` | OK — all clean |
| API unit + integration | `pnpm -C apps/api test` | **71 tests, 11 suites, all green** |
| Web lint | `pnpm -C apps/web lint` | OK — 0 warnings, 0 errors |
| Web build | `pnpm -C apps/web build` | OK — 10 routes compile (pre-render + server-render), 87.2 kB shared JS, middleware 26.4 kB |
| Compose control | `docker compose -f docker-compose.control.yml config` | OK |
| Compose runners | `docker compose -f docker-compose.runners.yml config` (with `.env` copied from `.env.template`) | OK |

Running `docker compose config` on the runners stack initially failed (`invalid spec: jenkins_agent_home::`) because required env vars defaulted to empty strings. Root cause: validation without `.env`. Resolved by copying `.env.template` → `.env`. No fix needed in the compose file itself.

## What we did NOT do (deliberate)

A full end-to-end smoke test ("sign up → add PAT → trigger → verify webhook + artifact") would require:

- a real Jenkins controller with the pipeline job created;
- a real runner plane VM (or a local docker-in-docker approximation that defeats the isolation invariant);
- a real tests-repo + reference repo + valid GitHub PAT;
- real MinIO with pre-signed URLs reachable across the plane boundary.

None of that infrastructure exists yet. The unit suite already exercises every state transition, HMAC path, idempotency-key collision, advisory-lock acquisition, and crypto round-trip with deterministic doubles. The remaining gap is "wires connect in the real world" — deferred to Phase 6 deploy smoke on Dokploy.

## Known residuals, logged for later phases

1. **refresh_token in JSON body** (flagged by frontend-designer). Frontend handles either shape via `credentials: 'include'`; harden to httpOnly cookie during Phase 3 security review.
2. **docker build against real source untested** (flagged by devops-expert). The multi-stage builds use `pnpm deploy` correctly on paper; actual `docker build -t moulinator-api apps/api` against the shipped source hasn't been run on a Docker-capable host.
3. **No testcontainers integration suite** (flagged by backend-core). Unit suite uses in-memory Prisma doubles; contract-level coverage is good, schema-drift coverage is not.
4. **No Prisma migration generated** for `runner_image_repo` yet. `pnpm prisma migrate dev --name add_runner_image_repo` is required before anyone runs against a real Postgres.
5. **Placeholder runner image digests** in fixtures (`sha256:0000…`). Pipeline refuses to run until a real CI job builds + pushes the runner images and updates the fixtures.
6. **Real client-cert mTLS for Jenkins agent** deferred (documented in `phase-1-devops.md §4b`). MVP ships TLS + shared-secret over WebSocket; escalation path documented.

## Handoff to Phase 3

Phase 3 runs three reviewers in parallel:
- `codex-review` (background) — general correctness / bugs / edge cases.
- `security-pat-crypto` (foreground) — PAT storage, clone-then-isolate flow, webhook HMAC, audit coverage.
- `security-runner-sandbox` (foreground) — runner plane isolation, Docker flags, firewall rules, tests-repo trust.

Then Phase 4: `compliance-agent` re-reads the plan + `git log` + shipped code and flags deltas.

State at handoff:
- `main` @ `f19c11b`
- 147 + 18 files, ~23.7k LOC
- all Phase 1 phase docs present (`docs/phase-1-*.md`)
- `docs/run-state-machine.md` extended with pin-mismatch + timeout-before-start transitions
- one open contract migration (`add_runner_image_repo`) for integration time
