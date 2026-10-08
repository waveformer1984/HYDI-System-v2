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
#   kernel     - root with /dev/net/tun: normal networking, any client works.
#   userspace  - otherwise: tailscaled exposes a SOCKS5 proxy on
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
if [ "$(id -u)" = "0" ] && [ -c /dev/net/tun ]; then
  MODE=kernel
  tailscaled --state=mem: --socket="$SOCK" >"$STATE_DIR/tailscaled.log" 2>&1 &
else
  MODE=userspace
  tailscaled --tun=userspace-networking --state=mem: --socket="$SOCK" \
    --socks5-server=localhost:1055 --outbound-http-proxy-listen=localhost:1056 \
    >"$STATE_DIR/tailscaled.log" 2>&1 &
fi

for _ in $(seq 1 30); do [ -S "$SOCK" ] && break; sleep 0.5; done
[ -S "$SOCK" ] || { echo "tailscaled did not start; see $STATE_DIR/tailscaled.log" >&2; exit 1; }

# Auth key goes in via env-expanded flag; it is never echoed.
tailscale --socket="$SOCK" up --authkey="$TS_AUTHKEY" --hostname="$HOSTNAME_TAG" \
  --advertise-tags=tag:agent --accept-dns=false >/dev/null

echo "joined tailnet as $HOSTNAME_TAG (tag:agent, mode=$MODE)"
if [ "$MODE" = userspace ]; then
  echo "userspace mode: reach tailnet hosts via SOCKS5 localhost:1055 or HTTP proxy localhost:1056"
  echo "  e.g. curl --socks5-hostname localhost:1055 https://<hydi-pc>.<tailnet>.ts.net:8470/healthz"
fi
