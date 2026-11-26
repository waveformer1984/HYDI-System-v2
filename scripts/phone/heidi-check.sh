#!/bin/sh
# Read-only Heidi tailnet probe for phone (Termux). No auth, cookies, or query strings.
set -eu

URL="${HEIDI_TAILNET_URL:-https://heidi-pc.tailc50af2.ts.net}"
URL="${URL%/}"

LIFELINE_HOST="${HEIDI_LIFELINE_HOST:-heidi-pc.tailc50af2.ts.net}"
LIFELINE_URL="${HEIDI_LIFELINE_URL:-https://${LIFELINE_HOST}:8443/lifeline/}"

degraded_names=""
have_degraded=0

have_tailscale_ip() {
  if command -v ip >/dev/null 2>&1; then
    ip -4 addr 2>/dev/null | grep -E 'inet 100\.[0-9]+\.[0-9]+\.[0-9]+' >/dev/null 2>&1 && return 0
  fi
  if command -v ifconfig >/dev/null 2>&1; then
    ifconfig 2>/dev/null | grep -E 'inet 100\.[0-9]+\.[0-9]+\.[0-9]+' >/dev/null 2>&1 && return 0
  fi
  return 1
}

is_loopback_probe() {
  case "$URL" in
    http://127.0.0.1:*|http://127.0.0.1|http://localhost:*|http://localhost) return 0 ;;
    *) return 1 ;;
  esac
}

if ! is_loopback_probe && ! have_tailscale_ip; then
  printf '%s\n' 'PHONE NOT ON TAILSCALE: open the Tailscale app and turn it on'
  printf '%s\n' 'VERDICT: PHONE_OFF_TAILNET'
  exit 2
fi

verdict_for() {
  name="$1"
  code="$2"
  time_total="$3"

  if [ "$code" = "000" ]; then
    printf '%s\n' "unreachable — host not responding"
    return
  fi

  if command -v awk >/dev/null 2>&1; then
    if awk "BEGIN { exit !($time_total > 6.0) }" 2>/dev/null; then
      printf '%s\n' "slow — response took over 6s"
      return
    fi
  fi

  if [ "$code" = "200" ]; then
    printf '%s\n' "OK"
    return
  fi

  if [ "$name" = "state" ] && [ "$code" = "503" ]; then
    printf '%s\n' "BFF up, upstream down (Supabase?)"
    return
  fi

  printf '%s\n' "unexpected HTTP $code"
}

LAST_HTTP_CODE="000"

run_check() {
  name="$1"
  endpoint="$2"
  target="${URL}${endpoint}"

  if command -v curl >/dev/null 2>&1; then
    out=$(curl -sS -o /dev/null --max-time 10 -w '%{http_code} %{time_total}' "$target" 2>/dev/null) || out="000 0"
  else
    out="000 0"
  fi

  code=$(printf '%s\n' "$out" | awk '{print $1}')
  time_total=$(printf '%s\n' "$out" | awk '{print $2}')
  LAST_HTTP_CODE=$code

  verdict=$(verdict_for "$name" "$code" "$time_total")
  printf '%s %s %ss %s\n' "$name" "$code" "$time_total" "$verdict"

  if [ "$verdict" != "OK" ]; then
    have_degraded=1
    if [ -z "$degraded_names" ]; then
      degraded_names="$name"
    else
      degraded_names="$degraded_names $name"
    fi
  fi
}

run_external_check() {
  name="$1"
  target="$2"
  if command -v curl >/dev/null 2>&1; then
    out=$(curl -sS -o /dev/null --max-time 10 -w '%{http_code} %{time_total}' "$target" 2>/dev/null) || out="000 0"
  else
    out="000 0"
  fi
  code=$(printf '%s\n' "$out" | awk '{print $1}')
  time_total=$(printf '%s\n' "$out" | awk '{print $2}')
  LAST_HTTP_CODE=$code
  verdict=$(verdict_for "$name" "$code" "$time_total")
  printf '%s %s %ss %s\n' "$name" "$code" "$time_total" "$verdict"
  if [ "$verdict" != "OK" ]; then
    have_degraded=1
    if [ -z "$degraded_names" ]; then
      degraded_names="$name"
    else
      degraded_names="$degraded_names $name"
    fi
  fi
}

run_check health /api/health
health_code=$LAST_HTTP_CODE
run_check heidi /heidi
heidi_code=$LAST_HTTP_CODE
run_check state /api/heidi-mobile/state

if is_loopback_probe; then
  run_external_check lifeline_health "http://127.0.0.1:${HEIDI_LIFELINE_PORT:-1}/health"
else
  run_external_check lifeline_health "https://${LIFELINE_HOST}:8443/health"
fi
lifeline_health_code=$LAST_HTTP_CODE

web_ok=0
if [ "$health_code" = "200" ] || [ "$heidi_code" = "200" ]; then
  web_ok=1
fi

lifeline_ok=0
if [ "$lifeline_health_code" = "200" ]; then
  lifeline_ok=1
fi

if [ "$have_degraded" -eq 0 ]; then
  printf '%s\n' 'ALL OK'
  printf '%s\n' 'VERDICT: OK'
  exit 0
fi

printf 'DEGRADED: %s\n' "$degraded_names"

if [ "$web_ok" -eq 0 ] && [ "$lifeline_ok" -eq 1 ]; then
  printf '%s\n' "VERDICT: WEB_DOWN_LIFELINE_UP — open ${LIFELINE_URL} and tap Restart heidi-web-standalone"
  exit 1
fi

if [ "$web_ok" -eq 0 ] && [ "$lifeline_ok" -eq 0 ]; then
  printf '%s\n' 'VERDICT: ALL_DOWN — Frank off/asleep, or tailscale serve not configured for :3000 and Lifeline :8443'
  exit 1
fi

printf '%s\n' 'VERDICT: DEGRADED (web partially up)'
exit 1