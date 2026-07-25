#!/usr/bin/env bash
# local-backup.sh — HYDI System v2 local disaster-recovery backup
#
# Implements the backup leg of the Sovereign Local Development Protocol:
# no remote push/pull is required or performed. Every backup is a
# self-contained artifact that can restore the repository on a machine
# with no network access.
#
# Artifacts created per run, all timestamped (UTC, sortable):
#   <backup-dir>/hydi-system-<ts>.bundle          full git history, all refs
#   <backup-dir>/hydi-system-<ts>-snapshot.tar.gz  tracked-files-only archive at HEAD
#   <backup-dir>/manifest.log                      append-only log of every backup run
# A lightweight tag `backup-<ts>` is left on HEAD so any bundle can be
# traced back to an exact commit without touching the log.
#
# Retention: keeps the most recent N bundle+snapshot pairs (default 10);
# older ones are deleted. Tags are never deleted automatically.
#
# Usage:
#   ./scripts/local-backup.sh                # create a backup, default dir
#   ./scripts/local-backup.sh backup [dir]   # explicit subcommand + dir override
#   ./scripts/local-backup.sh verify [dir]   # verify the newest bundle, no new backup
#   ./scripts/local-backup.sh list [dir]     # list backups with commit + timestamp
#   ./scripts/local-backup.sh restore <bundle> <dest-dir>
#
# Env override: HYDI_BACKUP_DIR (same effect as passing [dir])
#
# Exit: 0 = success, 1 = failure

set -uo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m'

ok()      { echo -e "${GREEN}  ✓${NC} $1"; }
fail()    { echo -e "${RED}  ✗${NC} $1"; }
warn()    { echo -e "${YELLOW}  ⚠${NC} $1"; }
section() { echo -e "\n${CYAN}${BOLD}── $1 ──${NC}"; }

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT" || exit 1

DEFAULT_BACKUP_DIR="${HYDI_BACKUP_DIR:-$HOME/HYDI_Backups/HYDI_System}"
RETAIN_COUNT=10

CMD="${1:-backup}"

resolve_backup_dir() {
  local override="${1:-}"
  if [[ -n "$override" ]]; then
    echo "$override"
  else
    echo "$DEFAULT_BACKUP_DIR"
  fi
}

cmd_backup() {
  local backup_dir
  backup_dir="$(resolve_backup_dir "${1:-}")"
  mkdir -p "$backup_dir" || { fail "could not create backup dir: $backup_dir"; exit 1; }

  if ! git rev-parse --is-inside-work-tree >/dev/null 2>&1; then
    fail "not inside a git repository: $REPO_ROOT"
    exit 1
  fi

  section "HYDI local backup — $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "  repo:       $REPO_ROOT"
  echo "  backup dir: $backup_dir"

  local ts commit branch bundle_path archive_path
  ts="$(date -u +%Y%m%dT%H%M%SZ)"
  commit="$(git rev-parse HEAD)"
  branch="$(git rev-parse --abbrev-ref HEAD)"
  bundle_path="$backup_dir/hydi-system-$ts.bundle"
  archive_path="$backup_dir/hydi-system-$ts-snapshot.tar.gz"

  local dirty="clean"
  if [[ -n "$(git status --porcelain)" ]]; then
    dirty="dirty"
    warn "working tree has uncommitted changes; bundle covers committed history only"
  fi

  if git bundle create "$bundle_path" --all >/tmp/hydi-backup-bundle.log 2>&1; then
    ok "bundle created: $(basename "$bundle_path")"
  else
    fail "bundle creation failed"
    cat /tmp/hydi-backup-bundle.log
    exit 1
  fi

  if git bundle verify "$bundle_path" >/tmp/hydi-backup-verify.log 2>&1; then
    ok "bundle verified"
  else
    fail "bundle failed verification"
    cat /tmp/hydi-backup-verify.log
    exit 1
  fi

  if git archive --format=tar.gz -o "$archive_path" HEAD 2>/tmp/hydi-backup-archive.log; then
    ok "tracked-files snapshot created: $(basename "$archive_path")"
  else
    fail "snapshot archive failed"
    cat /tmp/hydi-backup-archive.log
    exit 1
  fi

  # Best-effort tag; do not fail the backup if HEAD is already tagged
  # (e.g. two backups run back-to-back on an unchanged commit).
  if git tag -a "backup-$ts" -m "Local backup snapshot $ts" >/dev/null 2>&1; then
    ok "tagged HEAD as backup-$ts"
  else
    warn "tag backup-$ts not created (already tagged at this commit or tag exists)"
  fi

  local bundle_size archive_size
  bundle_size="$(du -h "$bundle_path" | cut -f1)"
  archive_size="$(du -h "$archive_path" | cut -f1)"

  {
    echo "$ts | commit=$commit | branch=$branch | tree=$dirty | bundle=$(basename "$bundle_path") ($bundle_size) | snapshot=$(basename "$archive_path") ($archive_size)"
  } >> "$backup_dir/manifest.log"
  ok "manifest updated: $backup_dir/manifest.log"

  prune "$backup_dir"

  section "Summary"
  echo "  commit:    $commit ($branch, $dirty)"
  echo "  bundle:    $bundle_path ($bundle_size)"
  echo "  snapshot:  $archive_path ($archive_size)"
  ok "backup complete"
}

