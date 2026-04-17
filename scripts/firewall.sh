#!/bin/sh
# =========================================================================
# moulinator firewall sidecar
# =========================================================================
# Listens on /shared/firewall.sock for newline-delimited JSON commands from
# the Jenkins pipeline and enforces egress rules per-build-network.
#
# Protocol (single-line JSON):
#   { "action": "apply",  "network": "moulinator-run-42", "hermetic": true,
#     "allowlist": [{"host":"registry.npmjs.org","ports":[443]}] }
#   { "action": "cleanup", "network": "moulinator-run-42" }
#
# Semantics:
#   - hermetic=true  → default-deny, zero ACCEPT rules. Container has no egress.
#   - hermetic=false → default-deny + one ACCEPT per (host,port) in allowlist.
#   - Always allow return traffic for established connections.
#   - IMPORTANT: no control-plane "always allow" rules are applied to job-
#     container chains. MinIO fetches and Jenkins remoting happen on the
#     agent (which is on the host network), NOT inside the hermetic job
#     container. Leaking those into every build chain would let student
#     code reach the control plane regardless of project config.
#
# Implementation notes:
#   - iptables is L3/L4 — we resolve DNS at apply time. TTL drift is acceptable
#     because builds are short and rules are torn down at build end.
#   - One chain `MOUL_<hash>` per network keeps rules isolated and cleanup cheap.
#   - Toolchain: busybox + iptables + socat + jq + docker CLI. The sidecar
#     Dockerfile installs them; /var/run/docker.sock is bind-mounted read-only
#     so we can look up the bridge interface for a given user network.
# =========================================================================

set -eu

SOCK="${SOCK:-/shared/firewall.sock}"

log() { printf '[firewall] %s\n' "$*" >&2; }

# Resolve a DNS name to A records. Returns empty string if resolution fails.
# getent is busybox — present in alpine.
resolve() {
  _name="$1"
  getent ahostsv4 "$_name" 2>/dev/null | awk '{print $1}' | sort -u
}

# Deterministic chain name for a network. iptables chain names are capped at
# 28 chars; we hash + truncate to stay within bounds and keep unique.
chain_for() {
  _net="$1"
  _hash=$(printf '%s' "$_net" | sha256sum | cut -c1-16)
  printf 'MOUL_%s' "$_hash"
}

ensure_chain() {
  _chain="$1"
  iptables -w -N "$_chain" 2>/dev/null || true
  iptables -w -F "$_chain"
  iptables -w -A "$_chain" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  iptables -w -A "$_chain" -o lo -j ACCEPT
}

# Hook a chain into DOCKER-USER (for egress from the container) and INPUT (for
# host-local traffic), filtered by the docker bridge interface.
#
# Why DOCKER-USER, not FORWARD:
#   Docker ≥ 17.06 installs its own rules early in FORWARD and also flushes /
#   reinserts them on daemon restart, network creation, and every `docker run`.
#   A rule inserted directly into FORWARD is therefore vulnerable to being
#   shuffled below Docker's own ACCEPTs (or flushed entirely). `DOCKER-USER` is
#   the documented hook Docker itself jumps to FIRST and never touches — user
#   rules there survive daemon operations and run before Docker's own allow
#   chain. See https://docs.docker.com/network/packet-filtering-firewalls/
#
# INPUT hook stays as-is: it covers traffic from the job container to the host
# itself (services bound on the bridge gateway or 0.0.0.0) and Docker does not
# touch INPUT on user-defined bridges.
hook_chain() {
  _chain="$1"
  _netname="$2"
  _netid=$(docker network inspect -f '{{.Id}}' "$_netname" 2>/dev/null | cut -c1-12)
  if [ -z "$_netid" ]; then
    log "network $_netname not found"
    return 1
  fi
  _brname="br-$_netid"
  # DOCKER-USER exists on any host with Docker ≥ 17.06, and the daemon installs
  # a `-j DOCKER-USER` jump early in FORWARD on startup. The `-N` create below
  # is a defensive no-op for a first-boot race where dockerd hasn't populated
  # the chain yet. Rules in DOCKER-USER survive Docker's own network/container
  # operations (unlike rules inserted directly into FORWARD, which Docker may
  # shuffle or flush).
  iptables -w -N DOCKER-USER 2>/dev/null || true
  iptables -w -D DOCKER-USER -i "$_brname" -j "$_chain" 2>/dev/null || true
  iptables -w -I DOCKER-USER -i "$_brname" -j "$_chain"
  iptables -w -D INPUT       -i "$_brname" -j "$_chain" 2>/dev/null || true
  iptables -w -I INPUT       -i "$_brname" -j "$_chain"
}

