#!/bin/sh
# Termux HYDI recovery bundle — run ON THE PHONE from repo root.
# Cloud agents cannot execute this; output is evidence for the operator.
#
#   cd ~/HYDI-System-v2 && sh termux/hydi-recovery.sh [--apply-storage]
#
# Phases: audit → storage (dry-run) → optional apply → fix-all → doctor
set -u

APPLY_STORAGE=0
case "${1:-}" in
  --apply-storage) APPLY_STORAGE=1 ;;
esac

ROOT=""
if [ -f "$PWD/termux/hydi-recovery.sh" ]; then
  ROOT=$PWD
elif [ -f "$HOME/HYDI-System-v2/termux/hydi-recovery.sh" ]; then
  ROOT="$HOME/HYDI-System-v2"
else
  printf 'Run from ~/HYDI-System-v2\n' >&2
  exit 1
fi

REPORT="${HOME}/.hydi/recovery-$(date -u +%Y%m%dT%H%M%SZ).log"
mkdir -p "$HOME/.hydi"
chmod 700 "$HOME/.hydi" 2>/dev/null || true

exec > >(tee -a "$REPORT") 2>&1

say() { printf '\n[%s] %s\n' "$(date -u +%H:%M:%S)" "$*"; }

say "HYDI Termux recovery — report: $REPORT"
say "PHASE A — environment"
uname -a 2>/dev/null || true
command -v termux-info >/dev/null 2>&1 && termux-info | head -5 || say "not Termux (or termux-info missing)"
say "repo=$ROOT branch=$(git -C "$ROOT" rev-parse --abbrev-ref HEAD 2>/dev/null) head=$(git -C "$ROOT" rev-parse --short HEAD 2>/dev/null)"

say "PHASE B — storage audit"
sh "$ROOT/termux/hydi-storage-audit.sh" || true

if [ "$APPLY_STORAGE" = 1 ]; then
  say "PHASE C — storage recover (--apply)"
  sh "$ROOT/termux/hydi-storage-recover.sh" --apply || true
else
  say "PHASE C — storage recover (dry-run only; pass --apply-storage to execute)"
  sh "$ROOT/termux/hydi-storage-recover.sh" --dry-run || true
fi

say "PHASE D–F — service restore (hydi-fix-all + doctor)"
if [ -x "$ROOT/termux/hydi-fix-all.sh" ]; then
  sh "$ROOT/termux/hydi-fix-all.sh" || true
else
  sh "$ROOT/termux/hydi-fix-all.sh" || true
fi

if [ -x "$ROOT/scripts/hydi-doctor.sh" ]; then
  sh "$ROOT/scripts/hydi-doctor.sh" || true
elif command -v hydi-doctor >/dev/null 2>&1; then
  hydi-doctor || true
else
  say "hydi-doctor not found — ln -sf $ROOT/scripts/hydi-doctor.sh \$PREFIX/bin/hydi-doctor"
fi

say "PHASE G — Ollama probes (existing models only)"
if command -v ollama >/dev/null 2>&1; then
  ollama list 2>&1 || say "ollama list failed (daemon down?)"
  if command -v curl >/dev/null 2>&1; then
    code=$(curl -sS -o /dev/null -m 3 -w '%{http_code}' http://127.0.0.1:11434/api/tags 2>/dev/null || echo 000)
    say "ollama HTTP /api/tags: $code"
  fi
else
  say "ollama not on PATH"
fi

say "PHASE H — port map reminder"
say "  hydi.py PWA (hydi-daemon): default 3006 — /api/health"
say "  hydi-chat-server.js: env PORT (often 8787)"
say "  llama.cpp (hydi service): default 8080 — not the chat UI"
say "  hydi-processor (PC): 3003 — usually not on phone"
say "  ollama: 11434"

say "Done. Paste $REPORT into Heidi chat if blocked."
