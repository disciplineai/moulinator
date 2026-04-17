# Phase 1 — DevOps slice

**Agent:** devops-expert
**Scope:** control-plane + runner-plane compose, Jenkinsfile, runner images, Dokploy stacks, `.env.template`, Dockerfile stubs.

## What shipped

| Deliverable | Path | Purpose |
|---|---|---|
| Env contract | `.env.template` | Authoritative list of every env var every service reads, with comments |
| Control compose | `docker-compose.control.yml` + `docker-compose.control.dev.yml` | Postgres, Redis, MinIO (+ bucket bootstrap), API, Web, Jenkins controller. Production compose exposes no host ports; the `.dev.yml` override adds host-port publishing for local dev. |
| Custom Jenkins controller | `docker/jenkins/` | Bakes JCasC + matrix-auth into the image; `jenkins.yaml` enforces admin user, no anonymous access, webhook-secret credential |
| MinIO bootstrap | `scripts/minio-bootstrap.sh` | Buckets + lifecycle + scoped service user with a bucket-limited IAM policy |
| Runners compose | `docker-compose.runners.yml` | Jenkins agent + firewall sidecar; separate `runners` network on a separate VM |
| Firewall sidecar | `scripts/firewall.sh`, `docker/firewall/Dockerfile` | Host-netns iptables manager driven by newline-JSON over a Unix socket |
| Custom agent image | `docker/agent/Dockerfile` | Extends `jenkins/inbound-agent` with the docker/curl/git/socat/openssl/jq CLIs the Jenkinsfile calls |
| Pipeline | `Jenkinsfile` | Parameterized single pipeline; HMAC-signed webhooks; heartbeats; hermetic container launch |
| Runner images | `docker/runners/c.Dockerfile`, `docker/runners/python.Dockerfile` | Hermetic bases; no curl/wget at runtime; non-root user; build-time tooling only |
| Dokploy stacks | `dokploy/control.yml`, `dokploy/runners.yml` | Stack definitions with env/secret declarations + published ports |
| App stubs | `apps/api/Dockerfile`, `apps/web/Dockerfile` | Multi-stage node:20-alpine + pnpm skeletons tolerant of still-empty source |
| Narrative | `docs/phase-1-devops.md` (this file) | |

## Design decisions worth knowing

### 1. Two compose files, never merged

The firewall invariant (docs/ARCHITECTURE.md §2.1) is enforceable only if the
runner plane is a separate VM. A merged compose on a single host couldn't
credibly deny `runner → postgres` without accidentally denying it to `api`.
Accepting the operational cost of two hosts buys a real security boundary.

### 2. Jenkins is the only cross-plane path

The control plane exposes exactly two HTTPS endpoints to the runner plane:
Jenkins on 443 (WebSocket-tunnelled remoting, see §4b) and MinIO S3 on 443
(used only with short-TTL pre-signed URLs). The raw JNLP port 50000 is
deliberately not exposed publicly — the host firewall on plane B enforces
this, and the compose files don't publish it either.

### 3. Credential flow — what is where

- PATs live **only** on the control plane, encrypted via `MASTER_KEY_HEX` +
  per-row DEK (backend-core owns this). The API decrypts in memory, server-side
  `git archive`s, uploads the tarball to MinIO, signs a short-TTL GET URL, and
  passes **only that URL** to the pipeline as a parameter. Jenkins never sees
  the PAT.
- The tests-repo deploy key is a separate secret, owned by the runner plane.
  It's a read-only SSH key mounted into the agent via a Docker secret — never
  baked into an image, never plumbed into a job container.
- The webhook HMAC secret (`JENKINS_WEBHOOK_SECRET`) exists on BOTH planes.
  Rotation requires restarting both sides together.

### 4. Runner container hardening — non-negotiables

Every job container is launched with:

```
--pids-limit <n>                   # per project config, default 512
--memory <n>m --memory-swap <n>m   # no swap
--cpus <n>                         # fractional allowed
--read-only                        # / is immutable
--tmpfs /work:...,mode=1777        # writable scratch, dies with container
--cap-drop ALL                     # no Linux capabilities
--security-opt no-new-privileges   # setuid can't escalate
--user 2000:2000                   # image's `runner` user
--network <per-build, --internal>  # default-deny egress, firewall opens allowlist
```

Additionally: `timeout -s TERM <n> …` wraps the harness so a hung process can't
outlive `timeout_seconds`, independent of Jenkins' own stage timeout.

