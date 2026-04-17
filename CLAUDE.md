# CLAUDE.md — agent instructions for moulinator

Read this before touching anything.

## Non-negotiable rules

1. **Contracts are frozen.** `openapi.yaml`, `project-config.schema.yaml`, `apps/api/prisma/schema.prisma`, `docs/run-state-machine.md`, `docs/webhook-contract.md`, and `docs/ARCHITECTURE.md` are the source of truth. If you need one to move, stop and ask the main agent — do not edit unilaterally.
2. **PATs never leave the control plane.** Runners receive credential-free tarballs via pre-signed URLs. Do not plumb a PAT through Jenkins.
3. **Runner plane is a separate VM.** No Docker-socket exposure to runner jobs; no host bind mounts beyond a disposable workspace; firewall rules per `docs/ARCHITECTURE.md §2.1`.
4. **Every `TestRun` pins `tests_repo_commit_sha` + `runner_image_digest`.** Reproducibility invariant. The fields are non-null as soon as a `build_started` webhook lands.
5. **Every webhook is HMAC-verified and idempotent.** See `docs/webhook-contract.md`.
6. **AuditLog every auth event, every credential CRUD, every run trigger, every contribution state change.**

## Per-phase doc requirement

Every phase or discrete chunk of work produces `docs/phase-<n>.md` (or `docs/<topic>.md`) explaining what shipped, why, and how it fits. This is a hard requirement from the user.

## Stack conventions

- **Monorepo:** pnpm workspaces (`pnpm-workspace.yaml` at the root).
- **Backend:** NestJS with `class-validator` on every DTO. No raw SQL — Prisma only.
- **Frontend:** Next.js App Router. Generate the typed client from `openapi.yaml` — never hand-write request shapes.
- **IDs:** ULID (`char(26)`), never auto-increment integers (except `AuditLog.id`).
- **Errors:** use the `Error` schema in `openapi.yaml`. `error` is a machine code; `message` is human-readable.
- **No secrets in repo.** `.env.template` is the contract; devops-expert owns it.

## Agent-specific notes

### devops-expert
- Two compose files: `docker-compose.control.yml` + `docker-compose.runners.yml`. Never merge them.
- Jenkinsfile is parameterized — do not hardcode project slugs.
- Runner images are **digest-pinned** in project YAMLs. Publish images to a registry and update fixtures with real digests.

### backend-crud
- Controllers must match `openapi.yaml` exactly. Use `nestjs-zod` or OpenAPI validation middleware.
- Pagination is cursor-based per the `*List` schemas.
- Never call the DB directly from controllers — go through `core/*` services.

### backend-core
- `core/github` does server-side `git archive`. The PAT is decrypted in memory only for the duration of the archive call.
- `core/crypto` uses AES-256-GCM with a per-row IV and a DEK wrapped by `MASTER_KEY_HEX`.
- `core/runs.reaper` is a cron (BullMQ repeatable job) scanning `(status, heartbeat_at)` and `(status, timeout_at)`.
- `webhooks/jenkins` inserts `WebhookEvent` before applying transitions, inside a transaction with the state change.

### frontend-designer
- Use the `frontend-design` skill; avoid the generic-AI look. Aim for distinctive, production-grade.
- Build flows in this order: auth → dashboard → repo detail → run detail → contribute.
- The typed client comes from `openapi.yaml`; regenerate whenever the contract moves.

## Working together

- Each agent runs in its own worktree.
- Diff against `.env.template` via a PR to devops-expert — don't silently add env vars elsewhere.
- When you finish your slice, write `docs/phase-1-<your-role>.md` before handing back to the main agent.
