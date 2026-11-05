#!/bin/sh
# Read-only storage audit for Termux / Android HYDI node.
# Never deletes. Ranks recoverable space (estimates only).
# Usage: sh termux/hydi-storage-audit.sh [--json]
set -u

JSON=0
case "${1:-}" in
  --json) JSON=1 ;;
esac

say() {
  if [ "$JSON" = 0 ]; then
    printf '%s\n' "$*"
  fi
}

json_line() {
  if [ "$JSON" = 1 ]; then
    printf '%s\n' "$1"
  fi
}

du_kb() {
  path=$1
  [ -e "$path" ] || return 0
  du -sk "$path" 2>/dev/null | awk '{print $1}'
}

human_mib() {
  kb=$1
  [ -n "$kb" ] || { printf '0'; return; }
  awk -v k="$kb" 'BEGIN { printf "%.0f", k/1024 }'
}

PREFIX="${PREFIX:-/data/data/com.termux/files/usr}"
HOME="${HOME:-$PREFIX/home}"

# --- device storage (Android shared storage may differ) ---
df_line=""
if command -v df >/dev/null 2>&1; then
  df_line=$(df -h "$HOME" 2>/dev/null | tail -n 1 || true)
  say "== df ($HOME)"
  say "$df_line"
fi

# --- ranked candidates (P1 = safest, never touches models/memory/git) ---
ranked=""

add_rank() {
  rank=$1
  label=$2
  path=$3
  note=$4
  kb=$(du_kb "$path")
  [ -n "$kb" ] || return 0
  mib=$(human_mib "$kb")
  ranked="${ranked}${rank}|${label}|${path}|${mib}|${note}
"
  say "P${rank} ~${mib} MiB — ${label}"
  say "    ${path}"
  say "    ${note}"
  json_line "{\"rank\":${rank},\"label\":\"${label}\",\"path\":\"${path}\",\"mib_est\":${mib},\"note\":\"${note}\"}"
}

say ""
say "== ranked recoverable (estimate; read-only)"
say "Protected (never auto-clean): ~/.ollama, heidi-core/data/*.db, .git, credentials"

add_rank 1 "Termux apt cache" "$PREFIX/var/cache/apt" "pkg cache; safe after successful installs"
add_rank 1 "User .cache" "$HOME/.cache" "app caches; verify no custom data inside"
add_rank 1 "npm cache" "$HOME/.npm/_cacache" "npm cache only; run npm cache clean"
add_rank 1 "pip cache" "$HOME/.cache/pip" "pip wheel cache"
add_rank 2 "Python __pycache__ under repo" "$HOME/HYDI-System-v2" "delete only *.pyc/__pycache__ via hydi-storage-recover.sh"
add_rank 2 "Next/.next build artifact on phone" "$HOME/HYDI-System-v2/.next" "only if you do not serve Next on phone"
add_rank 2 "node_modules on phone clone" "$HOME/HYDI-System-v2/node_modules" "reinstall with npm ci if removed"
add_rank 3 "PM2 logs" "$HOME/.pm2/logs" "pm2 flush; not configs"
add_rank 3 "Termux tmp" "${TMPDIR:-/tmp}" "temp files; skip if unsure"

# Ollama: report size, never rank for deletion
ollama_kb=$(du_kb "$HOME/.ollama")
if [ -n "$ollama_kb" ]; then
  say ""
  say "== protected: Ollama (~$(human_mib "$ollama_kb") MiB)"
  say "    $HOME/.ollama (models preserved by policy)"
  json_line "{\"protected\":\"ollama\",\"path\":\"$HOME/.ollama\",\"mib_est\":$(human_mib "$ollama_kb")}"
fi

# Memory DB hints
for db in \
  "$HOME/HYDI-System-v2/heidi-core/data/heidi_memory.db" \
  "$HOME/.hydi/heidi_memory.db"
do
  if [ -f "$db" ]; then
    kb=$(du_kb "$db")
    say "== protected: memory DB (~$(human_mib "$kb") MiB) $db"
    json_line "{\"protected\":\"memory_db\",\"path\":\"$db\",\"mib_est\":$(human_mib "$kb")}"
  fi
done

say ""
say "Run: sh termux/hydi-storage-recover.sh --dry-run"
say "Then: sh termux/hydi-storage-recover.sh --apply  (only after reviewing dry-run)"