prune() {
  local backup_dir="$1"
  local bundles
  mapfile -t bundles < <(ls -1 "$backup_dir"/hydi-system-*.bundle 2>/dev/null | sort)
  local count=${#bundles[@]}
  if (( count <= RETAIN_COUNT )); then
    return 0
  fi
  local excess=$((count - RETAIN_COUNT))
  section "Retention (keeping newest $RETAIN_COUNT)"
  for ((i = 0; i < excess; i++)); do
    local b="${bundles[$i]}"
    local snap="${b%.bundle}-snapshot.tar.gz"
    rm -f "$b"
    [[ -f "$snap" ]] && rm -f "$snap"
    warn "pruned $(basename "$b")"
  done
}

cmd_verify() {
  local backup_dir
  backup_dir="$(resolve_backup_dir "${1:-}")"
  local latest
  latest="$(ls -1t "$backup_dir"/hydi-system-*.bundle 2>/dev/null | head -1)"
  if [[ -z "$latest" ]]; then
    fail "no bundles found in $backup_dir"
    exit 1
  fi
  section "Verifying newest bundle"
  echo "  $latest"
  if git bundle verify "$latest"; then
    ok "bundle is valid and restorable"
  else
    fail "bundle failed verification"
    exit 1
  fi
}

cmd_list() {
  local backup_dir
  backup_dir="$(resolve_backup_dir "${1:-}")"
  if [[ ! -f "$backup_dir/manifest.log" ]]; then
    warn "no manifest found in $backup_dir"
    exit 0
  fi
  section "Backup history — $backup_dir"
  cat "$backup_dir/manifest.log"
}

cmd_restore() {
  local bundle="${1:-}"
  local dest="${2:-}"
  if [[ -z "$bundle" || -z "$dest" ]]; then
    fail "usage: local-backup.sh restore <bundle-path> <dest-dir>"
    exit 1
  fi
  if [[ ! -f "$bundle" ]]; then
    fail "bundle not found: $bundle"
    exit 1
  fi
  if [[ -e "$dest" ]]; then
    fail "destination already exists: $dest"
    exit 1
  fi
  section "Restoring $bundle -> $dest"
  if git clone "$bundle" "$dest"; then
    ok "restored to $dest"
    echo "  cd \"$dest\" && git branch -a   # verify branches restored"
  else
    fail "restore failed"
    exit 1
  fi
}

case "$CMD" in
  backup) cmd_backup "${2:-}" ;;
  verify) cmd_verify "${2:-}" ;;
  list)   cmd_list "${2:-}" ;;
  restore) cmd_restore "${2:-}" "${3:-}" ;;
  *)
    fail "unknown command: $CMD"
    echo "usage: local-backup.sh [backup|verify|list|restore] [args...]"
    exit 1
    ;;
esac
