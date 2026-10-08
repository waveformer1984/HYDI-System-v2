#!/usr/bin/env bash
# Join an ephemeral cloud-agent VM (Cursor cloud agent, CI runner, etc.) to the
# tailnet as tag:agent, so it can reach the HYDI PC's protoforge MCP endpoint
# (tailnet policy limits tag:agent to tcp:8470 on the HYDI PC; see
# docs/TAILSCALE.md).
#
#   TS_AUTHKEY=tskey-auth-... scripts/tailscale/agent-join.sh
#
# TS_AUTHKEY must be an EPHEMERAL, tag:agent auth key, supplied as an env
# secret, never committed. Ephemeral nodes are removed from the tailnet
# automatically after the VM goes away.
#
# Mode is picked automatically:
#   existing   - a tailscaled is already running (e.g. started by the
#                official installer): reuse it.
#   kernel     - root with a usable /dev/net/tun: normal networking, any
#                client works.
#   userspace  - otherwise, or if kernel mode fails to create the tunnel
#                (common in containers): tailscaled exposes a SOCKS5 proxy on
#                localhost:1055 and an HTTP proxy on localhost:1056; only
#                clients that use a proxy can reach tailnet hosts (curl
#                --socks5-hostname, or HTTPS_PROXY for clients that honor it).
set -euo pipefail

: "${TS_AUTHKEY:?TS_AUTHKEY is not set. Provide an ephemeral tag:agent auth key as an env secret.}"
HOSTNAME_TAG="${TS_HOSTNAME:-agent-$(hostname | tr -cd 'a-zA-Z0-9-' | cut -c1-20)}"
STATE_DIR="${TS_STATE_DIR:-/tmp/tailscale-agent}"
mkdir -p "$STATE_DIR"

if ! command -v tailscale >/dev/null || ! command -v tailscaled >/dev/null; then
  echo "tailscale not installed. Install it first, e.g.: curl -fsSL https://tailscale.com/install.sh | sh" >&2
  exit 1
fi

SOCK="$STATE_DIR/tailscaled.sock"
LOG="$STATE_DIR/tailscaled.log"

# Start a daemon and wait for its socket. Fails (returns 1) if the daemon dies
# first, e.g. kernel mode in a container that has /dev/net/tun but lacks the
# capability to create the tunnel interface.
start_daemon() {
  : >"$LOG"
  tailscaled --state=mem: --socket="$SOCK" "$@" >>"$LOG" 2>&1 &
  local pid=$!
  for _ in $(seq 1 30); do
    [ -S "$SOCK" ] && return 0
    kill -0 "$pid" 2>/dev/null || return 1
    sleep 0.5
  done
  kill "$pid" 2>/dev/null || true
  return 1
}

if pgrep -x tailscaled >/dev/null 2>&1; then
  # A daemon is already running (the official installer starts one via
  # systemd). Reuse it instead of starting a second one that would fight
  # it for the tunnel interface.
  MODE=existing
  SOCK_ARGS=()
else
  MODE=""
  if [ "$(id -u)" = "0" ] && [ -c /dev/net/tun ] && start_daemon; then
    MODE=kernel
  elif start_daemon --tun=userspace-networking \
         --socks5-server=localhost:1055 --outbound-http-proxy-listen=localhost:1056; then
    MODE=userspace
  else
    echo "tailscaled did not start in kernel or userspace mode; see $LOG" >&2
    exit 1
  fi
  SOCK_ARGS=(--socket="$SOCK")
fi

# Auth key goes in via env-expanded flag; it is never echoed. MagicDNS stays
# on so the documented *.ts.net hostname resolves in kernel/existing mode.
tailscale ${SOCK_ARGS[@]+"${SOCK_ARGS[@]}"} up --authkey="$TS_AUTHKEY" --hostname="$HOSTNAME_TAG" \
  --advertise-tags=tag:agent >/dev/null

echo "joined tailnet as $HOSTNAME_TAG (tag:agent, mode=$MODE)"
if [ "$MODE" = userspace ]; then
  echo "userspace mode: reach tailnet hosts via SOCKS5 localhost:1055 or HTTP proxy localhost:1056"
  echo "  e.g. curl --socks5-hostname localhost:1055 https://<hydi-pc>.<tailnet>.ts.net:8470/healthz"
fi
