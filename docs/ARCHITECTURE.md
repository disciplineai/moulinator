# Moulinator — Architecture

> **Status:** Phase 0 (contract freeze) — this document is the source of truth for all build agents. Changes require a main-agent-owned update and notification to every active agent.

## 1. Purpose

Moulinator lets Epitech students run the automated tester ("mouli") on their own GitHub repositories and contribute missing tests back via PRs on a shared tests-repo. It is deliberately **not** a grader — it reports pass/fail and surfaces traces.

## 2. System shape

Two physical planes, separated by a firewall. Untrusted code never runs on the control plane.

```
┌─────────── CONTROL PLANE (Dokploy host A) ───────────────┐
│                                                          │
│  Next.js (web) ──▶ NestJS (api) ──▶ Jenkins controller   │
│        │                 │                 │             │
│        │            ┌────▼────┐      ┌─────▼────┐        │
│        │            │Postgres │      │ (agents  │        │
│        │            │ + Redis │      │ connect  │        │
│        │            └─────────┘      │ inbound) │        │
│        │                             └─────┬────┘        │
│        └───▶  MinIO (S3 API, 9000/tcp) ◀───┤             │
│                                            │             │
└────────────────────────────────────────────┼─────────────┘
                                             │ mTLS
┌────────────────────────────────────────────▼─────────────┐
│          RUNNER PLANE (Dokploy host B — separate VM)     │
│                                                          │
│  Jenkins agent ──▶ Docker (per-project hermetic images)  │
│                     • --pids-limit / --memory / --cpus   │
│                     • credential-free workspace          │
│                     • no docker socket                   │
│                     • workspace subpaths bound from host │
│                       (DooD — /work/src, /work/tests,    │
│                        /work/out only; no general access)│
│                     • egress only per firewall table §3  │
└──────────────────────────────────────────────────────────┘
```

### 2.1 Firewall (authoritative)

| Source → Destination | Port | Allow? | Purpose |
|---|---|---|---|
| Runner → Jenkins controller | 50000/tcp (mTLS) | ✅ | Jenkins agent protocol |
| Runner → MinIO | 9000/tcp (HTTPS) | ✅ | Workspace download / artifact upload via pre-signed URL |
| Runner → external (per project allowlist) | varies | ⚠️ per project | Opt-in; default deny |
| Runner → Postgres / Redis / NestJS API / Dokploy admin | any | ❌ | Forbidden |
| Control plane → Runner | any | ❌ | Runners pull work; controller never pushes |

All other traffic is dropped.

## 3. Credential flow — "clone-then-isolate"

PATs are never exposed to Jenkins or runners.

```
User ──trigger──▶ NestJS
                    │
                    │ 1. decrypt PAT (in-memory, never logged)
                    │ 2. git archive <commit> via GitHub API (server-side)
                    │ 3. PUT tarball to MinIO (control-plane-only)
                    │ 4. generate pre-signed GET URL (short TTL)
                    ▼
              Jenkins controller ──launch──▶ Runner
                                              │ fetch workspace via pre-signed URL
                                              │ fetch tests-repo at pinned SHA
                                              │ run harness in hermetic Docker
                                              │ PUT logs/results to MinIO
                                              ▼
              NestJS webhook receiver ◀─────── Jenkins (HMAC + idempotency key)
```

PATs remain long-lived; the platform does **not** pretend to rotate them. The UI surfaces `last_used_at` and a one-click delete. Rotation is the user's responsibility — documented in the onboarding flow.

## 4. Domain model (authoritative)

See `apps/api/prisma/schema.prisma` for the complete schema. Summary:

| Entity | Purpose | Notable fields |
|---|---|---|
| `User` | Account | email, password_hash, role (`student`\|`moderator`\|`admin`) |
| `GithubCredential` | Encrypted PAT | ciphertext (AES-256-GCM), iv, tag, wrapped_dek, scopes, last_used_at |
| `ProjectDefinition` | Seed config | slug, name, language, tests_path, runner_image_digest, hermetic, egress_allowlist |
| `Repository` | User's github repo | user_id, project_id, github_url, default_branch |
| `TestRun` | One execution | repo_id, commit_sha, tests_repo_commit_sha, runner_image_digest, status, correlation_id, heartbeat_at, timeout_at, cancellation_reason |
| `TestCaseResult` | Individual assertion | test_run_id, name, status, duration_ms, artifact_ref (s3 key) |
| `BuildArtifact` | Log/tarball pointer | test_run_id, kind, s3_key, size_bytes, retention_until |
| `TestContribution` | PR on tests-repo | user_id, project_id, github_pr_url, status, merged_commit_sha |
| `WebhookEvent` | At-most-once | idempotency_key (unique), payload_hash, received_at, processed_at |
| `AuditLog` | Append-only log | actor, action, entity, ip, ts |

