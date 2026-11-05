#!/data/data/com.termux/files/usr/bin/bash
# Canonical thin-client lives in scripts/termux/thin-client.sh (this path is kept for docs/ADB push).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
exec bash "$ROOT/scripts/termux/thin-client.sh" --apply "$@"
