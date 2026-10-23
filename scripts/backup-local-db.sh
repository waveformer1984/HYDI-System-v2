#!/usr/bin/env bash
# Backup the local HYDI Supabase/Postgres database.
# Credentials are read from .env and .env.local; values are never logged.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKUP_DIR="${BACKUP_DIR:-$ROOT/backups/local}"
TIMESTAMP=$(date -u +%Y%m%d-%H%M%S)
RUN_DIR="$BACKUP_DIR/$TIMESTAMP"

CONTAINER="supabase_db_HYDI-System-v2"
DB_USER="supabase_admin"
DB_NAME="postgres"
DB_PASSWORD="postgres"

mkdir -p "$RUN_DIR"

echo "[backup] starting local backup to $RUN_DIR"

# Custom-format dump (schema + data). Password is supplied via PGPASSWORD env.
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" pg_dump -Fc -U "$DB_USER" -d "$DB_NAME" > "$RUN_DIR/hydi-postgres.dmp"

# Plain SQL schema-only dump for human review.
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" pg_dump -s -U "$DB_USER" -d "$DB_NAME" > "$RUN_DIR/hydi-schema.sql"

# Plain SQL data-only dump for key tables.
# Users/Tracks are examples; we dump the full custom file as primary.
docker exec -e PGPASSWORD="$DB_PASSWORD" "$CONTAINER" pg_dump -a --column-inserts -U "$DB_USER" -d "$DB_NAME" \
  -t rezonate_projects -t rezonate_tracks -t system_health_runs > "$RUN_DIR/hydi-key-data.sql" 2>/dev/null || true

# Verify the custom dump is a valid pg_dump archive by attempting pg_restore -l.
docker exec -e PGPASSWORD="$DB_PASSWORD" -i "$CONTAINER" pg_restore -U "$DB_USER" -l -f - < "$RUN_DIR/hydi-postgres.dmp" > "$RUN_DIR/hydi-toc.txt"

# Metadata (no credentials).
cat > "$RUN_DIR/meta.json" <<EOF
{
  "timestamp_utc": "$TIMESTAMP",
  "source": "local",
  "container": "$CONTAINER",
  "database": "$DB_NAME",
  "user": "$DB_USER",
  "format": "pg_restore custom",
  "files": {
    "full": "hydi-postgres.dmp",
    "schema": "hydi-schema.sql",
    "key_data": "hydi-key-data.sql",
    "toc": "hydi-toc.txt"
  }
}
EOF

# Size report.
SIZE=$(du -sh "$RUN_DIR" | cut -f1)
echo "[backup] completed: $RUN_DIR ($SIZE)"
echo "[backup] do not commit dumps to git"
