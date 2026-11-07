#!/usr/bin/env bash
# Quick health probes from Termux — read-only.
set -euo pipefail
BASE="${HYDI_API_URL:-http://127.0.0.1:3000}"
BASE="${BASE%/}"

probe() {
  local name="$1" url="$2"
  if curl -sf --max-time 8 "$url" >/dev/null 2>&1; then
    echo "PASS $name — $url"
  else
    echo "FAIL $name — $url"
    return 1
  fi
}

fail=0
probe "heidi-web" "$BASE/api/health" || fail=1
probe "mobile-status" "$BASE/api/mobile-status" || fail=1
if [[ -n "${HEIDI_CORE_URL:-}" ]]; then
  probe "heidi-core" "${HEIDI_CORE_URL%/}/health" || fail=1
else
  echo "SKIP heidi-core — HEIDI_CORE_URL unset"
fi
exit "$fail"
