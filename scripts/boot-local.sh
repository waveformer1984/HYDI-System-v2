#!/usr/bin/env bash
#
# boot-local.sh — Boot HYDI against a local Supabase (Docker), no hosted cloud secret.
#
# Stands up a local Supabase stack on :54321, applies the app schema + role
# grants, then runs `npm run boot` with the local SUPABASE_* env wired in.
#
# Requirements: Docker, curl, tar. The Supabase CLI is installed on demand into
# ~/.local if missing.
#
# Usage:  bash scripts/boot-local.sh
#
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SB_DIR="${HYDI_LOCAL_SUPABASE_DIR:-$HOME/hydi-local-supabase}"
LOCAL_BIN="$HOME/.local/bin"
export PATH="$LOCAL_BIN:$PATH"

log() { printf '[boot-local] %s\n' "$*"; }

# 1. Ensure the Supabase CLI (two-binary shim: supabase + supabase-go) is present.
if ! command -v supabase >/dev/null 2>&1; then
  log "installing Supabase CLI..."
  command -v zstd >/dev/null 2>&1 || sudo apt-get install -y zstd
  TAG="$(curl -sSI https://github.com/supabase/cli/releases/latest \
        | grep -i '^location:' | sed -E 's#.*/tag/([^[:space:]]+).*#\1#')"
  ARCH="$(uname -m)"; case "$ARCH" in
    x86_64) A=amd64;; aarch64|arm64) A=arm64;; *) A=amd64;; esac
  mkdir -p "$HOME/.local/share/supabase" "$LOCAL_BIN"
  curl -sSL -o /tmp/supabase.tar.gz \
    "https://github.com/supabase/cli/releases/download/${TAG}/supabase_linux_${A}.tar.gz"
  tar -xzf /tmp/supabase.tar.gz -C "$HOME/.local/share/supabase"
  ln -sf "$HOME/.local/share/supabase/supabase"    "$LOCAL_BIN/supabase"
  ln -sf "$HOME/.local/share/supabase/supabase-go" "$LOCAL_BIN/supabase-go"
fi
log "supabase CLI $(supabase --version)"

# 2. Start local Supabase in a throwaway dir (NOT the repo root — the repo's
#    migrations include one that fails on `supabase start` and tears everything
#    down). This dir has no migrations, so the stack comes up clean.
mkdir -p "$SB_DIR"
( cd "$SB_DIR" && supabase init --force >/dev/null 2>&1 || true )
if ! ( cd "$SB_DIR" && supabase status >/dev/null 2>&1 ); then
  log "starting local Supabase (pulls Docker images on first run)..."
  ( cd "$SB_DIR" && supabase start )
else
  log "local Supabase already running"
fi

# 3. Pull the local keys/URL from the running stack.
eval "$(cd "$SB_DIR" && supabase status -o env | sed 's/^/export SB_/')"
DBC="supabase_db_$(basename "$SB_DIR")"

# 4. Apply the app schema + role grants (idempotent). Tables created via raw
#    psql as `postgres` have no PostgREST grants, so inserts silently fail
#    without the GRANTs below.
log "applying schema to $DBC..."
docker exec -i "$DBC" psql -U postgres -d postgres < "$REPO_ROOT/supabase/heidi-init.sql" >/dev/null
docker exec -i "$DBC" psql -U postgres -d postgres \
  < "$REPO_ROOT/supabase/migrations/20260617000005_heidi_orchestrator_schema.sql" >/dev/null 2>&1 || true
docker exec -i "$DBC" psql -U postgres -d postgres >/dev/null <<'SQL'
GRANT ALL ON ALL TABLES IN SCHEMA public TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
SQL

# 5. Boot HYDI wired to the local stack.
export SUPABASE_URL="$SB_API_URL"
export SUPABASE_SERVICE_ROLE_KEY="$SB_SERVICE_ROLE_KEY"
export SUPABASE_ANON_KEY="$SB_ANON_KEY"
export NEXT_PUBLIC_SUPABASE_URL="$SB_API_URL"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="$SB_ANON_KEY"

log "SUPABASE_URL -> $SUPABASE_URL"
log "booting HYDI..."
cd "$REPO_ROOT"
exec npm run boot