**Reproducibility invariant:** every `TestRun` pins both `tests_repo_commit_sha` and `runner_image_digest`. Re-running an old TestRun with the same pins must produce the same result set (excluding flaky tests flagged in the harness).

## 5. Services

### 5.1 NestJS API (`apps/api`)

Modules:
- `auth` — JWT access + refresh tokens, bcrypt hashing, rate limit on login.
- `users`, `repos`, `runs`, `contributions`, `artifacts` — CRUD (owned by backend-crud agent).
- `webhooks/jenkins` — HMAC-verified, idempotency-keyed receiver.
- `core/`
  - `github` — server-side clone/archive; PAT validator.
  - `jenkins` — parameterized pipeline client; credentials never passed to pipeline.
  - `crypto` — AES-256-GCM envelope; DEK wrapped by master key from `MASTER_KEY_HEX` env.
  - `runs` — state machine, heartbeat reaper, timeout enforcement.
  - `storage` — MinIO presigner; lifecycle policy applier.
  - `audit` — append-only writer.

### 5.2 Jenkins

- Controller on control plane; agents on runner plane connected via mTLS on port 50000.
- **One parameterized pipeline** (`Jenkinsfile`) with params: `project_slug`, `workspace_url`, `tests_repo_url`, `tests_commit_sha`, `runner_image_digest`, `timeout_seconds`, `artifact_upload_url`.
- Pipeline never receives PAT or DB credentials.

### 5.3 tests-repo (separate GitHub repo)

Layout:

```
tests-repo/
├── README.md
├── .github/
│   ├── CODEOWNERS
│   └── workflows/validate.yml   # lints harness contracts
├── <project-slug-1>/
│   └── tests/
│       ├── harness.sh           # entry point Jenkins invokes
│       └── cases/               # project-specific test cases
└── <project-slug-2>/
    └── tests/
        └── ...
```

Governance:
- `main` is protected: required PR, required CODEOWNERS review, no force-push, linear history.
- Every moulinator run pins `tests_repo_commit_sha` captured at trigger time — bad merges can be rolled back by pinning the prior SHA on subsequent runs.
- `validate.yml` runs on PR: syntax check of `harness.sh`, shape check of `cases/`, no network calls from tests allowed (enforced by a sentinel run in a locked-down container).

### 5.4 Docker runners

- Per-language base images (`c`, `cpp`, `python`, extensible) built ahead of time, pushed to a registry, **referenced by digest** in `ProjectDefinition.runner_image_digest`.
- Hermetic: deps pre-baked. Build-time `apt install` etc. forbidden at run time.
- Flags applied by Jenkinsfile to every job container:
  - `--pids-limit 512`
  - `--memory 2g`
  - `--cpus 2`
  - `--cap-drop ALL --security-opt no-new-privileges --user 2000:2000`
  - `/tmp` on tmpfs; `/work/src`, `/work/tests`, `/work/out` bound from the agent's host workdir (DooD — these are per-build disposable paths only)
  - `--network` attached to a dedicated Docker network whose egress is filtered per project
  - wall-clock timeout enforced by an external killer subshell (`docker rm -f`) since `timeout(1)` is not guaranteed in runner images

### 5.5 MinIO

Buckets:
- `workspaces/` — 24h lifecycle
- `logs/` — 30d lifecycle, configurable
- `junit/` — 30d lifecycle

Runner access is via short-TTL pre-signed URLs scoped to a single object key. MinIO admin port is **not** exposed to the runner plane.

## 6. Contract-freeze references

- REST contract: `openapi.yaml`
- Run state machine: `docs/run-state-machine.md`
- Webhook contract: `docs/webhook-contract.md`
- Project config schema: `docs/project-config.md` + `project-config.schema.yaml`
- DB schema: `apps/api/prisma/schema.prisma`
- Fixtures: `fixtures/`

Build agents consume these; they do not modify them. A change request goes to the main agent, who updates the contract and notifies the team.

## 7. Non-negotiable rules

1. PATs never leave the control plane.
2. Runners never gain network access to the control plane beyond Jenkins agent + MinIO S3.
3. Every run pins `tests_repo_commit_sha` + `runner_image_digest`.
4. Webhooks are HMAC-verified and idempotent via `WebhookEvent.idempotency_key`.
5. Every destructive action and every auth event appears in `AuditLog`.

## 8. Out of scope (MVP)

- Grading / scoring
- Cheating detection
- Offline / local CLI
- SSO with Epitech IDP
- GitHub App install-token auth (PAT only for MVP)