### 4a. Injection-safe pipeline parameter handling

Every user-controlled pipeline parameter (tests_repo_url, tests_commit_sha,
project_slug, harness_entrypoint, URLs, etc.) is validated with a regex in
`validateRequiredParams` AND passed to shell exclusively via `withEnv` +
single-quoted `sh` bodies (no Groovy string interpolation into shell). The
job container invocation uses `docker run -e VAR=...` plus an `sh -c` entry
command whose script body references `$VAR` — never a string concatenated
from params. This closes the "agent-privileged Docker socket + adversarial
params" path by removing the ability to smuggle shell metacharacters into
any `docker`/`git`/`curl` invocation, even if the API were compromised.

### 4b. Agent ↔ controller — TLS + shared-secret (NOT client-cert mTLS)

The phase brief asked for "mTLS to controller". I shipped a weaker-but-honest
variant and am calling it out rather than claiming mTLS:

- The agent runs with `JENKINS_WEB_SOCKET=true`; remoting traffic flows
  through the controller's HTTPS listener and is tunnelled over TLS to the
  Dokploy reverse proxy, which terminates TLS on :443. From the network's
  point of view, agent-to-controller is TLS-wrapped end-to-end.
- However, the agent authenticates to the controller with a shared secret
  (`JENKINS_AGENT_SECRET`), not a client certificate. The controller
  authenticates itself with its server cert (standard HTTPS). This is
  server-authenticated TLS + shared-secret agent auth — not mutual TLS.
- The raw JNLP port 50000 is NOT published on either the control-plane
  compose or the Dokploy stack. The only cross-plane network path is
  HTTPS on 443 (Jenkins) + HTTPS on 443 (MinIO public endpoint).

To get actual mTLS we'd need to issue a short-lived client cert per agent
(e.g., via an internal CA), configure Jenkins to require + verify it, and
manage rotation. That's a separate work stream; deferring it is a conscious
trade-off for the MVP. Raising it here and in the review log so the next
hardening pass can pick it up without rediscovering the gap.

**Rogue-agent escalation (Phase 3 security-runner-sandbox review).** A leaked
`JENKINS_AGENT_SECRET` doesn't just let an attacker impersonate the runner —
it lets them register **additional** inbound agents under the same name/label
and race to claim queued jobs from the `moulinator-runner` pool. The first
agent to pick up a job receives the pre-signed MinIO GET URL for the
student's workspace tarball as a build parameter, exposing student code even
though the workspace itself is credential-free (the URL is the capability).

MVP mitigations, already in place:
- MinIO pre-signed URLs have short TTLs (minutes, set by the API's storage
  service). Stale URLs stolen from logs are useless.
- The secret is stored in Dokploy's vault, mounted into the agent container
  read-only, and scoped to one VM — rotation on any suspicion of leak is a
  single Dokploy redeploy.
- Audit events land on every webhook; a sudden second `build_started` for the
  same `test_run_id` from an unexpected source IP would show up in the
  `audit_logs` table.

Hardening path (not in this slice): short-lived per-agent client certs from
an internal CA, Jenkins configured to require + verify them, and automatic
rotation tied to agent lifecycle. That's the real mTLS story and it closes
this escalation by making the agent-to-controller channel bind-to-identity
rather than bind-to-shared-secret.

### 5. Firewall sidecar, not iptables-in-pipeline

The pipeline does NOT edit iptables directly. It sends a JSON request to a
privileged sidecar (host networking, `NET_ADMIN`) over a Unix socket exposed
on a shared Docker volume. Three wins:

1. The Jenkins agent container stays unprivileged on the net-config axis —
   it doesn't need `NET_ADMIN`.
2. Per-build iptables chains (`MOUL_<sha256-truncated>`) are trivially cleaned up.
3. A crash in the pipeline can't leave stale ACCEPT rules if the firewall
   sidecar also reconciles on periodic sweeps (future work).

Implementation:

- The sidecar runs from `docker/firewall/Dockerfile` (alpine +
  iptables + socat + jq + docker-cli + bash) with the host Docker socket
  mounted read-only so it can resolve user-defined bridges via
  `docker network inspect`.
- `socat` accepts on the shared socket with `EXEC:"$0 __handle"` — dispatches
  each connection back into the same script with an `__handle` argv — so the
  handler runs in a shell that has `handle_line` defined. (The earlier
  `SYSTEM:…` variant spawned a fresh `sh -c` which lost the function.)
