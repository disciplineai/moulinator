# Phase 0 — contract freeze

**Status:** complete. Commits to `main`.

## Why this phase exists

Phase 1 spawns four agents (devops-expert, backend-crud, backend-core, frontend-designer) in parallel worktrees. Parallel work requires frozen contracts up front — otherwise the agents collide on the same schemas and drift apart. Phase 0 produces the artifacts that every Phase 1 agent reads and never modifies.

## What shipped

| Artifact | Owns |
|---|---|
| `docs/ARCHITECTURE.md` | Two-plane design, firewall, credential flow, domain model summary, service inventory, tests-repo layout, non-negotiable rules |
| `docs/run-state-machine.md` | Every valid `TestRun` state transition + the emitter responsible for it + heartbeat/timeout rules |
| `docs/webhook-contract.md` | Jenkins → API payload schemas, HMAC spec, idempotency rules, retry semantics |
| `docs/project-config.md` + `project-config.schema.yaml` | Declarative per-project config format + JSON Schema validator |
| `openapi.yaml` | Full REST contract (auth, credentials, projects, repos, runs, artifacts, contributions, webhooks) |
| `apps/api/prisma/schema.prisma` | DB schema: User, GithubCredential, ProjectDefinition, Repository, TestRun, TestCaseResult, BuildArtifact, TestContribution, WebhookEvent, AuditLog |
| `fixtures/projects/*.yaml` | Seed configs: `cpool-day06`, `cpool-bsq` |
| `fixtures/reference-repo.md` | Placeholder for the known-green reference repo used by the Phase 2 smoke test |

## Key decisions made explicit

1. **Tests-repo layout is singular.** One GitHub repo, `<slug>/tests/` per project. Not `projects/<slug>/…`, not multiple repos. Driven by user instruction.
2. **Every `TestRun` pins `tests_repo_commit_sha` + `runner_image_digest`.** Reproducibility invariant, enforced in `BuildStartedEvent`.
3. **PATs never leave the control plane.** The server-side clone → tarball → pre-signed URL flow is mandatory. Runners never receive credentials.
4. **Runner plane is a separate VM.** The firewall table in `ARCHITECTURE.md §2.1` is the full list of allowed paths. No "same host with namespaces" fallback.
5. **Every webhook is idempotent.** `WebhookEvent.idempotency_key` is a unique column; duplicates return 409 without replay.
6. **Hermetic is the default.** Non-hermetic projects must declare an explicit per-host egress allowlist.
7. **Placeholder digests.** Fixture files ship with `sha256:000…` — devops-expert replaces them in Phase 1 after building the runner images.

## What this does not include (on purpose)

- Actual NestJS or NextJS code. That's Phase 1 build-team territory.
- Docker Compose / Jenkinsfile / runner Dockerfiles. Also Phase 1 (devops-expert).
- Migrations. Prisma schema ships; `prisma migrate dev` runs in Phase 1.

## How Phase 1 consumes these artifacts

| Build agent | Reads | Writes against |
|---|---|---|
| devops-expert | `docs/ARCHITECTURE.md` (firewall, runner flags), `docs/webhook-contract.md` (Jenkins side), `project-config.schema.yaml` (runner image digest format) | `docker-compose.control.yml`, `docker-compose.runners.yml`, `Jenkinsfile`, `docker/runners/*`, `dokploy/*.yml` |
| backend-crud | `openapi.yaml`, `apps/api/prisma/schema.prisma`, `docs/run-state-machine.md` | `apps/api/src/{auth,users,credentials,repos,runs,artifacts,contributions}/**` |
| backend-core | `docs/ARCHITECTURE.md` (credential flow), `docs/run-state-machine.md`, `docs/webhook-contract.md` | `apps/api/src/{webhooks,core/*}/**` |
| frontend-designer | `openapi.yaml` (generates typed client), `docs/ARCHITECTURE.md` (product flow) | `apps/web/**` |

## Change process during Phase 1

If a build agent needs a contract to move, it surfaces to the main agent. The main agent updates the contract, notifies every active agent via `SendMessage`, and commits the change on `main` before any agent merges downstream work. No silent schema drift.
