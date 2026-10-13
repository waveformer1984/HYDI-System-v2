#!/usr/bin/env bash
# Cursor Cloud Agent — one-time install (runs on environment build snapshot).
# Idempotent: safe to re-run on a fresh VM without a build.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

echo "[cloud-agent-install] repo: $ROOT"

node_major="$(node -p "process.versions.node.split('.')[0]" 2>/dev/null || echo 0)"
if [ "${node_major:-0}" -lt 20 ]; then
  echo "[cloud-agent-install] ERROR: Node >= 20 required (got $(node -v 2>/dev/null || echo missing))" >&2
  exit 1
fi
echo "[cloud-agent-install] node $(node -v)"

echo "[cloud-agent-install] npm ci (root)"
npm ci

if [ -f mcp/protoforge-mcp/package.json ]; then
  echo "[cloud-agent-install] npm ci (protoforge-mcp)"
  (cd mcp/protoforge-mcp && npm ci)
fi

# Docker is required for local Supabase (same as unit-tests.yml). Install on
# build so `start` can bring up dockerd quickly on agent boot.
if ! command -v docker >/dev/null 2>&1; then
  echo "[cloud-agent-install] installing docker.io"
  if command -v sudo >/dev/null 2>&1; then
    sudo DEBIAN_FRONTEND=noninteractive apt-get update -qq
    sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq docker.io
  else
    echo "[cloud-agent-install] WARN: docker missing and sudo unavailable" >&2
  fi
fi

echo "[cloud-agent-install] done"
