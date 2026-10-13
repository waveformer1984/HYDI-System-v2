#!/usr/bin/env bash
# Cursor Cloud Agent — runs on every agent boot (detached; see start-user.log).
# Brings up Docker + local Supabase (CI parity) and optional tailnet join.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
CURSOR_DIR="$ROOT/.cursor"
ENV_FILE="$CURSOR_DIR/supabase-local.env"
LOG_TAG="[cloud-agent-start]"

log() { echo "$LOG_TAG $*"; }

ensure_docker() {
  if docker info >/dev/null 2>&1; then
    log "docker daemon ok"
    return 0
  fi
  log "starting dockerd"
  if command -v sudo >/dev/null 2>&1; then
    sudo dockerd >/tmp/dockerd-cloud-agent.log 2>&1 &
    for _ in $(seq 1 30); do
      docker info >/dev/null 2>&1 && return 0
      sleep 1
    done
    sudo chmod 666 /var/run/docker.sock 2>/dev/null || true
    docker info >/dev/null 2>&1 && return 0
  fi
  log "ERROR: docker daemon not available" >&2
  return 1
}

supabase_api_url() {
  if [ -f "$ENV_FILE" ]; then
    # shellcheck source=/dev/null
    set -a
    source "$ENV_FILE"
    set +a
  fi
  echo "${API_URL:-http://127.0.0.1:54321}"
}

wait_for_supabase() {
  local api_url="$1"
  for _ in $(seq 1 120); do
    if curl -fsS --max-time 2 "${api_url}/rest/v1/" >/dev/null 2>&1; then
      return 0
    fi
    sleep 2
  done
  log "ERROR: Supabase API not ready at ${api_url}" >&2
  return 1
}

supabase_is_healthy() {
  npx supabase status >/dev/null 2>&1
}

write_supabase_env() {
  mkdir -p "$CURSOR_DIR"
  npx supabase status -o env > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
  log "wrote $ENV_FILE"
}

start_supabase() {
  local api_url attempt
  api_url="$(supabase_api_url)"
  if [ -f "$ENV_FILE" ] && wait_for_supabase "$api_url"; then
    log "supabase already up"
    return 0
  fi
  if [ -f "$ENV_FILE" ] && ! wait_for_supabase "$api_url"; then
    log "stale $ENV_FILE — removing and restarting Supabase"
    rm -f "$ENV_FILE"
    npx supabase stop >/dev/null 2>&1 || true
  fi

  # Same service exclusions as .github/workflows/unit-tests.yml
  local excludes="studio,imgproxy,inbucket,edge-runtime,logflare,vector,supavisor"
  for attempt in 1 2 3; do
    log "npx supabase start attempt ${attempt} (CI excludes)"
    # CLI may exit 0 even when start failed — verify with `supabase status`.
    npx supabase start -x "$excludes" || true
    if supabase_is_healthy; then
      write_supabase_env
      api_url="$(supabase_api_url)"
      if wait_for_supabase "$api_url"; then
        return 0
      fi
      log "API not ready after healthy status (attempt ${attempt})"
    else
      log "supabase status unhealthy after start (attempt ${attempt})"
    fi
    npx supabase stop >/dev/null 2>&1 || true
    sleep "$((attempt * 3))"
  done

  log "ERROR: Supabase failed to start after 3 attempts (see output above)" >&2
  return 1
}

maybe_join_tailnet() {
  if [ -z "${TS_AUTHKEY:-}" ]; then
    log "TS_AUTHKEY unset — skipping tailnet join (MCP to heidi-pc unavailable)"
    return 0
  fi
  if ! command -v tailscale >/dev/null 2>&1; then
    log "installing tailscale"
    curl -fsSL https://tailscale.com/install.sh | sh
  fi
  log "joining tailnet (tag:agent)"
  TS_AUTHKEY="$TS_AUTHKEY" "$ROOT/scripts/tailscale/agent-join.sh"
  log "tailnet join complete — configure MCP HTTP URL + PROTOFORGE_MCP_TOKEN in agent secrets"
}

ensure_docker
start_supabase || exit 1
maybe_join_tailnet

log "source Supabase env: set -a && source .cursor/cloud-agent-env.sh && set +a"
log "done"