apply_rules() {
  _network="$1"
  _hermetic="$2"
  _allowlist_json="$3"

  _chain=$(chain_for "$_network")
  ensure_chain "$_chain" || return 1

  if [ "$_hermetic" = "true" ]; then
    log "network=$_network hermetic — default deny, no allowlist entries"
  else
    # Iterate the JSON array with jq.
    echo "$_allowlist_json" | jq -c '.[]' | while IFS= read -r _entry; do
      _host=$(printf '%s' "$_entry" | jq -r '.host')
      # Validate host shape defensively — allowlist entries are tagged as
      # project config but we treat them as untrusted input here.
      case "$_host" in
        *[!A-Za-z0-9.-]*) log "skip invalid host: $_host"; continue ;;
      esac
      for _port in $(printf '%s' "$_entry" | jq -r '.ports[]'); do
        case "$_port" in
          (''|*[!0-9]*) log "skip invalid port for $_host: $_port"; continue ;;
        esac
        for _ip in $(resolve "$_host"); do
          iptables -w -A "$_chain" -d "$_ip" -p tcp --dport "$_port" -j ACCEPT
          log "allow $_network → $_host ($_ip):$_port"
        done
      done
    done
  fi

  iptables -w -A "$_chain" -j DROP || return 1
  hook_chain "$_chain" "$_network" || return 1
  log "applied rules for $_network"
  return 0
}

cleanup_rules() {
  _network="$1"
  _chain=$(chain_for "$_network")

  _netid=$(docker network inspect -f '{{.Id}}' "$_network" 2>/dev/null | cut -c1-12 || true)
  if [ -n "$_netid" ]; then
    _brname="br-$_netid"
    # Remove from DOCKER-USER (current hook) and FORWARD (legacy, for pre-F11
    # builds whose chains might still be lingering after a sidecar upgrade).
    iptables -w -D DOCKER-USER -i "$_brname" -j "$_chain" 2>/dev/null || true
    iptables -w -D FORWARD     -i "$_brname" -j "$_chain" 2>/dev/null || true
    iptables -w -D INPUT       -i "$_brname" -j "$_chain" 2>/dev/null || true
  fi
  iptables -w -F "$_chain" 2>/dev/null || true
  iptables -w -X "$_chain" 2>/dev/null || true
  log "cleaned up $_network"
}

# Validate a field against a shape before handing it to iptables/docker.
# We don't fully sanitize — jq already returns raw strings — but we block
# obviously-bad characters that could confuse iptables or the shell.
sanitize_network_name() {
  case "$1" in
    ''|*[!A-Za-z0-9._-]*) return 1 ;;
  esac
  return 0
}

# handle_line writes a single-line ACK/NACK response to stdout so the caller
# (socat client on the agent) can block on it and fail the build when
# rule-application errored. Format:
#   {"status":"ok"}      — success
#   {"status":"error","reason":"<short>"}
handle_line() {
  _line="$1"
  _action=$(printf '%s' "$_line" | jq -r '.action // empty' 2>/dev/null) || {
    printf '{"status":"error","reason":"bad_json"}\n'
    return 0
  }
  case "$_action" in
    apply)
      _network=$(printf '%s' "$_line" | jq -r '.network // empty')
      sanitize_network_name "$_network" || {
        printf '{"status":"error","reason":"bad_network_name"}\n'
        return 0
      }
      _hermetic=$(printf '%s' "$_line" | jq -r '.hermetic // true')
      _allowlist=$(printf '%s' "$_line" | jq -c '.allowlist // []')
      if apply_rules "$_network" "$_hermetic" "$_allowlist" >&2; then
        printf '{"status":"ok","network":"%s"}\n' "$_network"
      else
        printf '{"status":"error","reason":"apply_failed","network":"%s"}\n' "$_network"
      fi
      ;;
    cleanup)
      _network=$(printf '%s' "$_line" | jq -r '.network // empty')
      sanitize_network_name "$_network" || {
        printf '{"status":"error","reason":"bad_network_name"}\n'
        return 0
      }
      cleanup_rules "$_network" >&2
      printf '{"status":"ok","network":"%s"}\n' "$_network"
      ;;
    *)
      log "unknown action: $_action"
      printf '{"status":"error","reason":"unknown_action"}\n'
      ;;
  esac
}

# -- main loop ---------------------------------------------------------------
#
# socat forks a child per inbound connection. We keep the handler logic INSIDE
# this script (passed via EXEC:) so POSIX functions remain available; spawning
# a fresh `sh -c` would lose them. `$0 __handle` dispatches back into ourselves.

if [ "${1:-}" = "__handle" ]; then
  # Read one newline-delimited JSON line from stdin and dispatch.
  # `read` returns non-zero on EOF-without-newline but still fills _line,
  # so don't short-circuit on failure — only skip if the line is empty.
  IFS= read -r _line; [ -z "$_line" ] && exit 0
  handle_line "$_line"
  exit 0
fi

rm -f "$SOCK"
log "listening on $SOCK"

# EXEC: reruns this script with __handle; each connection gets its own child
# but each child parses and dispatches in pure shell — no inherited-function
# assumption. mode=0666 lets the Jenkins agent (different uid) connect; the
# socket is only reachable inside the shared docker volume, not on the host.
exec socat -T 10 \
  UNIX-LISTEN:"$SOCK",reuseaddr,fork,mode=0666 \
  EXEC:"$0 __handle"
