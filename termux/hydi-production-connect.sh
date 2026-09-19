#!/usr/bin/env bash
#
# hydi-production-connect.sh — verify a HYDI-System-v2 host is correctly and
# SAFELY reachable, locally and (optionally) through a public tunnel, before
# anything external is pointed at it.
#
# Runs on the operator machine (Termux, Linux, or Git Bash on the Windows
# host). Read-only: it starts no servers, opens no tunnels, and writes no
# config — it probes and reports, so a failure is a real finding rather than
# a half-applied change.
#
#   bash termux/hydi-production-connect.sh                         # local only
#   bash termux/hydi-production-connect.sh --public-url https://x.ts.net
#   bash termux/hydi-production-connect.sh --public-url https://x.ts.net \
#        --heidi-url https://hydi-heidi.vercel.app
#
# SECRETS: HYDI_SERVICE_SECRET is read from the environment only. It is never
# printed, never passed in argv (where `ps` would expose it), and the signed
# tokens derived from it go to curl through a 0600 config file that is removed
# on exit. Reported secret facts are limited to SET/UNSET and byte length.
#
# Endpoint contract (verified against this repo, not assumed):
#   GET  /api/health      -> api/health.js via pages/api/health.js. No auth by
#                            design; safe to expose.
#   POST /api/chat/route  -> api/chat/route.js via pages/api/chat/route.js.
#                            HMAC-gated. Body {message, system}. THIS is the
#                            endpoint a remote portal integrates against.
#   POST /api/chat        -> pages/api/chat.ts. Heidi's own single-agent SSE
#                            stream. Body {message, session_id, user_id}.
#                            *** NO service-token check. *** Probing this path
#                            for auth yields a false pass, and exposing it
#                            publicly publishes an open orchestrator endpoint.
#                            This script tests for exactly that.

set -uo pipefail

BASE_URL="http://127.0.0.1:3000"
PUBLIC_URL=""
HEIDI_URL=""
SERVICE_NAME="heidi-chat-portal"
CURL_TIMEOUT=20

FAILURES=0
WARNINGS=0

c_red=$'\033[31m'; c_grn=$'\033[32m'; c_yel=$'\033[33m'; c_dim=$'\033[2m'; c_off=$'\033[0m'
if [ ! -t 1 ]; then c_red=""; c_grn=""; c_yel=""; c_dim=""; c_off=""; fi

pass() { printf '  %sPASS%s  %s\n' "$c_grn" "$c_off" "$1"; }
warn() { printf '  %sWARN%s  %s\n' "$c_yel" "$c_off" "$1"; WARNINGS=$((WARNINGS + 1)); }
fail() { printf '  %sFAIL%s  %s\n' "$c_red" "$c_off" "$1"; FAILURES=$((FAILURES + 1)); }
info() { printf '  %s....%s  %s\n' "$c_dim" "$c_off" "$1"; }
phase() { printf '\n%s\n' "== $1"; }

usage() {
  sed -n '3,30p' "$0" | sed 's/^# \{0,1\}//'
  exit "${1:-0}"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --base-url)   BASE_URL="${2:-}"; shift 2 ;;
    --public-url) PUBLIC_URL="${2:-}"; shift 2 ;;
    --heidi-url)  HEIDI_URL="${2:-}"; shift 2 ;;
    --service)    SERVICE_NAME="${2:-}"; shift 2 ;;
    -h|--help)    usage 0 ;;
    *) printf 'Unknown argument: %s\n' "$1" >&2; usage 2 ;;
  esac
done

# Trailing slashes turn "$URL/api/health" into a 404 on some proxies.
BASE_URL="${BASE_URL%/}"
PUBLIC_URL="${PUBLIC_URL%/}"
HEIDI_URL="${HEIDI_URL%/}"

TMPDIR_RUN="$(mktemp -d "${TMPDIR:-/tmp}/hydi-connect.XXXXXX")" || exit 1
chmod 700 "$TMPDIR_RUN"
trap 'rm -rf "$TMPDIR_RUN"' EXIT INT TERM

need() {
  command -v "$1" >/dev/null 2>&1 || { printf 'Required command not found: %s\n' "$1" >&2; exit 1; }
}
need curl
need node

# ---------------------------------------------------------------------------
# http_code <method> <url> [body-file] [curl-config-file]
#   Echoes the HTTP status (000 on transport failure). Response body lands in
#   $TMPDIR_RUN/body. Never echoes headers, so a token cannot leak into output.
# ---------------------------------------------------------------------------
http_code() {
  local method="$1" url="$2" body_file="${3:-}" cfg="${4:-}"
  local -a args=(-sS -o "$TMPDIR_RUN/body" -w '%{http_code}'
                 --max-time "$CURL_TIMEOUT" -X "$method")
  [ -n "$body_file" ] && args+=(-H 'Content-Type: application/json' --data-binary "@$body_file")
  [ -n "$cfg" ] && args+=(--config "$cfg")
  curl "${args[@]}" "$url" 2>"$TMPDIR_RUN/curlerr" || printf '000'
}