- The per-build network is a plain user-defined bridge with
  `com.docker.network.bridge.enable_icc=false`. We deliberately do NOT pass
  `--internal`; `--internal` installs Docker rules that drop egress
  unconditionally, which would make the sidecar's ACCEPT rules unreachable.

Known limitation: the sidecar resolves DNS at apply time and pins IPs, so an
allowlisted host using short-TTL DNS (CDNs) may break mid-build. MVP-acceptable
because builds are short; document an escalation path for long-running
projects if we ever support them.

### 6. Webhook emission — idempotent by construction

Every webhook carries:

- `X-Moulinator-Signature: sha256=<hex(hmac_sha256(secret, body))>`
- `X-Moulinator-Idempotency-Key: <uuid v4>` (unique per emission; retries
  reuse the key)
- `X-Moulinator-Event: build_started|heartbeat|build_completed|build_errored`

The retry loop in `emitWebhook` follows docs/webhook-contract.md §retry: no
retry on 2xx/409/410/422, hard fail on 401/404, exponential backoff on 5xx
up to 6 attempts. Heartbeat emission runs in a backgrounded shell loop so a
Groovy stage transition won't kill it; `post { always }` guarantees it's torn
down and a terminal event (`build_completed` or `build_errored`) is emitted.

### 7. `post { always }` does cleanup, then `post { failure/aborted }` emits error

Order matters: if the pipeline dies mid-stage, the `failure` and `aborted`
blocks run BEFORE `always`, so we emit `build_errored` with a meaningful
reason before cleaning up the network/container. The `always` block then:

1. Stops the heartbeat loop (idempotent).
2. Calls firewall cleanup on the sidecar (removes iptables chain).
3. `docker rm -f` the job container.
4. `docker network rm` the per-build network.
5. Deletes the unpacked workspace + tarball + tests-repo clone from the agent
   workspace.

### 8. Dockerfile stubs are tolerant of empty source

