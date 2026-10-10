#!/data/data/com.termux/files/usr/bin/bash
# setup-thin-client.sh -- turn this Termux phone into a thin client of the
# HYDI PC over Tailscale. Idempotent; safe to re-run.
#
#   bash termux/setup-thin-client.sh [--disable-local-llm] [--pc HOST]
#                                    [--force] [--dry-run]
#
# What it does:
#   1. Checks the HYDI PC is reachable over the tailnet (refuses to change
#      anything if not, unless --force).
#   2. Writes ~/.hydi/thin-client.env (OLLAMA_URL, HYDI_UPSTREAM; no secrets).
#      hydi.py and hydi-chat-server.js read it.
#   3. Patches ~/.termux/boot/start_hydi.sh, if present: backs it up, makes it
#      load thin-client.env, and replaces the hardcoded LAN IP with the PC's
#      MagicDNS name. Never deletes it.
#   4. --disable-local-llm: stops local llama-server/Ollama runit services so
#      the phone stops running inference. Nothing is uninstalled.
#
# Rollback: printed at the end (restore the .bak file, `sv up` the services).
set -euo pipefail

PC_HOST="heidi-pc.tailc50af2.ts.net"
DISABLE_LLM=0
FORCE=0
DRY=0
OLD_IP="192.168.1.100"

usage() { sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; }
while [ $# -gt 0 ]; do
  case "$1" in
    --pc) PC_HOST="${2:?--pc needs a host}"; shift 2 ;;
    --disable-local-llm) DISABLE_LLM=1; shift ;;
    --force) FORCE=1; shift ;;
    --dry-run) DRY=1; shift ;;
    -h|--help) usage; exit 0 ;;
    *) echo "unknown option: $1" >&2; usage; exit 2 ;;
  esac
done

OLLAMA_URL="${THIN_OLLAMA_URL:-https://${PC_HOST}:11434}"
HYDI_UPSTREAM="${THIN_UPSTREAM:-https://${PC_HOST}}"
ENV_DIR="$HOME/.hydi"
ENV_FILE="$ENV_DIR/thin-client.env"
BOOT="$HOME/.termux/boot/start_hydi.sh"
SVDIR="${PREFIX:-/data/data/com.termux/files/usr}/var/service"
STAMP="$(date +%Y%m%d-%H%M%S)"
MARK="# hydi-thin-client: load tailnet settings"

say()  { printf '%s\n' "$*"; }
run()  { if [ "$DRY" = 1 ]; then say "  [dry-run] $*"; else "$@"; fi; }

command -v curl >/dev/null || { say "curl is missing: pkg install -y curl"; exit 1; }

# 1. Reachability --------------------------------------------------------------
say "== Checking the HYDI PC over the tailnet ($PC_HOST)"
code() { curl -sS -o /dev/null -m 10 -w '%{http_code}' "$1" 2>/dev/null || true; }
heidi=$(code "$HYDI_UPSTREAM/heidi")
ollama=$(code "$OLLAMA_URL/api/tags")
say "  heidi-web $HYDI_UPSTREAM/heidi      -> ${heidi:-000}"
say "  ollama    $OLLAMA_URL/api/tags -> ${ollama:-000}"
if [ "${heidi:-000}" = "000" ]; then
  say ""
  say "Can't reach $PC_HOST. Open the Tailscale app on this phone and make sure"
  say "it says Connected, check the PC is on, then re-run."
  [ "$FORCE" = 1 ] || exit 3
  say "--force given: continuing anyway."
fi
if [ "${ollama:-000}" != "200" ]; then
  say "  note: PC Ollama isn't served on the tailnet yet. On the PC run:"
  say "        tailscale serve --bg --https=11434 http://127.0.0.1:11434"
  say "  hydi.py falls back to Groq/scripted replies until then."
fi

# Host from a previous run, so a re-run with a different --pc also rewrites
# the boot script (its FRANK_IP line would otherwise override the env file).
PREV_HOST=""
if [ -f "$ENV_FILE" ]; then
  PREV_HOST="$(sed -n 's/^FRANK_IP=//p' "$ENV_FILE" | tail -1)"
fi
OLD_VALUES="$OLD_IP"
if [ -n "$PREV_HOST" ] && [ "$PREV_HOST" != "$PC_HOST" ]; then
  OLD_VALUES="$OLD_IP
$PREV_HOST"
fi

