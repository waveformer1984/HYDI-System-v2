#!/bin/sh
# Termux check for the phone Hydi node. POSIX sh, no npm, no sqlite.
# From the repo root: chmod +x scripts/hydi-doctor.sh && ln -sf "$PWD/scripts/hydi-doctor.sh" "$PREFIX/bin/hydi-doctor"
# Ports come from the environment, ~/.hydi/thin-client.env, termux/.env.hydi,
# $PREFIX/var/service/*/run, termux/hydi-chat-server.js, and hydi.py.
# The run scripts themselves are created on the phone, not in this repo.

set -u

TAB=$(printf '\t')
PORTLIST="${TMPDIR:-/tmp}/hydi-doctor-ports.$$"
: > "$PORTLIST"
trap 'rm -f "$PORTLIST"' EXIT INT TERM

say() { printf '%s\n' "$*"; }

resolve_source() {
  src=$1
  i=0
  while [ -L "$src" ] && [ "$i" -lt 10 ]; do
    dir=$(dirname "$src")
    link=$(readlink "$src" 2>/dev/null) || break
    case $link in
      /*) src=$link ;;
      *) src="$dir/$link" ;;
    esac
    i=$((i + 1))
  done
  printf '%s\n' "$src"
}

ROOT=""
SRC=$(resolve_source "$0")
BASE=$(dirname "$SRC")
if [ -f "$BASE/../termux/hydi-chat-server.js" ]; then
  ROOT=$(CDPATH= cd -- "$BASE/.." && pwd)
elif [ -f "$PWD/termux/hydi-chat-server.js" ]; then
  ROOT=$(CDPATH= cd -- "$PWD" && pwd)
elif [ -f "$HOME/HYDI-System-v2/termux/hydi-chat-server.js" ]; then
  ROOT="$HOME/HYDI-System-v2"
fi

if [ -n "${PREFIX:-}" ]; then
  SVDIR="$PREFIX/var/service"
else
  SVDIR="/data/data/com.termux/files/usr/var/service"
fi

add_port() {
  label=$1
  port=$2
  case $port in
    ''|*[!0-9]*) return 0 ;;
  esac
  port=$(printf '%s' "$port" | sed 's/^0*//')
  [ -n "$port" ] || return 0
  if [ "$port" -lt 1 ] || [ "$port" -gt 65535 ]; then
    return 0
  fi
  if grep -q "^${port}${TAB}" "$PORTLIST" 2>/dev/null; then
    return 0
  fi
  printf '%s%s%s\n' "$port" "$TAB" "$label" >> "$PORTLIST"
}

ports_from_assignments() {
  file=$1
  label=$2
  [ -f "$file" ] || return 0
  sed -n 's/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}PORT[[:space:]]*=[[:space:]]*["'\'']\{0,1\}\([0-9][0-9]*\).*/\2/p' "$file" |
    while IFS= read -r p; do
      add_port "$label" "$p"
    done
}

ports_from_run() {
  file=$1
  label=$2
  [ -f "$file" ] || return 0
  ports_from_assignments "$file" "$label"
  sed -n \
    -e 's/.*--port[=[:space:]]\{1,\}\([0-9][0-9]*\).*/\1/p' \
    -e 's/.*[[:space:]]-p[[:space:]]\{1,\}\([0-9][0-9]*\).*/\1/p' \
    -e 's/.*hydi\.py[[:space:]][[:space:]]*server[[:space:]][[:space:]]*\([0-9][0-9]*\).*/\1/p' \
    "$file" | while IFS= read -r p; do
      add_port "$label" "$p"
    done
}

if [ -n "${PORT:-}" ]; then
  add_port "env PORT" "$PORT"
fi
ports_from_assignments "$HOME/.hydi/thin-client.env" "thin-client.env"
if [ -n "$ROOT" ]; then
  ports_from_assignments "$ROOT/termux/.env.hydi" "termux/.env.hydi"
  if [ -f "$ROOT/termux/hydi-chat-server.js" ]; then
    sed -n 's/.*process\.env\.PORT[[:space:]]*||[[:space:]]*['\''"]\([0-9][0-9]*\)['\''"].*/\1/p' \
      "$ROOT/termux/hydi-chat-server.js" | while IFS= read -r p; do
        add_port "hydi-chat-server.js" "$p"
      done
  fi
  ports_from_assignments "$ROOT/termux/setup-termux-chat.sh" "setup-termux-chat.sh"
  if [ -f "$ROOT/hydi.py" ]; then
    sed -n \
      -e 's/.*start_server(port=\([0-9][0-9]*\).*/\1/p' \
      -e 's/.*args\[1\].*else \([0-9][0-9]*\).*/\1/p' \
      "$ROOT/hydi.py" | while IFS= read -r p; do
        add_port "hydi.py" "$p"
      done
  fi
fi
ports_from_assignments "$HOME/.termux/boot/start_hydi.sh" "start_hydi.sh"
ports_from_run "$SVDIR/hydi/run" "hydi/run"
ports_from_run "$SVDIR/hydi-daemon/run" "hydi-daemon/run"

say "== sv status"
HYDI_STATUS=""
DAEMON_STATUS=""
if command -v sv >/dev/null 2>&1; then
  HYDI_STATUS=$(sv status hydi 2>&1 || true)
  DAEMON_STATUS=$(sv status hydi-daemon 2>&1 || true)
  say "$HYDI_STATUS"
  say "$DAEMON_STATUS"
else
  say "sv: not on PATH (termux-services). Service dirs still checked under $SVDIR"
fi