Backend and frontend agents haven't landed source yet. The stubs `pnpm install
--frozen-lockfile --filter ./apps/api...` and rely on the workspace having
been populated. `docker build` fails gracefully with a clear error until the
source + lockfiles exist — no hidden-state divergence once they land.

### 9. Runner image pinning

Fixtures in `fixtures/projects/*.yaml` currently carry placeholder digests
(`sha256:000…`). After CI builds the `c` and `python` runner images and pushes
them, the digests from `docker buildx imagetools inspect` replace the
placeholders. The pipeline REFUSES to run unless `runner_image_digest` matches
`^sha256:[a-f0-9]{64}$`.

## Running locally

```bash
# 1. Copy the env contract and fill in values you care about.
cp .env.template .env
# Generate crypto secrets:
echo "MASTER_KEY_HEX=$(openssl rand -hex 32)" >> .env
echo "JWT_ACCESS_SECRET=$(openssl rand -hex 64)" >> .env
echo "JWT_REFRESH_SECRET=$(openssl rand -hex 64)" >> .env
echo "JENKINS_WEBHOOK_SECRET=$(openssl rand -hex 32)" >> .env

# 2. Validate compose.
docker compose -f docker-compose.control.yml config > /dev/null
docker compose -f docker-compose.control.yml -f docker-compose.control.dev.yml config > /dev/null
docker compose -f docker-compose.runners.yml config > /dev/null

# 3. Control plane up, with the dev override so services are reachable on the host.
COMPOSE="docker compose -f docker-compose.control.yml -f docker-compose.control.dev.yml"
$COMPOSE up -d postgres redis minio createbuckets
# When api/web source lands:
$COMPOSE up -d --build api web jenkins-controller

# 4. (Separate VM ideally) runners.
docker compose -f docker-compose.runners.yml up -d
```

Production deployments must NOT use `docker-compose.control.dev.yml`. Dokploy
reads only `docker-compose.control.yml`, which publishes no host ports; Dokploy's
reverse proxy handles TLS + ingress on 443.

Jenkins agent registration:

1. Log in to Jenkins, create a "Permanent Agent" node named `runner-01`,
   label `moulinator-runner`, launch method "Inbound".
2. Copy the generated secret into `JENKINS_AGENT_SECRET` in the runner-plane
   `.env`. Restart the runner stack.
3. Create a Jenkins Credential of type "Secret text" with ID
   `jenkins-webhook-secret`, value = `$JENKINS_WEBHOOK_SECRET`.
4. Create the pipeline job referencing this repo's `Jenkinsfile`, name
   matches `$JENKINS_JOB_NAME`.

## Deploying to Dokploy

1. Install Dokploy on hosts A and B. Label the agents:
   - Host A: `plane=control`
   - Host B: `plane=runners`
2. Import this repo into Dokploy as project `moulinator`.
3. Create two stacks:
   - `control` → `dokploy/control.yml`
   - `runners` → `dokploy/runners.yml`
4. Fill in the env vars (the UI shows which are required/secret).
5. Upload the tests-repo deploy key to Dokploy's secret store as
   `tests_repo_deploy_key`.
6. Deploy `control` first — wait for healthchecks.
7. Deploy `runners`. Confirm the agent appears online in Jenkins UI.
8. Host firewall on B MUST block outbound traffic except:
   - `443/tcp` to host A Jenkins (HTTPS + WebSocket-tunnelled remoting)
   - `443/tcp` to the MinIO public endpoint
   - DNS (`53/udp`) to your resolver
   (Port 50000 is never exposed publicly — see §4b.)

## Trade-offs / open questions

- **Docker socket on the agent.** The agent mounts `/var/run/docker.sock` so
  the pipeline can `docker run` hardened runner containers. This concentrates
  privilege in the agent; it does NOT leak into job containers. An
  alternative (rootless Podman, sysbox, DinD) would increase complexity for
  marginal security gain given the runner VM is already a separate trust
  boundary.
- **DNS-based allowlist.** `firewall.sh` resolves DNS at rule-apply time and
  pins IPs. Hosts behind CDNs with short TTLs can break mid-build. Fine for
  hermetic projects (the default); visible for non-hermetic.
- **No per-agent mTLS certificate pinning.** The stock `jenkins/inbound-agent`
  image uses JNLP over TCP with a shared secret. Jenkins 2.462 supports
  agent-to-controller mTLS via WebSocket, but I kept the simpler mode for
  MVP. Noted for a later hardening pass.
- **One agent, no autoscaling.** Jobs serialize on one runner by design — it
  keeps the concurrency story honest while backend is still wiring the queue.
  Scaling out requires additional named agents + a label-balancing pass.
- **Placeholder runner digests.** Fixture YAMLs still ship
  `sha256:000…0000`. A CI job must build the images, push to the registry,
  and update the fixtures before `prisma db seed` is useful. That job is not
  in this slice — it belongs to the integration phase.
- **`firewall.sh` socat main loop** uses `SYSTEM:"while read …; do … done"` to
  invoke `handle_line` per connection. Functional but brittle; a small Go
  daemon would be cleaner. Tracked as follow-up; not a correctness issue.
- **Live image builds — status at handoff.** `docker build -f apps/web/Dockerfile .`
  succeeds and the container boots + listens on 3000 (TCP healthcheck passes).
  `docker build -f apps/api/Dockerfile .` also succeeds, but the container
  crashes at module-resolve with `Cannot find module 'express'` because
  `apps/api/src/webhooks/raw-body.middleware.ts` imports `express` directly
  while `apps/api/package.json#dependencies` only declares
  `@nestjs/platform-express` (express is transitive; pnpm doesn't hoist it
  and `pnpm --prod deploy` strips it from the runtime tree). One-liner fix
  lives with backend-crud: add `"express": "^4.19.2"` to `dependencies`. Not
  worked around on the DevOps side because any workaround would mask the
  dep bug. The Dockerfile itself is verified: build completes, layers are
  right, port/healthcheck match `apps/api/src/main.ts:50` (API_PORT=3001),
  entrypoint path is correct (`dist/apps/api/src/main.js`).

## What I did NOT do, and why

- Did **not** edit `openapi.yaml`, `prisma/schema.prisma`, any `docs/*.md`
  (other than this one), or the project-config schema. Changes to those
  contracts flow through the team lead.
- Did **not** fill in runner image digests in `fixtures/projects/*.yaml`. That
  requires a CI pipeline that builds + pushes the images first.
- Did **not** implement `prisma migrate deploy` wiring beyond calling it from
  the API Dockerfile `CMD`. If backend prefers an explicit migration job, this
  can be pulled out.

## Sign-off

All eight deliverables committed. Compose files pass `docker compose … config`.
Contracts untouched. Any follow-ups above are visible; none block Phase 2.