# 2. Env file ------------------------------------------------------------------
say "== Writing $ENV_FILE"
if [ "$DRY" = 1 ]; then
  say "  [dry-run] OLLAMA_URL=$OLLAMA_URL"; say "  [dry-run] HYDI_UPSTREAM=$HYDI_UPSTREAM"
else
  mkdir -p "$ENV_DIR"
  tmp="$(mktemp "$ENV_DIR/.thin-client.XXXXXX")"
  {
    printf '# Written by termux/setup-thin-client.sh on %s. No secrets here.\n' "$STAMP"
    printf 'OLLAMA_URL=%s\n' "$OLLAMA_URL"
    printf 'HYDI_UPSTREAM=%s\n' "$HYDI_UPSTREAM"
    printf 'FRANK_IP=%s\n' "$PC_HOST"
  } > "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$ENV_FILE"
  say "  ok"
fi

# 3. Boot script ---------------------------------------------------------------
BOOT_BAK=""
say "== Boot script $BOOT"
if [ ! -f "$BOOT" ]; then
  say "  not present (Termux:Boot not set up) -- skipped"
else
  needs_source=1; grep -qF "$MARK" "$BOOT" && needs_source=0
  needs_ip=0
  while IFS= read -r v; do
    [ -n "$v" ] && grep -qF "$v" "$BOOT" && needs_ip=1
  done <<< "$OLD_VALUES"
  if [ "$needs_source" = 0 ] && [ "$needs_ip" = 0 ]; then
    say "  already patched"
  else
    if [ "$DRY" = 1 ]; then
      say "  [dry-run] would back up to $BOOT.bak-$STAMP"
    else
      BOOT_BAK="$BOOT.bak-$STAMP"
      cp -p "$BOOT" "$BOOT_BAK"
      say "  backup: $BOOT_BAK"
    fi
    if [ "$DRY" = 0 ]; then
      tmp="$(mktemp "$(dirname "$BOOT")/.start_hydi.XXXXXX")"
      # Values go in through ENVIRON, not -v, so awk applies no escape
      # processing; replacement is literal (index/substr), never a regex.
      TC_MARK="$MARK" \
      TC_SRC='[ -f "$HOME/.hydi/thin-client.env" ] && set -a && . "$HOME/.hydi/thin-client.env" && set +a' \
      TC_NEED="$needs_source" TC_OLDS="$OLD_VALUES" TC_HOST="$PC_HOST" awk '
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
      say "  patched: loads thin-client.env; $(printf '%s' "$OLD_VALUES" | tr '\n' ',' ) -> $PC_HOST"
    else
      say "  [dry-run] would add env loading and replace $(printf '%s' "$OLD_VALUES" | tr '\n' ',') -> $PC_HOST"
    fi
  fi
fi

# 4. Local LLM -----------------------------------------------------------------
DISABLED=()
if [ "$DISABLE_LLM" = 1 ]; then
  say "== Stopping local inference services"
  if [ -d "$SVDIR" ]; then
    for svc in "$SVDIR"/*/; do
      svc="${svc%/}"; name="$(basename "$svc")"
      [ -f "$svc/run" ] || continue
      if grep -qE 'llama-server|llama\.cpp|ollama serve' "$svc/run"; then
        run sv down "$svc" || true
        run touch "$svc/down"
        DISABLED+=("$name")
        say "  stopped + autostart off: $name"
      fi
    done
  fi
  [ ${#DISABLED[@]} -eq 0 ] && say "  no runit service runs llama-server/ollama"
  stray=$( { pgrep -ax llama-server; pgrep -ax ollama; } 2>/dev/null || true)
  if [ -n "$stray" ]; then
    say "  still running outside runit (not touched):"; say "$stray" | sed 's/^/    /'
  fi
fi

# Summary ----------------------------------------------------------------------
say ""
say "== Done"
say "  Heidi app (paired):  $HYDI_UPSTREAM/heidi"
say "  Restart HYDI here:   sv restart hydi hydi-daemon 2>/dev/null || true"
say "  Remove the Supabase service-role key from this phone (e.g. termux/.env.hydi);"
say "  the thin client doesn't need it."
say ""
say "Rollback:"
say "  rm -f $ENV_FILE"
[ -n "$BOOT_BAK" ] && say "  cp -p $BOOT_BAK $BOOT"
for name in "${DISABLED[@]}"; do say "  rm -f $SVDIR/$name/down && sv up $SVDIR/$name"; done
