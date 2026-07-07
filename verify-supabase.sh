#!/usr/bin/env bash
# verify-supabase.sh — HYDI System v2 Supabase health check
#
# Checks: env vars, REST API, core tables, system_dashboard view,
#         key RPC functions, edge function deployment, migration files.
#
# Exit: 0 = operational (with or without warnings)
#       1 = one or more critical checks failed
#
# Usage:
#   ./verify-supabase.sh              # uses env vars already in shell
#   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... ./verify-supabase.sh

set -uo pipefail

# ── colours ──────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

PASS=0
FAIL=0
WARN=0

ok()      { echo -e "${GREEN}  ✓${NC} $1"; PASS=$((PASS + 1)); }
fail()    { echo -e "${RED}  ✗${NC} $1"; FAIL=$((FAIL + 1)); }
warn()    { echo -e "${YELLOW}  ⚠${NC} $1"; WARN=$((WARN + 1)); }
section() { echo -e "\n${CYAN}${BOLD}── $1 ──${NC}"; }

# ── load .env if present ─────────────────────────────────────────────────
if [[ -f ".env" ]]; then
  # shellcheck source=/dev/null
  set -a; source .env; set +a
  echo -e "${CYAN}Loaded .env${NC}"
fi

echo ""
echo -e "${BOLD}HYDI System v2 — Supabase Verification${NC}"
echo "Project ref : akbnfovjdcobifeupvbn"
echo "Timestamp   : $(date -u '+%Y-%m-%dT%H:%M:%SZ')"

# ── 1. Environment variables ──────────────────────────────────────────────
section "1. Environment Variables"

REQUIRED_VARS=(
  SUPABASE_URL
  SUPABASE_SERVICE_ROLE_KEY
)

OPTIONAL_VARS=(
  NEXT_PUBLIC_SUPABASE_URL
  NEXT_PUBLIC_SUPABASE_ANON_KEY
  SUPABASE_PUBLISHABLE_KEY
  STRIPE_SECRET_KEY
  STRIPE_WEBHOOK_SECRET_01
  STRIPE_CONNECT_WEBHOOK_SECRET
  KEEPER_BREAK_GLASS_TOKEN
)

for v in "${REQUIRED_VARS[@]}"; do
  if [[ -n "${!v:-}" ]]; then
    ok "$v is set"
  else
    fail "$v MISSING (required)"
  fi
done

for v in "${OPTIONAL_VARS[@]}"; do
  if [[ -n "${!v:-}" ]]; then
    ok "$v is set"
  else
    warn "$v not set (optional but recommended)"
  fi
done

if [[ -z "${SUPABASE_URL:-}" || -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]]; then
  echo -e "\n${RED}FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY required — aborting.${NC}"
  exit 1
fi

# Normalise: strip trailing slash
BASE="${SUPABASE_URL%/}"
KEY="${SUPABASE_SERVICE_ROLE_KEY}"
EDGE_BASE="${BASE}/functions/v1"

# ── 2. REST API connectivity ──────────────────────────────────────────────
section "2. REST API Connectivity"

rest_get() {
  # Usage: rest_get <path> [extra-headers...]
  curl -s -o /dev/null -w "%{http_code}" \
    -H "apikey: ${KEY}" \
    -H "Authorization: Bearer ${KEY}" \
    "$@" \
    "${BASE}${1}" 2>/dev/null || echo "000"
}

# PostgREST root
status=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "apikey: ${KEY}" \
  -H "Authorization: Bearer ${KEY}" \
  "${BASE}/rest/v1/" 2>/dev/null || echo "000")
case "$status" in
  200) ok "PostgREST API reachable (HTTP $status)" ;;
  401) fail "PostgREST: auth rejected (HTTP 401) — check service role key" ;;
  *)   fail "PostgREST unreachable (HTTP $status)" ;;
esac

# Auth API (GoTrue admin endpoints require a Bearer token, not just apikey —
# cloud Kong used to translate the apikey header, local Kong does not)
status=$(curl -s -o /dev/null -w "%{http_code}" \
  -H "apikey: ${KEY}" \
  -H "Authorization: Bearer ${KEY}" \
  "${BASE}/auth/v1/admin/users?page=1&per_page=1" 2>/dev/null || echo "000")
case "$status" in
  200) ok "Auth API reachable (HTTP $status)" ;;
  401) fail "Auth API: authentication rejected (HTTP 401)" ;;
  *)   warn "Auth API returned HTTP $status" ;;
esac

# ── Helper: HEAD a PostgREST table ────────────────────────────────────────
check_table() {
  local tbl="$1"
  curl -s -o /dev/null -w "%{http_code}" \
    -H "apikey: ${KEY}" \
    -H "Authorization: Bearer ${KEY}" \
    -H "Prefer: count=exact" \
    "${BASE}/rest/v1/${tbl}?limit=0" 2>/dev/null || echo "000"
}

# ── 3. Core tables ────────────────────────────────────────────────────────
section "3. Core Tables"

CORE_TABLES=(
  memories
  actions
  sessions
  ledger
  clients
  payouts
  leads
  quotes
  proposals
  checkout_sessions
  webhook_events
  worker_jobs
)

for tbl in "${CORE_TABLES[@]}"; do
  status=$(check_table "$tbl")
  case "$status" in
    200|206) ok "table '$tbl' accessible" ;;
    404)     fail "table '$tbl' NOT FOUND" ;;
    401|403) warn "table '$tbl' — RLS blocking service role (unexpected)" ;;
    *)       warn "table '$tbl' returned HTTP $status" ;;
  esac
