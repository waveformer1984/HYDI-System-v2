#!/bin/sh
# Phase 0 ground-truth audit for the Termux phone edge node.
# POSIX sh — no heredocs. Run on the phone:
#   cd ~/HYDI-System-v2 && sh termux/phone-audit-phase0.sh
# Optional: sh termux/phone-audit-phase0.sh > ~/hydi/logs/phone-audit-$(date +%Y%m%d-%H%M%S).txt
set -u

TAB=$(printf '\t')
say() { printf '%s\n' "$*"; }

AUDIT_TS=$(date -u +%Y-%m-%dT%H:%M:%SZ 2>/dev/null || date)
REPO=""
for d in "$HOME/HYDI-System-v2" "$PWD"; do
  if [ -f "$d/termux/phone-audit-phase0.sh" ]; then
    REPO=$(CDPATH= cd -- "$d" && pwd)
    break
  fi
done

if [ -n "${PREFIX:-}" ]; then
  SVDIR="$PREFIX/var/service"
else
  SVDIR="/data/data/com.termux/files/usr/var/service"
fi

probe_http() {
  port=$1
  path=$2
  if ! command -v curl >/dev/null 2>&1; then
    printf 'curl_missing\t%s\n' "$port"
    return 0
  fi
  code=$(curl -sS -o /dev/null -m 2 -w '%{http_code}' "http://127.0.0.1:${port}${path}" 2>/dev/null || true)
  [ -n "$code" ] || code=000
  listener=0
  if command -v ss >/dev/null 2>&1; then
    if ss -ltn 2>/dev/null | grep -q ":${port} "; then
      listener=1
    fi
  elif command -v netstat >/dev/null 2>&1; then
    if netstat -ltn 2>/dev/null | grep -q ":${port} "; then
      listener=1
    fi
  fi
  printf '%s\tlisten=%s\thttp=%s\n' "$port" "$listener" "$code"
}

say "== PHONE AUDIT Phase 0 =="
say "timestamp_utc: $AUDIT_TS"
say "repo: ${REPO:-not_found}"
say "home: $HOME"
say "prefix: ${PREFIX:-unset}"
say ""

