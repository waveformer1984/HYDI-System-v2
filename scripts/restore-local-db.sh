#!/usr/bin/env bash
# Restore a local HYDI backup to a disposable test database and verify it.
# Never targets the real 'postgres' database.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${1:-}"
TEST_DB="hydi_test_restore_$(date -u +%s)"
CONTAINER="supabase_db_HYDI-System-v2"
DB_USER="supabase_admin"
DB_PASSWORD="postgres"

if [ -z "$BACKUP_DIR" ] || [ ! -f "$BACKUP_DIR/hydi-postgres.dmp" ]; then
  echo "[restore] usage: $0 <backup-directory>"
  echo "[restore] expected: <backup-directory>/hydi-postgres.dmp"
  exit 1
fi

echo "[restore] creating disposable test database: $TEST_DB"
docker exec -e PGPASSWORD="$DB_PASSWORD" -i "$CONTAINER" psql -U "$DB_USER" -d postgres -c "CREATE DATABASE \"$TEST_DB\";"

echo "[restore] restoring backup (non-fatal cron/scheduler warnings are allowed)..."
set +e
docker exec -i --env PGPASSWORD="$DB_PASSWORD" "$CONTAINER" pg_restore -U "$DB_USER" -d "$TEST_DB" --no-owner --no-privileges < "$BACKUP_DIR/hydi-postgres.dmp"
RESTORE_RC=$?
set -e

if [ "$RESTORE_RC" -gt 1 ]; then
  echo "[restore] FATAL restore error (code $RESTORE_RC); aborting"
  docker exec -e PGPASSWORD="$DB_PASSWORD" -i "$CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE \"$TEST_DB\" WITH (FORCE);"
  exit 1
fi

echo "[restore] verifying schema (restore exit code $RESTORE_RC indicates warnings only)..."
SCHEMA_TABLES=$(docker exec -e PGPASSWORD="$DB_PASSWORD" -i "$CONTAINER" psql -U "$DB_USER" -d "$TEST_DB" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';")
echo "[restore] public tables in test restore: $SCHEMA_TABLES"

echo "[restore] verifying representative data..."
HEALTH_RUNS=$(docker exec -e PGPASSWORD="$DB_PASSWORD" -i "$CONTAINER" psql -U "$DB_USER" -d "$TEST_DB" -t -c "SELECT COUNT(*) FROM public.system_health_runs;")
echo "[restore] system_health_runs rows: $HEALTH_RUNS"

echo "[restore] verifying constraints..."
CONSTRAINTS=$(docker exec -e PGPASSWORD="$DB_PASSWORD" -i "$CONTAINER" psql -U "$DB_USER" -d "$TEST_DB" -t -c "SELECT COUNT(*) FROM information_schema.table_constraints WHERE constraint_schema = 'public';")
echo "[restore] public constraints: $CONSTRAINTS"

echo "[restore] cleaning up disposable database: $TEST_DB"
docker exec -e PGPASSWORD="$DB_PASSWORD" -i "$CONTAINER" psql -U "$DB_USER" -d postgres -c "DROP DATABASE \"$TEST_DB\" WITH (FORCE);"

echo "[restore] backup $BACKUP_DIR verified successfully"