body_prefix() { head -c 160 "$TMPDIR_RUN/body" 2>/dev/null | tr -d '\r\n'; }

# ---------------------------------------------------------------------------
# mint_token_config <out-config-file> <request-id>
#   Writes a curl --config file carrying a freshly signed service token.
#   Signing happens in node with the secret read from the environment; neither
#   the secret nor the token ever reaches argv, stdout, or the shell history.
# ---------------------------------------------------------------------------
mint_token_config() {
  local out="$1" rid="$2"
  : >"$out"; chmod 600 "$out"
  PROBE_RID="$rid" PROBE_SVC="$SERVICE_NAME" node -e '
    const { createHmac } = require("crypto");
    const secret = process.env.HYDI_SERVICE_SECRET;
    if (!secret) process.exit(3);
    const ts  = Date.now().toString();
    const rid = process.env.PROBE_RID;
    const svc = process.env.PROBE_SVC;
    const sig = createHmac("sha256", secret).update(`${ts}:${rid}:${svc}`).digest("hex");
    process.stdout.write(`header = "x-hydi-service-token: ${ts}.${rid}.${svc}.${sig}"\n`);
    process.stdout.write(`header = "x-request-id: ${rid}"\n`);
  ' >>"$out"
}

printf '%s\n' "HYDI production connectivity check"
printf '%s\n' "  local base : $BASE_URL"
[ -n "$PUBLIC_URL" ] && printf '%s\n' "  public URL : $PUBLIC_URL"
[ -n "$HEIDI_URL" ]  && printf '%s\n' "  heidi URL  : $HEIDI_URL"

# ===========================================================================
phase "Phase 1 — repo and local host"
# ===========================================================================
REPO_ROOT="$(cd "$(dirname "$0")/.." 2>/dev/null && pwd)"
if git -C "$REPO_ROOT" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  pass "repo root: $REPO_ROOT ($(git -C "$REPO_ROOT" rev-parse --abbrev-ref HEAD))"
else
  warn "not inside a git work tree — running against $BASE_URL anyway"
fi

for f in pages/api/health.js pages/api/chat/route.js lib/auth/verifyServiceToken.js; do
  if [ -f "$REPO_ROOT/$f" ]; then
    info "present: $f"
  else
    fail "missing: $f — this checkout cannot serve the documented contract"
  fi
done

# ===========================================================================
phase "Phase 2 — HYDI_SERVICE_SECRET"
# ===========================================================================
HAVE_SECRET=0
if [ -n "${HYDI_SERVICE_SECRET:-}" ]; then
  HAVE_SECRET=1
  if [ "${#HYDI_SERVICE_SECRET}" -eq 64 ]; then
    pass "HYDI_SERVICE_SECRET: SET (len=${#HYDI_SERVICE_SECRET}, expected 64 hex)"
  else
    warn "HYDI_SERVICE_SECRET: SET but len=${#HYDI_SERVICE_SECRET} (expected 64 hex from 'openssl rand -hex 32')"
  fi
else
  fail "HYDI_SERVICE_SECRET: UNSET — generate with 'openssl rand -hex 32', put it in the HYDI .env, restart HYDI, and set the SAME value on the consuming portal"
fi

# ===========================================================================
phase "Phase 3 — local endpoints"
# ===========================================================================
probe_health() {
  local label="$1" base="$2" code
  code="$(http_code GET "$base/api/health")"
  case "$code" in
    200) pass "$label GET /api/health -> 200" ;;
    503) warn "$label GET /api/health -> 503 (degraded: system_dashboard view unreachable — Supabase down or Docker not running)" ;;
    000) fail "$label GET /api/health -> no response ($(head -c 100 "$TMPDIR_RUN/curlerr" | tr -d '\r\n'))" ;;
    *)   fail "$label GET /api/health -> $code :: $(body_prefix)" ;;
  esac
}

# The gated router: /api/chat/route, body {message, system}.
probe_gated_chat() {
  local label="$1" base="$2" code rid cfg
  [ "$HAVE_SECRET" -eq 1 ] || { info "$label POST /api/chat/route: skipped (no secret)"; return; }
  rid="connect-probe-$(date +%s)-$$"
  cfg="$TMPDIR_RUN/hdr.cfg"
  if ! mint_token_config "$cfg" "$rid"; then
    fail "$label token minting failed"; return
  fi
  printf '{"message":"__connectivity_check__","system":"ursula"}' >"$TMPDIR_RUN/req.json"
  code="$(http_code POST "$base/api/chat/route" "$TMPDIR_RUN/req.json" "$cfg")"
  rm -f "$cfg"
  case "$code" in
    200)     pass "$label POST /api/chat/route -> 200 (token accepted, router answered)" ;;
    400)     pass "$label POST /api/chat/route -> 400 (token accepted; payload rejected downstream) :: $(body_prefix)" ;;
    401)     fail "$label POST /api/chat/route -> 401 :: $(body_prefix)
          Secret mismatch between this shell and the running HYDI process, or
          clock skew > 5 min (verifyServiceToken.js enforces a 5-minute window)." ;;
    429)     warn "$label POST /api/chat/route -> 429 (rate limited: 30 req/min — token itself was accepted)" ;;
    000)     fail "$label POST /api/chat/route -> no response" ;;
    *)       fail "$label POST /api/chat/route -> $code :: $(body_prefix)" ;;
  esac
}

