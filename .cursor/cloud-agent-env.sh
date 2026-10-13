#!/usr/bin/env bash
# Source local Supabase keys written by cloud-agent-start.sh (not committed).
# Usage: set -a && source .cursor/cloud-agent-env.sh && set +a
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FILE="$HERE/supabase-local.env"

if [ ! -f "$FILE" ]; then
  echo "cloud-agent-env: missing $FILE — run .cursor/cloud-agent-start.sh or wait for agent boot" >&2
  return 1 2>/dev/null || exit 1
fi

# shellcheck source=/dev/null
set -a
source "$FILE"
set +a

# Map Supabase CLI env names to what HYDI expects (same as unit-tests.yml).
export SUPABASE_URL="${API_URL:-${SUPABASE_URL:-}}"
export NEXT_PUBLIC_SUPABASE_URL="${SUPABASE_URL}"
export SUPABASE_SERVICE_ROLE_KEY="${SERVICE_ROLE_KEY:-${SUPABASE_SERVICE_ROLE_KEY:-}}"
export NEXT_PUBLIC_SUPABASE_ANON_KEY="${ANON_KEY:-${NEXT_PUBLIC_SUPABASE_ANON_KEY:-}}"
