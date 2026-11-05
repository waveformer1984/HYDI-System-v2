#!/bin/sh
# Safe, reversible Termux storage cleanup for HYDI phone node.
# Default: --dry-run. Use --apply to execute listed actions only.
#
# NEVER: ollama models, heidi memory DBs, .git, credentials, unrestricted rm -rf.
set -u

APPLY=0
case "${1:-}" in
  --apply) APPLY=1 ;;
  --dry-run|'') APPLY=0 ;;
  *)
    printf 'Usage: %s [--dry-run|--apply]\n' "$0" >&2
    exit 2
    ;;
esac

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
HOME="${HOME:-$PREFIX/home}"
REPO="${HYDI_REPO:-$HOME/HYDI-System-v2}"
LOG="${HOME}/.hydi/storage-recover.log"
mkdir -p "$HOME/.hydi"
chmod 700 "$HOME/.hydi" 2>/dev/null || true

log() {
  line="[$(date -u +%Y-%m-%dT%H:%M:%SZ)] $*"
  printf '%s\n' "$line" >> "$LOG"
  printf '%s\n' "$line"
}

is_protected() {
  case "$1" in
    *"/.ollama"|*"/.ollama/"*|*".git"|*"/.git/"*) return 0 ;;
    *heidi_memory.db*|*"/heidi-core/data/"*) return 0 ;;
    *thin-client.env*|*.env.hydi*) return 0 ;;
  esac
  return 1
}

run_action() {
  label=$1
  shift
  if [ "$APPLY" = 0 ]; then
    log "DRY-RUN: $label — $*"
    return 0
  fi
  log "APPLY: $label — $*"
  "$@"
}

log "=== hydi-storage-recover start (apply=$APPLY) ==="

# P1 caches
if [ -d "$PREFIX/var/cache/apt/archives" ]; then
  run_action "apt archives" sh -c "rm -f '$PREFIX/var/cache/apt/archives/'*.deb 2>/dev/null || true"
fi
if [ -d "$HOME/.npm/_cacache" ] && command -v npm >/dev/null 2>&1; then
  run_action "npm cache" npm cache clean --force
fi
if [ -d "$HOME/.cache/pip" ]; then
  run_action "pip cache" rm -rf "$HOME/.cache/pip"
fi

# P2 __pycache__ under repo only
if [ -d "$REPO" ] && ! is_protected "$REPO"; then
  run_action "repo __pycache__" find "$REPO" -type d -name __pycache__ -not -path '*/.git/*' -exec rm -rf {} +
  run_action "repo .pyc" find "$REPO" -name '*.pyc' -not -path '*/.git/*' -delete
fi

# PM2 logs only
if command -v pm2 >/dev/null 2>&1; then
  run_action "pm2 flush" pm2 flush
fi

log "=== done; log: $LOG ==="
if [ "$APPLY" = 0 ]; then
  log "Re-run with --apply after review"
fi
