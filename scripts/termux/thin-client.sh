#!/data/data/com.termux/files/usr/bin/bash
# thin-client.sh — one Termux path: tailnet Frank Ollama → LAN FRANK_IP → local llama-server.
# Install: curl -fsSL https://raw.githubusercontent.com/waveformer1984/HYDI-System-v2/clean-main/scripts/termux/thin-client.sh -o ~/thin-client.sh && bash ~/thin-client.sh
set -euo pipefail

PC_HOST="${THIN_PC_HOST:-heidi-pc.tailc50af2.ts.net}"
MODEL="${HYDI_OLLAMA_MODEL:-qwen2.5:3b-instruct-q4_K_M}"
LOCAL_LLAMA="${HYDI_LLAMA_URL:-http://127.0.0.1:8080}"
HYDI_ENV_FILE="${HYDI_ENV_FILE:-$HOME/.hydi.env}"
ENV_DIR="$HOME/.hydi"
ENV_FILE="$ENV_DIR/thin-client.env"
BOOT="$HOME/.termux/boot/start_hydi.sh"
SVDIR="${PREFIX:-/data/data/com.termux/files/usr}/var/service"
STAMP="$(date +%Y%m%d-%H%M%S)"
MARK="# hydi-thin-client: load tailnet settings"
OLD_IP="192.168.1.100"
DISABLE_LLM=0
FORCE=0
DRY=0
APPLY=0

usage() {
  printf '%s\n' \
    "Usage: thin-client.sh [--apply] [--pc HOST] [--disable-local-llm] [--force] [--dry-run]" \
    "  --apply            write ~/.hydi/thin-client.env and patch boot (default: probe + print exports)" \
    "  --pc HOST          tailnet MagicDNS name (default: heidi-pc.tailc50af2.ts.net)" \
    "  --disable-local-llm  stop local llama-server/ollama runit services" \
    "  --force            continue when tailnet probe fails" \
    "  --dry-run          print actions only"
}

while [ $# -gt 0 ]; do
  case "$1" in
    --pc) PC_HOST="${2:?--pc needs a host}"; shift 2 ;;
    --apply) APPLY=1; shift ;;
    --disable-local-llm) DISABLE_LLM=1; shift ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf 'unknown option: %s\n' "$1" >&2; usage; exit 2 ;;
  esac
done

say() { printf '%s\n' "$*"; }
run() { if [ "$DRY" = 1 ]; then say "  [dry-run] $*"; else "$@"; fi; }

command -v curl >/dev/null 2>&1 || { say "curl is missing: pkg install -y curl"; exit 1; }

code() { curl -sS -o /dev/null -m 10 -w '%{http_code}' "$1" 2>/dev/null || true; }

TAIL_OLLAMA="https://${PC_HOST}:11434"
TAIL_UPSTREAM="https://${PC_HOST}"
LAN_IP=""
LAN_OLLAMA=""

if [ -f "$HYDI_ENV_FILE" ]; then
  # shellcheck disable=SC1090
  set -a
  # shellcheck source=/dev/null
  . "$HYDI_ENV_FILE"
  set +a
fi
if [ -n "${FRANK_IP:-}" ]; then
  case "$FRANK_IP" in
    *[!0-9a-zA-Z.:_-]* ) say "FRANK_IP in $HYDI_ENV_FILE has unexpected characters; ignoring LAN"; FRANK_IP="" ;;
  esac
  LAN_IP="$FRANK_IP"
  LAN_OLLAMA="http://${LAN_IP}:11434"
fi

say "== Probe order: tailnet → LAN FRANK_IP → local llama-server"
tail_ok=0
lan_ok=0
heidi=$(code "${TAIL_UPSTREAM}/heidi")
ollama=$(code "${TAIL_OLLAMA}/api/tags")
say "  tailnet heidi ${TAIL_UPSTREAM}/heidi -> ${heidi:-000}"
say "  tailnet ollama ${TAIL_OLLAMA}/api/tags -> ${ollama:-000}"
if [ "${ollama:-000}" = "200" ]; then
  tail_ok=1
fi

if [ "$tail_ok" = 0 ] && [ -n "$LAN_OLLAMA" ]; then
  say "  LAN ollama ${LAN_OLLAMA}/api/tags ..."
  if curl -fsS --max-time 8 "${LAN_OLLAMA}/api/tags" >/dev/null 2>&1; then
    lan_ok=1
    say "  LAN Frank answered"
  else
    say "  LAN Frank did not answer (check FRANK_IP in $HYDI_ENV_FILE)"
  fi
elif [ "$tail_ok" = 0 ] && [ -z "$LAN_OLLAMA" ]; then
  say "  LAN skipped: FRANK_IP unset in $HYDI_ENV_FILE"
fi

MODE=""
if [ "$tail_ok" = 1 ]; then
  MODE=tailnet
  OLLAMA_URL="$TAIL_OLLAMA"
  HYDI_UPSTREAM="$TAIL_UPSTREAM"
  FRANK_IP="$PC_HOST"
elif [ "$lan_ok" = 1 ]; then
  MODE=lan
  OLLAMA_URL="$LAN_OLLAMA"
  HYDI_UPSTREAM="http://${LAN_IP}"
