#!/data/data/com.termux/files/usr/bin/bash
# thin-client.sh — point Hydi at Frank's Ollama, fall back to local llama-server.
# Fetch: curl -fsSL https://raw.githubusercontent.com/waveformer1984/HYDI-System-v2/clean-main/scripts/termux/thin-client.sh -o ~/thin-client.sh && bash ~/thin-client.sh
set -euo pipefail

ENV_FILE="${HYDI_ENV_FILE:-$HOME/.hydi.env}"
MODEL="${HYDI_OLLAMA_MODEL:-qwen2.5:3b-instruct-q4_K_M}"
LOCAL_LLAMA="${HYDI_LLAMA_URL:-http://127.0.0.1:8080}"

say() { printf '%s\n' "$*"; }
die() { say "ERROR: $*" >&2; exit 1; }

command -v curl >/dev/null 2>&1 || die "curl is missing (pkg install -y curl)"

if [ ! -f "$ENV_FILE" ]; then
  die "missing $ENV_FILE — set FRANK_IP there (no hardcoded LAN IP in this script)"
fi

# shellcheck disable=SC1090
set -a
# shellcheck source=/dev/null
. "$ENV_FILE"
set +a

[ -n "${FRANK_IP:-}" ] || die "FRANK_IP is unset in $ENV_FILE"
case "$FRANK_IP" in
  *[!0-9a-zA-Z.:_-]* ) die "FRANK_IP has unexpected characters" ;;
esac

FRANK_OLLAMA="http://${FRANK_IP}:11434"
say "Checking Frank Ollama at $FRANK_OLLAMA ..."
if curl -fsS --max-time 8 "${FRANK_OLLAMA}/api/tags" >/dev/null; then
  say "Frank is up — using remote Ollama model $MODEL"
  export OLLAMA_URL="$FRANK_OLLAMA"
  export OLLAMA_MODEL="$MODEL"
  unset HYDI_LLAMA_URL 2>/dev/null || true
  say "export OLLAMA_URL=$OLLAMA_URL"
  say "export OLLAMA_MODEL=$OLLAMA_MODEL"
  exit 0
fi

say "Frank unreachable — falling back to local llama-server at $LOCAL_LLAMA"
if ! curl -fsS --max-time 5 "${LOCAL_LLAMA}/v1/models" >/dev/null 2>&1; then
  say "Local llama-server is not answering on $LOCAL_LLAMA"
  say "Start the hydi runit service or llama-server, then re-run this script."
  exit 2
fi

export HYDI_LLAMA_URL="$LOCAL_LLAMA"
unset OLLAMA_URL 2>/dev/null || true
say "export HYDI_LLAMA_URL=$HYDI_LLAMA_URL"
exit 0
