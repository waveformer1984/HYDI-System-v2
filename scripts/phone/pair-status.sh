#!/usr/bin/env bash
# Check whether device cookie / token env is present (no network).
set -euo pipefail
if [[ -n "${HEIDI_MOBILE_TOKEN:-}" ]]; then
  echo "PASS HEIDI_MOBILE_TOKEN is set (len=${#HEIDI_MOBILE_TOKEN})"
else
  echo "FAIL HEIDI_MOBILE_TOKEN unset — pair on Frank: POST /api/pair"
  exit 1
fi
if [[ -n "${HYDI_SERVICE_SECRET:-}" ]]; then
  echo "PASS HYDI_SERVICE_SECRET is set"
else
  echo "SKIP HYDI_SERVICE_SECRET unset"
fi
