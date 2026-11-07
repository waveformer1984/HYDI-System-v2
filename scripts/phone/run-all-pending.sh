#!/usr/bin/env bash
# Aggregate Phase 7 phone checks (see docs/NEEDS_FROM_JORDAN.md).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$ROOT"
echo "=== pair-status ==="
bash scripts/phone/pair-status.sh || true
echo "=== health-probe ==="
bash scripts/phone/health-probe.sh || true
echo "=== ports doc (grep) ==="
grep -E 'heidi-mobile-chat|heidi-core|next-app' config/ports.json | head -5
