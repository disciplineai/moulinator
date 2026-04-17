# Runner plane — DooD workspace bind mount fix

## What shipped

Fixed a silent bind mount failure that caused `/work/tests` (and `/work/src`, `/work/out`) to be
empty inside every harness container, making every test run error with "file not found".

## Root cause

The Jenkins agent workspace was stored in a **named Docker volume** (`jenkins_agent_home`).
The agent uses Docker-outside-of-Docker (DooD): it shares `/var/run/docker.sock` with the host
daemon. When the Jenkinsfile ran `docker run -v /home/jenkins/agent/workspace/.../tests-repo:/work/tests`,
the **host** Docker daemon looked for that path on the **host filesystem** — but the path only
existed inside the named volume, which is opaque to the host FS. Docker silently created an
empty directory instead of mounting the actual data.

## Changes

### `docker-compose.runners.yml`

- **Removed** the `jenkins_agent_home` named volume.
- **Added** a host bind mount for the agent workdir: `${HOST_AGENT_WORKDIR}:${JENKINS_AGENT_WORKDIR}`.
  The host path is now a real directory on host B, so nested `docker run` bind mounts resolve correctly.
- **Added** a separate `firewall_socket` named volume mounted at `/home/jenkins/firewall-sock`
  in the agent and at `/shared` in the firewall sidecar. Keeping the socket in a named volume
  (not on the host FS) prevents local processes from sending unauthenticated iptables commands.
- Exposed `HOST_AGENT_WORKDIR` to the agent container's environment so the Jenkinsfile can
  translate container-internal paths to host paths.

### `Jenkinsfile`

- **Hardcoded** `FIREWALL_SOCK` to `/home/jenkins/firewall-sock/firewall.sock` (matches the
  new named volume mount; no undocumented env dependency).
- **Added path translation** in the `run harness` stage: strips `JENKINS_AGENT_WORKDIR` prefix
  from `$WORKSPACE` and prepends `HOST_AGENT_WORKDIR` to get the host-resolvable path.
- **Added validation guards**: fails loudly if `HOST_AGENT_WORKDIR` is unset or non-absolute,
  or if `$WORKSPACE` is not under `JENKINS_AGENT_WORKDIR`.
- **Switched** from `-v` to `--mount type=bind` — fails immediately if the source path doesn't
  exist on the host, rather than silently creating an empty directory.
- **Fixed `_DKRC` capture**: removed `|| true` from `wait "$_DK_PID"` so the actual docker
  exit code is captured (previously always 0, masking container failures).
- Removed agent-side `ls` debug lines; kept `cat "$M_FULL_LOG" >&2` as a console fallback for
  diagnostics that survive even when the upload stage is skipped and `post { always }` deletes the file.

### `.env.template` + `dokploy/runners.yml`

- Added `HOST_AGENT_WORKDIR=/opt/moulinator/jenkins-agent` with operator setup instructions.
- Updated Dokploy stack contract to declare the new env var and the `firewall_socket` volume.

### `docs/ARCHITECTURE.md`

- Updated the runner plane diagram and §5.4 flags to document the DooD workspace bind mount
  as an intentional exception: only the three per-build disposable subpaths (`/work/src`,
  `/work/tests`, `/work/out`) are bound from the host — no general host access.

## Operator steps (host B)

Before deploying the updated stack, run once on host B:

```sh
mkdir -p /opt/moulinator/jenkins-agent
chown 1000:1000 /opt/moulinator/jenkins-agent   # UID 1000 = jenkins inside agent container
chmod 750 /opt/moulinator/jenkins-agent          # no world-read
```

Then set `HOST_AGENT_WORKDIR=/opt/moulinator/jenkins-agent` in Dokploy's env for the
`moulinator-runners` stack and redeploy.

## Security properties unchanged

- Job containers still never receive `/var/run/docker.sock`.
- Only the three per-build workspace subpaths are mounted — not the full `HOST_AGENT_WORKDIR`.
- `firewall.sock` stays in a named Docker volume, never on the host FS.
- `--mount type=bind` ensures misconfigured paths fail loudly, not silently.
