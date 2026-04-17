# Phase 1 — Backend CRUD (NestJS scaffolding + REST surface)

**Agent:** backend-crud. **Scope:** every path/method in `openapi.yaml`,
plus monorepo bootstrap and the shared contracts package that
backend-core implements against.

## What shipped

### Monorepo bootstrap
- `pnpm-workspace.yaml` covering `apps/*` and `packages/*`.
- Root `package.json` exposing `dev`, `build`, `lint`, `typecheck`,
  `test` across the workspace.
- `tsconfig.base.json` with strict TS + decorator metadata enabled.

### `apps/api` (NestJS 10)
- `src/main.ts` — Helmet, CORS (driven by `WEB_ORIGIN`),
  `ValidationPipe({ whitelist, forbidNonWhitelisted, transform })`,
  global exception filter, `enableShutdownHooks()` for graceful Docker
  termination.
- `src/app.module.ts` — wires every feature module behind a
  global `JwtAuthGuard` (opt-out via `@Public()` on `/auth/*` and
  `/webhooks/jenkins`).
- `src/prisma/prisma.service.ts` — `PrismaClient` subclass with
  `onModuleInit`/`onModuleDestroy` lifecycle hooks. Migrations stay out
  of process (run via `prisma migrate deploy` at deploy time).

### Modules
One per tag in `openapi.yaml`:

| Module | Routes | Notes |
|---|---|---|
| `auth` | `POST /auth/signup`, `/auth/login`, `/auth/refresh` | JWT access + refresh via `@nestjs/jwt`, bcrypt-hashed passwords (12 rounds), audit on every outcome |
| `users` | `GET /me` | trivial; pulled from Prisma |
| `credentials` | `GET/POST /me/credentials`, `DELETE /me/credentials/{id}` | delegates encryption to `ICryptoService`, validation to `IGithubClient` |
| `projects` | `GET /projects` | list from `ProjectDefinition` table |
| `repos` | `GET/POST /repos`, `GET/DELETE /repos/{id}` | validates `https://github.com/<owner>/<repo>` shape, enforces project existence, `@@unique(user_id, github_url, project_id)` lifted to `409` |
| `runs` | `POST /runs`, `GET/DELETE /runs/{id}`, `GET /repos/{id}/runs`, `GET /runs/{id}/results` | orchestrator inserts the `TestRun` row; crud re-reads by ULID. Cursor pagination on repo-scoped list. |
| `artifacts` | `GET /runs/{id}/artifacts`, `GET /artifacts/{id}/url` | short-TTL presign (300s) via `IStorageService` |
| `contributions` | `GET/POST /contributions` | filters by `status`; validates PR URL shape |
| `webhooks/jenkins` | `POST /webhooks/jenkins` | raw-body middleware so backend-core can HMAC-verify against exact bytes; status-code mapping lives in the controller |

### DTOs
All request bodies/query params validated with `class-validator` +
`class-transformer`. Chose `class-validator` over `nestjs-zod` for
familiarity and zero extra runtime. Every DTO lives alongside its
module. ULIDs and 40-char commit SHAs have explicit regex checks.

### Errors
`src/common/http-exception.filter.ts` normalizes every error to
`{ error, message?, details? }` — the `Error` schema from
`openapi.yaml`. Known HTTP statuses map to machine codes
(`unauthorized`, `conflict`, `unprocessable_entity`, `rate_limited`,
etc.). `5xx` errors log a stack.

### Pagination
`src/common/pagination.ts` ships cursor encode/decode
(base64url-JSON of `{ createdAt, id }`) and a `clampLimit` helper.
`runs.service.listForRepo` is the only caller today; same helper
applies to future list endpoints.

### Shared contracts
`packages/api-core-contracts/` — interfaces + DI tokens +
OpenAPI-mirrored DTO types. See `docs/phase-1-contracts.md` for the
backend-core wiring contract.

Crud ships a `core-contracts` module populated with
`Stub*` services that throw `ServiceUnavailableException` for dangerous
paths and no-op for audit/storage. Backend-core replaces these
providers in its own module. The stubs exist so the API boots in
isolation for the conformance test and the unit tests.

### Tests
- `apps/api/test/openapi-conformance.spec.ts` loads `openapi.yaml`,
  introspects the Nest container via `DiscoveryService` +
  `MetadataScanner`, and asserts every `path + method` has a
  registered handler. Fails loudly if the contract drifts.
- `src/auth/auth.controller.spec.ts` — signup happy + duplicate, login
  happy + unknown email.
- `src/runs/runs.controller.spec.ts` — trigger happy + cross-user 404,
  cancel with terminal run → 409, cancel running → orchestrator invoked.
- `src/credentials/credentials.controller.spec.ts` — add with bad PAT
  (422, never hits crypto), add happy path, delete cross-user (404),
  delete happy path.

All tests pass via `pnpm -C apps/api test` (14 passing, 4 suites).

## How to run

```bash
pnpm install              # from repo root
pnpm -C apps/api prisma:generate
pnpm -C apps/api typecheck
pnpm -C apps/api test
pnpm -C apps/api build
pnpm -C apps/api dev      # needs DATABASE_URL + JWT secrets, runs on :3001
```

Environment variables added to the contract (requested from
`devops-expert` — owning `.env.template`):

- `DATABASE_URL` — Postgres DSN
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET`
- `JWT_ACCESS_TTL_SECONDS` (default `900`)
- `JWT_REFRESH_TTL_SECONDS` (default `2592000`)
- `WEB_ORIGIN` — comma-separated origins for CORS
- `API_PORT` (default `3001`)

## Trade-offs / notes

1. **`@Controller('runs')` split.** `RunsController` is declared with
   an empty `@Controller()` because the `runs` tag covers both
   `/runs/:id` and `/repos/:id/runs`, and Nest enforces one controller
   prefix. Keeping a single service + controller avoided leaking
   repo-ownership logic across two modules.
2. **Stub core services, not mocks.** The stubs live in-tree because
   an un-wired orchestrator in production would be a silent failure —
   by throwing `ServiceUnavailableException` with a distinct
   `orchestrator_not_wired` code, an integration regression lights up
   loudly in logs.
3. **Conformance test introspects the container rather than spinning
   up HTTP.** Faster, no port binding, and catches typo'd route
   paths the same way.
4. **Raw-body middleware is scoped to `/webhooks/jenkins`.** Global
   JSON parsing stays untouched for every other route. The middleware
   still populates `req.body` so backend-core can choose to rely on
   the parsed form inside `IJenkinsWebhookService.handle`.
5. **Run insert lives in the orchestrator, not the controller.**
   Reason: the `timeout_at` calculation depends on
   `ProjectDefinition.timeout_seconds` which the orchestrator already
   loads to enqueue Jenkins; duplicating that query in crud would
   invite drift. Controller re-reads the row by ULID to render the
   `201` response — one extra point-read, cheap, keeps the
   state-machine owner single.

## Open handoffs

- Backend-core: implement the six interfaces in
  `packages/api-core-contracts/`. See `docs/phase-1-contracts.md`.
- DevOps: add the env vars above to `.env.template`.
- Frontend: the typed client generation pipeline can consume
  `openapi.yaml` directly — no DTO changes required. Reference the
  types in `@moulinator/api-core-contracts/dto` if convenient.