done

# ── 4. system_dashboard view ──────────────────────────────────────────────
section "4. system_dashboard View"

status=$(check_table "system_dashboard")
case "$status" in
  200|206) ok "system_dashboard view is queryable" ;;
  404)     fail "system_dashboard view NOT FOUND — health endpoints will degrade" ;;
  *)       warn "system_dashboard returned HTTP $status" ;;
esac

# ── 5. RPC functions ──────────────────────────────────────────────────────
section "5. RPC Functions"

check_rpc() {
  local fn="$1"
  curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "apikey: ${KEY}" \
    -H "Authorization: Bearer ${KEY}" \
    -H "Content-Type: application/json" \
    -d '{}' \
    "${BASE}/rest/v1/rpc/${fn}" 2>/dev/null || echo "000"
}

RPC_FUNCTIONS=(
  retry_failed_jobs
  flag_dead_jobs
  generate_monthly_payouts
)

for fn in "${RPC_FUNCTIONS[@]}"; do
  status=$(check_rpc "$fn")
  case "$status" in
    200|204) ok "rpc '${fn}' callable" ;;
    404)     fail "rpc '${fn}' NOT FOUND" ;;
    400|422) warn "rpc '${fn}' deployed but rejected empty payload (expected if it needs params)" ;;
    *)       warn "rpc '${fn}' returned HTTP $status" ;;
  esac
done

# ── 6. Edge functions ─────────────────────────────────────────────────────
section "6. Edge Functions"

check_edge_fn() {
  local fn="$1"
  local bearer="${2:-}"
  local auth_header=""
  [[ -n "$bearer" ]] && auth_header="-H \"Authorization: Bearer ${bearer}\""
  curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    ${auth_header:+-H "Authorization: Bearer ${bearer}"} \
    -H "Content-Type: application/json" \
    -d '{"_verify":true}' \
    "${EDGE_BASE}/${fn}" 2>/dev/null || echo "000"
}

# Public functions (no JWT required per config.toml)
PUBLIC_FNS=(
  api-gateway
  notification-service
  search-service
  cache-service
)

# JWT-protected functions
PROTECTED_FNS=(
  billing-engine
  payment-processing
  monitoring-health
  heidi-reflect
  stripe-webhook
  keymaker-gate
  jobs-processor
)

for fn in "${PUBLIC_FNS[@]}"; do
  status=$(check_edge_fn "$fn" "")
  case "$status" in
    200|201|204) ok "edge fn '$fn' responding" ;;
    400|422)     ok "edge fn '$fn' deployed (rejected probe payload — expected)" ;;
    404)         fail "edge fn '$fn' NOT DEPLOYED" ;;
    000)         warn "edge fn '$fn' unreachable (network/timeout)" ;;
    *)           warn "edge fn '$fn' HTTP $status" ;;
  esac
done

for fn in "${PROTECTED_FNS[@]}"; do
  status=$(check_edge_fn "$fn" "${KEY}")
  case "$status" in
    200|201|204) ok "edge fn '$fn' responding" ;;
    400|422)     ok "edge fn '$fn' deployed (rejected probe payload — expected)" ;;
    401|403)     ok "edge fn '$fn' deployed (JWT gate active — expected for public calls)" ;;
    404)         fail "edge fn '$fn' NOT DEPLOYED" ;;
    000)         warn "edge fn '$fn' unreachable (network/timeout)" ;;
    *)           warn "edge fn '$fn' HTTP $status" ;;
  esac
done

# ── 7. Migrations ─────────────────────────────────────────────────────────
section "7. Migration Files"

MIGRATION_DIR="supabase/migrations"
if [[ -d "$MIGRATION_DIR" ]]; then
  ACTIVE=$(find "$MIGRATION_DIR" -name "*.sql" ! -name "*.sql.skip" | wc -l | tr -d ' ')
  SKIPPED=$(find "$MIGRATION_DIR" -name "*.sql.skip" | wc -l | tr -d ' ')
  ok "$ACTIVE active migration(s) found ($SKIPPED skipped with .sql.skip)"
else
  fail "Migration directory '$MIGRATION_DIR' not found"
fi

# ── 8. Supabase CLI ───────────────────────────────────────────────────────
section "8. Supabase CLI"

if command -v supabase &>/dev/null; then
  CLI_VER=$(supabase --version 2>/dev/null | head -1 || echo "unknown")
  ok "supabase CLI available: $CLI_VER"
else
  warn "supabase CLI not installed (needed for migrations and local dev)"
fi

# ── Summary ───────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}════════════════════════════════════════════${NC}"
echo -e "${BOLD}  SUMMARY${NC}"
printf "  ${GREEN}%-10s${NC} %d\n" "PASSED"  "$PASS"
printf "  ${YELLOW}%-10s${NC} %d\n" "WARNED"  "$WARN"
printf "  ${RED}%-10s${NC} %d\n"    "FAILED"  "$FAIL"
echo -e "${BOLD}════════════════════════════════════════════${NC}"
echo ""

if [[ $FAIL -gt 0 ]]; then
  echo -e "${RED}RESULT: DEGRADED — $FAIL critical check(s) failed${NC}"
  exit 1
elif [[ $WARN -gt 0 ]]; then
  echo -e "${YELLOW}RESULT: OPERATIONAL WITH WARNINGS ($WARN warning(s))${NC}"
  exit 0
else
  echo -e "${GREEN}RESULT: FULLY OPERATIONAL${NC}"
  exit 0
fi