# The OPEN endpoint: /api/chat has no service-token check (pages/api/chat.ts).
# Probe it with a deliberately invalid token. A 2xx proves it is unauthenticated.
probe_open_chat() {
  local label="$1" base="$2" code cfg exposed="$3"
  cfg="$TMPDIR_RUN/bad.cfg"
  : >"$cfg"; chmod 600 "$cfg"
  printf 'header = "x-hydi-service-token: 0.bad.bad.00"\n' >>"$cfg"
  printf '{"message":"__connectivity_check__","session_id":"connect-probe","user_id":"connect-probe"}' >"$TMPDIR_RUN/req2.json"
  code="$(http_code POST "$base/api/chat" "$TMPDIR_RUN/req2.json" "$cfg")"
  rm -f "$cfg"
  case "$code" in
    401|403)
      pass "$label POST /api/chat with a bad token -> $code (endpoint is gated)" ;;
    2*)
      if [ "$exposed" = "exposed" ]; then
        fail "$label POST /api/chat with a BAD token -> $code — UNAUTHENTICATED AND PUBLICLY REACHABLE.
          pages/api/chat.ts serves /api/chat and performs no service-token
          check, so this tunnel publishes Heidi's orchestrator to the open
          internet. Do not point a portal at this host until /api/chat is
          gated, blocked at the tunnel, or the funnel is taken down."
      else
        warn "$label POST /api/chat with a BAD token -> $code — unauthenticated (expected: pages/api/chat.ts has no token check).
          Harmless while bound to localhost. Becomes a live exposure the
          moment this port is tunnelled — re-run with --public-url to have
          that treated as a failure."
      fi ;;
    000) fail "$label POST /api/chat -> no response" ;;
    *)   info "$label POST /api/chat with a bad token -> $code :: $(body_prefix)" ;;
  esac
}

probe_health "local " "$BASE_URL"
probe_gated_chat "local " "$BASE_URL"
probe_open_chat "local " "$BASE_URL" "local"

# ===========================================================================
phase "Phase 4 — public tunnel"
# ===========================================================================
if [ -z "$PUBLIC_URL" ]; then
  info "no --public-url given; skipping (expose with 'tailscale funnel 3000', then re-run)"
else
  case "$PUBLIC_URL" in
    https://*) : ;;
    *) fail "public URL is not https:// — the service token would cross the network in the clear" ;;
  esac
  probe_health "public" "$PUBLIC_URL"
  probe_gated_chat "public" "$PUBLIC_URL"
  probe_open_chat "public" "$PUBLIC_URL" "exposed"
fi

# ===========================================================================
phase "Phase 5 — consuming portal"
# ===========================================================================
if [ -z "$HEIDI_URL" ]; then
  info "no --heidi-url given; skipping"
else
  code="$(http_code GET "$HEIDI_URL/mobile")"
  case "$code" in
    200) pass "GET $HEIDI_URL/mobile -> 200" ;;
    000) fail "GET $HEIDI_URL/mobile -> no response (not deployed yet?)" ;;
    *)   fail "GET $HEIDI_URL/mobile -> $code" ;;
  esac

  code="$(http_code GET "$HEIDI_URL/api/mobile/status")"
  if [ "$code" = "200" ]; then
    pass "GET $HEIDI_URL/api/mobile/status -> 200"
    node -e '
      const fs = require("fs");
      let d; try { d = JSON.parse(fs.readFileSync(process.argv[1], "utf8")); }
      catch { console.log("         (body was not JSON)"); process.exit(0); }
      const c = d.connectivity || {};
      for (const k of ["hostReachable", "healthOk", "authOk", "nextAction"]) {
        if (k in c) console.log(`         ${k}: ${c[k]}`);
      }
      for (const x of (d.diagnostics || []).slice(0, 5)) {
        console.log(`         - [${x.code}] ${x.message}`);
      }
    ' "$TMPDIR_RUN/body"
    warn "if that portal probes /api/chat for auth, its authOk is not trustworthy — the gated path is /api/chat/route"
  else
    fail "GET $HEIDI_URL/api/mobile/status -> $code :: $(body_prefix)"
  fi
fi

# ===========================================================================
phase "Summary"
# ===========================================================================
printf '  failures: %d   warnings: %d\n' "$FAILURES" "$WARNINGS"
if [ "$FAILURES" -gt 0 ]; then
  printf '  %sNOT READY%s — resolve the failures above before pointing anything external at this host.\n' "$c_red" "$c_off"
  exit 1
fi
if [ "$WARNINGS" -gt 0 ]; then
  printf '  %sREADY WITH WARNINGS%s — review each warning above.\n' "$c_yel" "$c_off"
  exit 0
fi
printf '  %sREADY%s\n' "$c_grn" "$c_off"
exit 0
