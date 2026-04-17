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
#   - hermetic=true  → default-deny, no allowlist entries (plus always-allow hosts).
#   - hermetic=false → default-deny + one ACCEPT per (host,port) in allowlist.
#   - Always allow return traffic for established connections.
#   - Always allow reaching MinIO public endpoint + Jenkins controller on 50000
#     so the runner can fetch workspaces + phone home.
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
# Space-separated "host:port" entries that are ALWAYS allowed. Configured via
# env at sidecar launch; typically the MinIO + Jenkins endpoints.
ALWAYS_ALLOW_HOSTS="${ALWAYS_ALLOW_HOSTS:-}"

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

# Hook a chain into BOTH the FORWARD and INPUT chains, filtered by the
# docker bridge interface for the given network. Reasoning:
#   - FORWARD covers egress from the job container out to the world.
#   - INPUT covers traffic from the job container to the host itself
#     (runner VM services bound on the bridge gateway or 0.0.0.0).
# Without the INPUT hook, a job container could reach dockerd (via the
# gateway), SSH, or any other host-local service — bypassing the allowlist.
hook_chain() {
  _chain="$1"
  _netname="$2"
  _netid=$(docker network inspect -f '{{.Id}}' "$_netname" 2>/dev/null | cut -c1-12)
  if [ -z "$_netid" ]; then
    log "network $_netname not found"
    return 1
  fi
  _brname="br-$_netid"
  iptables -w -D FORWARD -i "$_brname" -j "$_chain" 2>/dev/null || true
  iptables -w -I FORWARD -i "$_brname" -j "$_chain"
  iptables -w -D INPUT   -i "$_brname" -j "$_chain" 2>/dev/null || true
  iptables -w -I INPUT   -i "$_brname" -j "$_chain"
}

apply_rules() {
  _network="$1"
  _hermetic="$2"
  _allowlist_json="$3"

  _chain=$(chain_for "$_network")
  ensure_chain "$_chain" || return 1

  # Always-allow hosts first — these bypass the per-project allowlist.
  for _hp in $ALWAYS_ALLOW_HOSTS; do
    _host="${_hp%:*}"
    _port="${_hp##*:}"
    for _ip in $(resolve "$_host"); do
      iptables -w -A "$_chain" -d "$_ip" -p tcp --dport "$_port" -j ACCEPT
    done
  done

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
    iptables -w -D FORWARD -i "$_brname" -j "$_chain" 2>/dev/null || true
    iptables -w -D INPUT   -i "$_brname" -j "$_chain" 2>/dev/null || true
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
  IFS= read -r _line || exit 0
  [ -z "$_line" ] && exit 0
  handle_line "$_line"
  exit 0
fi

rm -f "$SOCK"
log "listening on $SOCK"

# EXEC: reruns this script with __handle; each connection gets its own child
# but each child parses and dispatches in pure shell — no inherited-function
# assumption. umask 0117 keeps the socket at 0660.
umask 0117
exec socat -T 10 \
  UNIX-LISTEN:"$SOCK",reuseaddr,fork,mode=0660 \
  EXEC:"$0 __handle"
