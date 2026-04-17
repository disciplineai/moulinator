# moulinator

Collaborative CI for Epitech projects. Students add their GitHub PAT, register their repos, and run an automated tester against them. Once they see the official AT trace, they open PRs on the tests-repo to contribute missing tests.

## Stack

- **Web:** Next.js (App Router)
- **API:** NestJS + Prisma + PostgreSQL + Redis (BullMQ)
- **Pipeline:** Jenkins (controller on control plane, agents on isolated runner plane)
- **Object storage:** MinIO (workspace tarballs, logs, junit)
- **Hosting:** Dokploy (two stacks on two hosts)

See `docs/ARCHITECTURE.md` for the full picture.

## Layout

```
moulinator/
├── docs/                       # source-of-truth specs (read first)
├── openapi.yaml                # REST contract, backend↔frontend
├── project-config.schema.yaml  # ProjectDefinition JSON Schema
├── fixtures/projects/*.yaml    # seeded project configs
├── apps/
│   ├── api/                    # NestJS (Phase 1)
│   └── web/                    # Next.js (Phase 1)
├── docker/runners/             # per-language runner images (Phase 1)
├── docker-compose.*.yml        # control / runners (Phase 1)
├── dokploy/                    # Dokploy stack configs (Phase 1)
└── Jenkinsfile                 # (Phase 1)
```

## Phases

The build is divided into phases; each produces a narrative doc under `docs/phase-*.md` so the work is easy to follow without reading every commit.

- **Phase 0** — contract freeze (this commit). See `docs/phase-0.md`.
- **Phase 1** — parallel build by 4 specialist agents (devops, backend-crud, backend-core, frontend).
- **Phase 2** — integration + smoke test.
- **Phase 3** — codex review + security review (PAT/crypto and runner sandbox).
- **Phase 4** — compliance gate.
- **Phase 5** — fix loop.
- **Phase 6** — ship to Dokploy.

## Status

Greenfield — Phase 0 just landed. Nothing executable yet.