classify() {
  line=$1
  case $line in
    *'run:'*) printf 'up\n' ;;
    *'normally up'*|*'want up'*|*'timeout'*|*'finish:'*) printf 'crash\n' ;;
    *'down:'*) printf 'down\n' ;;
    *'unable'*|*'no such'*|*'does not exist'*|*'fail:'*) printf 'missing\n' ;;
    '') printf 'unknown\n' ;;
    *) printf 'unknown\n' ;;
  esac
}

HYDI_STATE=$(classify "$HYDI_STATUS")
DAEMON_STATE=$(classify "$DAEMON_STATUS")
if ! command -v sv >/dev/null 2>&1; then
  HYDI_STATE=nosv
  DAEMON_STATE=nosv
fi

say ""
say "== ports (localhost)"
OPEN_PORT=""
CONF_PORT=""
RUN_PORT=""
PY_PORT=""
ANY_CHECKED=0
if ! command -v curl >/dev/null 2>&1; then
  say "curl: not on PATH (pkg install curl). Ports were not probed."
else
  if [ ! -s "$PORTLIST" ]; then
    say "no port found in env, service run scripts, or the repo"
  fi
  while IFS="$TAB" read -r port label; do
    [ -n "$port" ] || continue
    ANY_CHECKED=1
    code=$(curl -sS -o /dev/null -m 3 -w '%{http_code}' "http://127.0.0.1:${port}/" 2>/dev/null || true)
    [ -n "$code" ] || code=000
    if [ "$code" != "000" ]; then
      say "port $port ($label): listening HTTP $code"
      case $label in
        hydi.py) PY_PORT=$port ;;
        hydi/run|hydi-daemon/run) [ -z "$RUN_PORT" ] && RUN_PORT=$port ;;
        "env PORT"|thin-client.env|termux/.env.hydi|start_hydi.sh)
          [ -z "$CONF_PORT" ] && CONF_PORT=$port ;;
        *) [ -z "$OPEN_PORT" ] && OPEN_PORT=$port ;;
      esac
    else
      say "port $port ($label): not listening"
    fi
  done < "$PORTLIST"
fi
if [ -n "$RUN_PORT" ]; then
  OPEN_PORT=$RUN_PORT
elif [ -n "$CONF_PORT" ]; then
  OPEN_PORT=$CONF_PORT
elif [ -z "$OPEN_PORT" ]; then
  OPEN_PORT=$PY_PORT
fi

say ""
say "== logs (last 20 lines)"
show_log() {
  name=$1
  shown=0
  for f in \
    "$SVDIR/$name/log/main/current" \
    "$SVDIR/$name/log/current"
  do
    if [ -f "$f" ]; then
      say "--- $name ($f) ---"
      tail -n 20 "$f" 2>/dev/null || true
      shown=1
      break
    fi
  done
  if [ "$shown" = 0 ]; then
    if [ -f "$SVDIR/$name/run" ]; then
      say "--- $name: run script present, no log file ---"
    else
      say "--- $name: no run script at $SVDIR/$name/run (not created by this repo) ---"
    fi
  fi
}
show_log hydi
show_log hydi-daemon
if [ -n "$ROOT" ] && [ -f "$ROOT/termux/hydi-chat.log" ]; then
  say "--- termux/hydi-chat.log ---"
  tail -n 20 "$ROOT/termux/hydi-chat.log" 2>/dev/null || true
fi

say ""
say "== wake-lock"
WAKE=unknown
if ! command -v termux-wake-lock >/dev/null 2>&1; then
  say "wake-lock: not detectable (termux-wake-lock is not on PATH)"
elif [ -r /sys/power/wake_lock ]; then
  locks=$(cat /sys/power/wake_lock 2>/dev/null || true)
  case $locks in
    *[Tt]ermux*)
      say "wake-lock: held ($locks)"
      WAKE=held
      ;;
    '')
      say "wake-lock: not held (/sys/power/wake_lock is empty)"
      WAKE=free
      ;;
    *)
      say "wake-lock: not held (no Termux entry in /sys/power/wake_lock)"
      WAKE=free
      ;;
  esac
elif ps -A 2>/dev/null | grep -q '[t]ermux-wake-lock'; then
  say "wake-lock: held (termux-wake-lock process is running)"
  WAKE=held
else
  say "wake-lock: not detectable (installed, but /sys/power/wake_lock is not readable and no lock process is running)"
fi

say ""
if [ "$HYDI_STATE" = "crash" ] || [ "$DAEMON_STATE" = "crash" ]; then
  say "NEXT STEP: service crash-looping, see log above"
elif [ -n "$OPEN_PORT" ]; then
  say "NEXT STEP: open http://127.0.0.1:${OPEN_PORT} in Chrome"
elif ! command -v curl >/dev/null 2>&1; then
  say "NEXT STEP: pkg install curl, then run hydi-doctor again"
elif [ "$HYDI_STATE" = "down" ] || [ "$HYDI_STATE" = "missing" ] || [ "$HYDI_STATE" = "unknown" ]; then
  say "NEXT STEP: run sv up hydi"
elif [ "$DAEMON_STATE" = "down" ] || [ "$DAEMON_STATE" = "missing" ]; then
  say "NEXT STEP: run sv up hydi-daemon"
elif [ "$HYDI_STATE" = "nosv" ]; then
  say "NEXT STEP: pkg install termux-services, then run sv up hydi"
elif [ "$ANY_CHECKED" = 1 ]; then
  say "NEXT STEP: service is up but nothing answered on localhost; see log above"
else
  say "NEXT STEP: repo checkout not found, so no chat port could be read"
fi
