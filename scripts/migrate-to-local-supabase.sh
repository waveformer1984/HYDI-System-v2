#!/usr/bin/env bash
#
# Data-only migration from the Supabase Cloud project to a self-hosted
# local instance, for LOCAL_FIRST_EXECUTION_PLAN.md's Phase 1. See
# LOCAL_FIRST_PHASE1_RUNBOOK.md's Step 3 for full context.
#
# Requires SOURCE_DATABASE_URL and TARGET_DATABASE_URL to already be
# exported in the environment (never pass them as CLI args — they'd land
# in shell history and process listings). Assumes the schema has already
# been migrated into TARGET_DATABASE_URL (Step 2 of the runbook) — this
# script only moves data, it does not run supabase/migrations/*.sql.
#
# Usage:
#   ./scripts/migrate-to-local-supabase.sh --dry-run   # print commands only
#   ./scripts/migrate-to-local-supabase.sh             # actually run it
#
set -euo pipefail

DRY_RUN=false
if [[ "${1:-}" == "--dry-run" ]]; then
  DRY_RUN=true
fi

if [[ -z "${SOURCE_DATABASE_URL:-}" || -z "${TARGET_DATABASE_URL:-}" ]]; then
  echo "Set SOURCE_DATABASE_URL and TARGET_DATABASE_URL first (export them in your shell, never as CLI args)." >&2
  exit 1
fi

for bin in pg_dump psql; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "Missing required tool: $bin (install the postgresql-client package for this host)." >&2
    exit 1
  fi
done

DUMP_FILE="$(mktemp -t hydi-data-migration-XXXXXX.sql)"
trap 'rm -f "$DUMP_FILE"' EXIT

DUMP_CMD=(pg_dump --data-only --no-owner --no-privileges --schema=public --file="$DUMP_FILE" "$SOURCE_DATABASE_URL")
RESTORE_CMD=(psql "$TARGET_DATABASE_URL" --file="$DUMP_FILE" --set ON_ERROR_STOP=on)

echo "== Plan =="
echo "1. ${DUMP_CMD[*]}"
echo "2. ${RESTORE_CMD[*]}"
echo "3. Per-table row-count comparison between source and target"
echo

if $DRY_RUN; then
  echo "--dry-run: not executing. Re-run without the flag when ready."
  exit 0
fi

echo "== Step 1: dumping data from source =="
"${DUMP_CMD[@]}"

echo "== Step 2: restoring into target =="
"${RESTORE_CMD[@]}"

echo "== Step 3: verifying row counts =="
TABLES="$(psql "$SOURCE_DATABASE_URL" --tuples-only --no-align -c \
  "select tablename from pg_tables where schemaname = 'public' order by tablename;")"

MISMATCHES=0
while IFS= read -r table; do
  [[ -z "$table" ]] && continue
  SOURCE_COUNT="$(psql "$SOURCE_DATABASE_URL" --tuples-only --no-align -c "select count(*) from \"$table\";")"
  TARGET_COUNT="$(psql "$TARGET_DATABASE_URL" --tuples-only --no-align -c "select count(*) from \"$table\";")"
  if [[ "$SOURCE_COUNT" != "$TARGET_COUNT" ]]; then
    echo "MISMATCH: $table — source=$SOURCE_COUNT target=$TARGET_COUNT"
    MISMATCHES=$((MISMATCHES + 1))
  else
    echo "OK: $table ($SOURCE_COUNT rows)"
  fi
done <<< "$TABLES"

if [[ "$MISMATCHES" -gt 0 ]]; then
  echo
  echo "$MISMATCHES table(s) mismatched — do not cut over until this is resolved." >&2
  exit 1
fi

echo
echo "All row counts match. Safe to proceed to the runbook's Step 4 (cut over)."