else
  MODE=local
  say "  remote Frank unreachable — trying local llama-server at $LOCAL_LLAMA"
  if ! curl -fsS --max-time 5 "${LOCAL_LLAMA}/v1/models" >/dev/null 2>&1; then
    say "Local llama-server is not answering on $LOCAL_LLAMA"
    if [ "${heidi:-000}" = "000" ] && [ "$FORCE" != 1 ]; then
      say "Open Tailscale on the phone, set FRANK_IP in $HYDI_ENV_FILE, or start local llama-server."
      exit 3
    fi
    [ "$FORCE" = 1 ] && say "--force given: continuing without a working backend."
    exit 2
  fi
fi

if [ "$MODE" = local ]; then
  say "export HYDI_LLAMA_URL=$LOCAL_LLAMA"
  [ "$APPLY" = 1 ] && [ "$DRY" = 0 ] && mkdir -p "$ENV_DIR" && printf '# thin-client local fallback %s\nHYDI_LLAMA_URL=%s\n' "$STAMP" "$LOCAL_LLAMA" > "$ENV_FILE" && chmod 600 "$ENV_FILE"
  exit 0
fi

say "Using $MODE Frank Ollama with model $MODEL"
say "export OLLAMA_URL=$OLLAMA_URL"
say "export OLLAMA_MODEL=$MODEL"
say "export HYDI_UPSTREAM=$HYDI_UPSTREAM"

if [ "$APPLY" != 1 ]; then
  exit 0
fi

PREV_HOST=""
if [ -f "$ENV_FILE" ]; then
  PREV_HOST="$(sed -n 's/^FRANK_IP=//p' "$ENV_FILE" | tail -1)"
fi
OLD_VALUES="$OLD_IP"
if [ -n "$PREV_HOST" ] && [ "$PREV_HOST" != "$FRANK_IP" ]; then
  OLD_VALUES="$OLD_IP
$PREV_HOST"
fi

say "== Writing $ENV_FILE"
if [ "$DRY" = 1 ]; then
  say "  [dry-run] OLLAMA_URL=$OLLAMA_URL HYDI_UPSTREAM=$HYDI_UPSTREAM FRANK_IP=$FRANK_IP"
else
  mkdir -p "$ENV_DIR"
  tmp="$(mktemp "$ENV_DIR/.thin-client.XXXXXX")"
  {
    printf '# Written by scripts/termux/thin-client.sh on %s. No secrets here.\n' "$STAMP"
    printf 'OLLAMA_URL=%s\n' "$OLLAMA_URL"
    printf 'HYDI_UPSTREAM=%s\n' "$HYDI_UPSTREAM"
    printf 'FRANK_IP=%s\n' "$FRANK_IP"
    printf 'OLLAMA_MODEL=%s\n' "$MODEL"
  } > "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$ENV_FILE"
fi

say "== Boot script $BOOT"
if [ ! -f "$BOOT" ]; then
  say "  not present (Termux:Boot not set up) — skipped"
else
  needs_source=1
  grep -qF "$MARK" "$BOOT" && needs_source=0
  needs_ip=0
  while IFS= read -r v; do
    [ -n "$v" ] && grep -qF "$v" "$BOOT" && needs_ip=1
  done <<< "$OLD_VALUES"
  if [ "$needs_source" = 0 ] && [ "$needs_ip" = 0 ]; then
    say "  already patched"
  elif [ "$DRY" = 1 ]; then
    say "  [dry-run] would patch boot script"
  else
    BOOT_BAK="$BOOT.bak-$STAMP"
    cp -p "$BOOT" "$BOOT_BAK"
    tmp="$(mktemp "$(dirname "$BOOT")/.start_hydi.XXXXXX")"
    TC_MARK="$MARK" \
    TC_SRC='[ -f "$HOME/.hydi/thin-client.env" ] && set -a && . "$HOME/.hydi/thin-client.env" && set +a' \
    TC_NEED="$needs_source" TC_OLDS="$OLD_VALUES" TC_HOST="$FRANK_IP" awk '
      function lit(s, old, new,   out, i) {
        out = ""
        while (old != "" && (i = index(s, old)) > 0) { out = out substr(s, 1, i - 1) new; s = substr(s, i + length(old)) }
        return out s
      }
      BEGIN { n = split(ENVIRON["TC_OLDS"], olds, "\n") }
      NR == 1 && /^#!/ { print; if (ENVIRON["TC_NEED"] == 1) { print ENVIRON["TC_MARK"]; print ENVIRON["TC_SRC"] }; next }
      NR == 1 && ENVIRON["TC_NEED"] == 1 { print ENVIRON["TC_MARK"]; print ENVIRON["TC_SRC"] }
      { for (k = 1; k <= n; k++) $0 = lit($0, olds[k], ENVIRON["TC_HOST"]); print }
    ' "$BOOT" > "$tmp"
    chmod --reference="$BOOT" "$tmp" 2>/dev/null || chmod 700 "$tmp"
    mv -f "$tmp" "$BOOT"
    say "  backup: $BOOT_BAK"
  fi
fi

if [ "$DISABLE_LLM" = 1 ]; then
  say "== Stopping local inference services"
  if [ -d "$SVDIR" ]; then
    for svc in "$SVDIR"/*/; do
      svc="${svc%/}"
      name="$(basename "$svc")"
      [ -f "$svc/run" ] || continue
      if grep -qE 'llama-server|llama\.cpp|ollama serve' "$svc/run"; then
        run sv down "$svc" || true
        run touch "$svc/down"
        say "  stopped + autostart off: $name"
      fi
    done
  fi
fi

say "Done. Restart: sv restart hydi hydi-daemon 2>/dev/null || true"
