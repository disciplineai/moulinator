# Project configuration — schema & conventions

> Contract-freeze artifact. Every `ProjectDefinition` row is seeded or created from a YAML file matching `project-config.schema.yaml` at the repo root.

## Purpose

Moulinator is a **generic** test runner. It knows nothing intrinsic about specific Epitech projects — each project is described by a YAML config that tells the platform how to run it.

## Location

```
fixtures/projects/<slug>.yaml
```

Each file produces one `ProjectDefinition` row on seed.

## Schema (summary)

```yaml
slug: cpool-day06              # kebab-case, must match <tests-repo>/<slug>/tests/
name: "C Pool — Day 06"        # human-readable
language: c                    # one of: c, cpp, python, bash, haskell
tests_path: cpool-day06/tests  # path within tests-repo; defaults to "<slug>/tests"
runner_image_digest: sha256:abc123...  # digest-pinned, no tags
hermetic: true                 # deny all egress; deps pre-baked
egress_allowlist:              # only read when hermetic=false
  - host: archive.ubuntu.com
    ports: [80, 443]
timeout_seconds: 600           # wall-clock budget per run
resource_limits:
  memory_mb: 2048
  cpus: 2
  pids: 512
  disk_mb: 1024
harness_entrypoint: tests/harness.sh  # relative to <tests-repo>/<slug>/
```

Full JSON-Schema is in `project-config.schema.yaml`.

## Tests-repo layout (reminder)

```
<tests-repo>/<slug>/
  └── tests/
      ├── harness.sh           # invoked by Jenkins, receives workspace path as $1
      └── cases/               # tests referenced by harness.sh
```

`tests_path` in the YAML must point at the `tests/` directory.

## Runner image digest

- **Tags are forbidden.** Only SHA256 digests. This guarantees byte-identical runner images across reruns.
- To update: build and push a new image, note its digest, update the YAML, commit. Re-running old `TestRun` rows with pinned older digests continues to use the old image.

## Hermetic vs. non-hermetic

- **Hermetic (default):** deps pre-baked into runner image, all egress denied. Preferred for determinism and security.
- **Non-hermetic:** requires `egress_allowlist` explicitly. Each allowlist entry opens exactly one host+ports pair at the runner-plane firewall for the duration of one build. Avoid unless absolutely necessary.

## Validation

- `apps/api/core/runs.orchestrator` validates the YAML against `project-config.schema.yaml` on seed and on trigger.
- The runner plane firewall is reconfigured per-build based on `egress_allowlist`; the orchestrator sends the rules to a sidecar on the runner host. If the reconfigure fails, the run transitions to `error`.

## Versioning

YAML configs are source-controlled in this repo. Changes require PR + review. On seed, changes to existing slugs update the row; `TestRun` rows reference the digest/path snapshot they were triggered with (via their own `runner_image_digest` + `tests_repo_commit_sha` columns), so past runs remain reproducible regardless of current config.