say "== termux-services ($SVDIR)"
if [ -d "$SVDIR" ]; then
  for ent in "$SVDIR"/*; do
    [ -e "$ent" ] || continue
    name=$(basename "$ent")
    runf="$ent/run"
    downf="$ent/down"
    runlink=""
    if [ -e "$runf" ]; then
      if [ -L "$runf" ]; then
        runlink=$(readlink "$runf" 2>/dev/null || true)
      fi
    fi
    st=""
    if command -v sv >/dev/null 2>&1; then
      st=$(sv status "$name" 2>&1 || true)
    fi
    down=0
    [ -f "$downf" ] && down=1
    say "service: $name down_file=$down sv=${st:-nosv} run=${runf:-missing} target=${runlink}"
  done
else
  say "(no $SVDIR directory)"
fi
say ""

say "== ports (8080 5056 3006 8765 8767 8766 11434)"
for p in 8080 5056 3006 8765 8767 8766 11434; do
  case $p in
    11434) probe_http "$p" "/api/tags" ;;
    3006) probe_http "$p" "/api/health" ;;
    8080) probe_http "$p" "/" ;;
    *) probe_http "$p" "/" ;;
  esac | while IFS= read -r line; do say "port $line"; done
done
say ""

say "== inference processes"
ps -A 2>/dev/null | grep -E '[o]llama|[l]lama-server|[l]lama-cli' || say "(no ollama/llama-server in ps)"
if command -v ollama >/dev/null 2>&1; then
  say "--- ollama list (head) ---"
  ollama list 2>/dev/null | head -n 10 || say "ollama list failed"
else
  say "ollama CLI: not on PATH"
fi
if [ -d "$HOME/models" ]; then
  say "--- ~/models ---"
  ls -ln "$HOME/models" 2>/dev/null | head -n 20 || true
else
  say "~/models: missing"
fi
say ""

say "== RAM"
if command -v free >/dev/null 2>&1; then
  free -m 2>/dev/null || free
else
  say "free: not on PATH"
fi
say ""

say "== termux-wake-lock"
if command -v termux-wake-lock >/dev/null 2>&1; then
  say "termux-wake-lock: on PATH"
else
  say "termux-wake-lock: not on PATH"
fi
if [ -r /sys/power/wake_lock ]; then
  say "wake_lock: $(cat /sys/power/wake_lock 2>/dev/null || echo unreadable)"
else
  say "wake_lock: not readable"
fi
say ""

say "== Termux:Boot"
BOOT_DIR="$HOME/.termux/boot"
if [ -d "$BOOT_DIR" ]; then
  say "boot_dir: $BOOT_DIR"
  for f in "$BOOT_DIR"/*; do
    [ -e "$f" ] || continue
  say "  $(basename "$f") size=$(wc -c <"$f" 2>/dev/null || echo 0)"
  done
else
  say "boot_dir: missing ($BOOT_DIR)"
fi
if command -v pm >/dev/null 2>&1; then
  pm list packages 2>/dev/null | grep -i termux.boot || say "com.termux.boot package: not installed (pm)"
elif command -v termux-boot >/dev/null 2>&1; then
  say "termux-boot helper: present"
else
  say "Termux:Boot install state: unknown (no pm/termux-boot)"
fi
say ""

say "== ~/hydi inventory"
HYDI_HOME="$HOME/hydi"
EXPECTED="hydi.py server.py hydi_event_hub.py hydi_bridge.py hydi_guard.py hydi_mobile.py mesh_client.py ursula_event_bridge.py start_hydi.sh"
mkdir -p "$HOME/hydi/logs" 2>/dev/null || true
if [ -d "$HYDI_HOME" ]; then
  say "hydi_home: $HYDI_HOME"
  for f in $EXPECTED; do
    fp="$HYDI_HOME/$f"
    if [ -f "$fp" ]; then
      sz=$(wc -c <"$fp" 2>/dev/null || echo 0)
      ex=0
      [ -x "$fp" ] && ex=1
      say "  $f present bytes=$sz executable=$ex"
    else
      say "  $f absent"
    fi
  done
  say "--- other files in ~/hydi (max 40) ---"
  ls -1 "$HYDI_HOME" 2>/dev/null | head -n 40 | while IFS= read -r n; do say "  $n"; done
  say "--- backup-like names ---"
  ls -1 "$HYDI_HOME" 2>/dev/null | grep -iE 'backup|pre-knowledge|\.bak|\.old' || say "  (none)"
else
  say "hydi_home: missing"
fi
say ""

say "== repo hydi.py vs ~/hydi/hydi.py"
if [ -f "$REPO/hydi.py" ]; then
  say "repo hydi.py: $REPO/hydi.py"
fi
if [ -f "$HYDI_HOME/hydi.py" ] && [ -f "$REPO/hydi.py" ]; then
  if cmp -s "$HYDI_HOME/hydi.py" "$REPO/hydi.py" 2>/dev/null; then
    say "hydi.py: identical repo vs ~/hydi"
  else
    say "hydi.py: differs (~/hydi may be stale copy from setup.sh)"
  fi
fi
if [ -f "$SVDIR/hydi-daemon/run" ]; then
  say "hydi-daemon run references:"
  grep -E 'hydi\.py|HYDI' "$SVDIR/hydi-daemon/run" 2>/dev/null | head -n 5 || true
fi
say ""

say "== frank connectivity"
for envf in "$HOME/.hydi/thin-client.env" "$HOME/.hydi.env" "$HOME/.termux/boot/start_hydi.sh"; do
  if [ -f "$envf" ]; then
    say "--- $envf ---"
    grep -E '^(export[[:space:]]+)?FRANK_|192\.168\.1\.100' "$envf" 2>/dev/null || say "  (no FRANK_* / 192.168.1.100 lines)"
  else
    say "$envf: missing"
  fi
done
FRANK_IP_VAL=""
if [ -f "$HOME/.hydi/thin-client.env" ]; then
  FRANK_IP_VAL=$(sed -n 's/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}FRANK_IP=//p' "$HOME/.hydi/thin-client.env" | tail -n 1 | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/^"//;s/"$//')
fi
if [ -n "${FRANK_IP:-}" ]; then
  FRANK_IP_VAL="${FRANK_IP:-$FRANK_IP_VAL}"
fi
if [ -n "$FRANK_IP_VAL" ] && command -v curl >/dev/null 2>&1; then
  host=$(printf '%s' "$FRANK_IP_VAL" | sed 's|^https\{0,1\}://||;s|/.*||;s|:[0-9]*$||')
  ocode=$(curl -sS -o /dev/null -m 3 -w '%{http_code}' "http://$host:11434/api/tags" 2>/dev/null || true)
  [ -n "$ocode" ] || ocode=000
  say "probe FRANK_IP $host:11434/api/tags -> HTTP $ocode"
else
  say "FRANK_IP probe: skipped (unset or no curl)"
fi
say ""

say "== phantom-process killer (device setting)"
if command -v settings >/dev/null 2>&1; then
  ph=$(settings get global settings_enable_monitor_phantom_procs 2>/dev/null || true)
  say "settings_enable_monitor_phantom_procs=${ph:-unknown}"
else
  say "settings CLI: not available in Termux (use adb from Frank; see scripts/termux/README.md)"
fi
say ""

say "== hydi-doctor (if repo present)"
if [ -n "$REPO" ] && [ -f "$REPO/scripts/hydi-doctor.sh" ]; then
  sh "$REPO/scripts/hydi-doctor.sh" 2>&1 | tail -n 40
else
  say "skipped"
fi
say ""
say "== end Phase 0 audit =="
