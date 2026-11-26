#!/bin/sh
# Read-only Heidi tailnet probe for phone (Termux). No auth, cookies, or query strings.
set -eu

URL="${HEIDI_TAILNET_URL:-https://heidi-pc.tailc50af2.ts.net}"
URL="${URL%/}"

degraded_names=""
have_degraded=0

verdict_for() {
  name="$1"
  code="$2"
  time_total="$3"

  if [ "$code" = "000" ]; then
    printf '%s\n' "unreachable — host not responding"
    return
  fi

  if awk "BEGIN { exit !($time_total > 6.0) }"; then
    printf '%s\n' "slow — response took over 6s"
    return
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

run_check() {
  name="$1"
  endpoint="$2"
  target="${URL}${endpoint}"

  out=$(curl -sS -o /dev/null --max-time 15 -w '%{http_code} %{time_total}' "$target" 2>/dev/null) || out="000 0"

  code=$(printf '%s\n' "$out" | awk '{print $1}')
  time_total=$(printf '%s\n' "$out" | awk '{print $2}')

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
run_check heidi /heidi
run_check state /api/heidi-mobile/state

if [ "$have_degraded" -eq 0 ]; then
  printf '%s\n' "ALL OK"
  exit 0
fi

printf 'DEGRADED: %s\n' "$degraded_names"
exit 1