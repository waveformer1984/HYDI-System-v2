#!/bin/sh
# Termux check for the phone Hydi node. POSIX sh, no npm, no sqlite.
# From the repo root: chmod +x scripts/hydi-doctor.sh && ln -sf "$PWD/scripts/hydi-doctor.sh" "$PREFIX/bin/hydi-doctor"
# Ports come from the environment, ~/.hydi/thin-client.env, termux/.env.hydi,
# $PREFIX/var/service/*/run, termux/hydi-chat-server.js, and hydi.py.
# Service definitions live in termux/services/. Install them with
# termux/install-services.sh. The live copies are under $PREFIX/var/service/.

set -u

TAB=$(printf '\t')
PORTLIST="${TMPDIR:-/tmp}/hydi-doctor-ports.$$"
: > "$PORTLIST"
trap 'rm -f "$PORTLIST" "${TMPDIR:-/tmp}/hydi-doctor-probe-hydi.$$" "${TMPDIR:-/tmp}/hydi-doctor-probe-hydi-daemon.$$"' EXIT INT TERM

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
    -e 's/.*LLAMA_PORT:-\([0-9][0-9]*\).*/\1/p' \
    -e 's/.*HYDI_PY_PORT:-\([0-9][0-9]*\).*/\1/p' \
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
HYDI_LOG_STATUS=""
DAEMON_LOG_STATUS=""
if command -v sv >/dev/null 2>&1; then
  HYDI_STATUS=$(sv status hydi 2>&1 || true)
  HYDI_LOG_STATUS=$(sv status hydi/log 2>&1 || true)
  DAEMON_STATUS=$(sv status hydi-daemon 2>&1 || true)
  DAEMON_LOG_STATUS=$(sv status hydi-daemon/log 2>&1 || true)
  say "hydi: $HYDI_STATUS"
  say "hydi/log: $HYDI_LOG_STATUS"
  say "hydi-daemon: $DAEMON_STATUS"
  say "hydi-daemon/log: $DAEMON_LOG_STATUS"
else
  say "sv: not on PATH (termux-services). Service dirs still checked under $SVDIR"
fi
backend="${HYDI_BACKEND-}"
if [ -z "$backend" ] && [ -f "$HOME/.hydi/thin-client.env" ]; then
  backend=$(sed -n 's/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}HYDI_BACKEND=//p' "$HOME/.hydi/thin-client.env" | tail -n 1 | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/^"//;s/"$//')
fi
if [ -n "$backend" ]; then
  say "HYDI_BACKEND: $backend"
else
  say "HYDI_BACKEND: unset"
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
say "== frank hosts"
# FRANK_HOSTS (comma list) or FRANK_IP, from the environment first, then
# ~/.hydi/thin-client.env — same source hydi.py reads.
env_value() {
  key=$1
  file=$2
  eval "v=\${$key:-}"
  if [ -n "$v" ]; then
    printf '%s\n' "$v"
    return 0
  fi
  [ -f "$file" ] || return 0
  sed -n "s/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}${key}=//p" "$file" |
    tail -n 1 | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/^"//;s/"$//'
}
THIN_ENV="$HOME/.hydi/thin-client.env"
FRANK_LINE=$(env_value FRANK_HOSTS "$THIN_ENV")
[ -z "$FRANK_LINE" ] && FRANK_LINE=$(env_value FRANK_IP "$THIN_ENV")
FRANK_TRIED=0
FRANK_ANY=0
FRANK_PICK=""
if [ -z "$FRANK_LINE" ]; then
  say "no FRANK_HOSTS or FRANK_IP configured"
elif ! command -v curl >/dev/null 2>&1; then
  say "curl missing; hosts were not probed"
else
  FRANK_TRIED=1
  for host in $(printf '%s' "$FRANK_LINE" | tr ',' ' '); do
    host=$(printf '%s' "$host" | sed 's|^https\{0,1\}://||;s|/.*||;s|:[0-9]*$||')
    [ -n "$host" ] || continue
    ocode=$(curl -sS -o /dev/null -m 2 -w '%{http_code}' "http://$host:11434/api/tags" 2>/dev/null || true)
    [ -n "$ocode" ] || ocode=000
    bcode=$(curl -sS -o /dev/null -m 2 -w '%{http_code}' "http://$host:3000/api/ping" 2>/dev/null || true)
    [ -n "$bcode" ] || bcode=000
    if [ "$bcode" = "000" ]; then
      bcode=$(curl -sS -o /dev/null -m 2 -w '%{http_code}' "http://$host:3000/api/board?channel=general" 2>/dev/null || true)
      [ -n "$bcode" ] || bcode=000
    fi
    say "frank $host: ollama :11434 ${ocode} / board :3000 ${bcode}"
    if [ "$ocode" != "000" ] || [ "$bcode" != "000" ]; then
      FRANK_ANY=1
      [ -z "$FRANK_PICK" ] && FRANK_PICK=$host
    fi
  done
  if [ "$FRANK_ANY" = 1 ]; then
    # hydi.py serves /api/models on its chat port; its frank_host field is the
    # host it actually resolved. Fall back to first-reachable when it is down.
    FRANK_USING=""
    if [ -n "$OPEN_PORT" ]; then
      FRANK_USING=$(curl -sS -m 3 "http://127.0.0.1:${OPEN_PORT}/api/models" 2>/dev/null |
        sed -n 's/.*"frank_host": *"\([^"]*\)".*/\1/p')
    fi
    say "hydi.py using: ${FRANK_USING:-$FRANK_PICK}"
  else
    say "hydi.py using: none reachable (offline copy)"
  fi
fi

say ""
say "== logs (last 20 lines)"
LOGROOT="${PREFIX:-/data/data/com.termux/files/usr}/var/log/sv"
log_path() {
  name=$1
  for f in \
    "$LOGROOT/$name/current" \
    "$SVDIR/$name/log/main/current" \
    "$SVDIR/$name/log/current"
  do
    if [ -f "$f" ]; then
      printf '%s\n' "$f"
      return 0
    fi
  done
  return 1
}
fast_crash() {
  status=$1
  case $status in
    *': 0s'*) ;;
    *) return 1 ;;
  esac
  case $status in
    *'want up'*) return 0 ;;
  esac
  return 1
}
probe_run() {
  name=$1
  script="$SVDIR/$name/run"
  out="${TMPDIR:-/tmp}/hydi-doctor-probe-$name.$$"
  say "--- $name (no log; ran $script for 15s) ---"
  if [ ! -f "$script" ]; then
    say "(no run script)"
    return 0
  fi
  sh "$script" > "$out" 2>&1 &
  pid=$!
  i=0
  stopped=0
  while [ "$i" -lt 15 ]; do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
    i=$((i + 1))
  done
  if kill -0 "$pid" 2>/dev/null; then
    kill "$pid" 2>/dev/null || true
    stopped=1
  fi
  ec=0
  wait "$pid" 2>/dev/null || ec=$?
  if [ -s "$out" ]; then
    tail -n 30 "$out"
  else
    say "(no output)"
  fi
  if [ "$stopped" = 1 ]; then
    say "foreground exit code: $ec (stopped after 15s)"
  else
    say "foreground exit code: $ec"
  fi
  rm -f "$out"
}
show_log() {
  name=$1
  status=$2
  path=$(log_path "$name" || true)
  if [ -n "$path" ]; then
    say "--- $name ($path) ---"
    tail -n 20 "$path" 2>/dev/null || true
    return 0
  fi
  if fast_crash "$status" && [ -f "$SVDIR/$name/run" ]; then
    probe_run "$name"
    return 0
  fi
  if [ -f "$SVDIR/$name/run" ]; then
    say "--- $name: run script present, no log file ---"
  else
    say "--- $name: no run script at $SVDIR/$name/run ---"
  fi
}
show_log hydi "$HYDI_STATUS"
show_log hydi-daemon "$DAEMON_STATUS"
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
say "== resources"
OOM=0
if command -v free >/dev/null 2>&1; then
  free -m 2>/dev/null || free
else
  say "free: not on PATH"
fi
if command -v df >/dev/null 2>&1; then
  df -h "$HOME" 2>/dev/null || df -h .
else
  say "df: not on PATH"
fi
oom_model=""
if [ -n "${HYDI_MODEL:-}" ] && [ -f "${HYDI_MODEL:-}" ]; then
  oom_model=$HYDI_MODEL
elif [ -f "$HOME/.hydi/thin-client.env" ]; then
  oom_model=$(sed -n 's/^[[:space:]]*\(export[[:space:]][[:space:]]*\)\{0,1\}HYDI_MODEL=//p' "$HOME/.hydi/thin-client.env" | tail -n 1 | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/^"//;s/"$//')
fi
if [ -z "$oom_model" ] || [ ! -f "$oom_model" ]; then
  if [ -f "$HOME/models/mistral-7b.Q4_0.gguf" ]; then
    oom_model="$HOME/models/mistral-7b.Q4_0.gguf"
  else
    oom_model=""
    oom_best=""
    oom_size=""
    for f in "$HOME/models"/*.gguf; do
      [ -f "$f" ] || continue
      sz=$(ls -ln "$f" 2>/dev/null | awk '{print $5}')
      [ -n "$sz" ] || continue
      if [ -z "$oom_best" ] || [ "$sz" -lt "$oom_size" ]; then
        oom_best=$f
        oom_size=$sz
      fi
    done
    oom_model=$oom_best
  fi
fi
if [ -n "$oom_model" ] && [ -f "$oom_model" ] && command -v free >/dev/null 2>&1; then
  model_bytes=$(ls -ln "$oom_model" 2>/dev/null | awk '{print $5}')
  mem_total=$(free -m 2>/dev/null | awk '/Mem:/ { print $2; exit }')
  mem_avail=$(free -m 2>/dev/null | awk '/Mem:/ { if (NF>=7) print $7; else print $4; exit }')
  if [ -z "$mem_total" ]; then
    mem_total=$(free 2>/dev/null | awk '/Mem:/ { print $2; exit }')
    mem_avail=$(free 2>/dev/null | awk '/Mem:/ { if (NF>=7) print $7; else print $4; exit }')
    if [ -n "$mem_total" ] && [ "$mem_total" -gt 200000 ]; then
      mem_avail=$((mem_avail / 1024))
    fi
  fi
  if [ -n "$model_bytes" ] && [ -n "$mem_avail" ]; then
    model_mib=$((model_bytes / 1048576))
    if [ "$mem_avail" -lt "$model_mib" ]; then
      OOM=1
      say "possible OOM: $oom_model is ${model_mib} MiB and available RAM is ${mem_avail} MiB"
    fi
  fi
fi

say ""
if [ "$OOM" = 1 ] && [ "$HYDI_STATE" = "crash" ]; then
  say "NEXT STEP: possible OOM — free RAM is smaller than the model file; see log above"
elif [ "$HYDI_STATE" = "crash" ] || [ "$DAEMON_STATE" = "crash" ]; then
  say "NEXT STEP: service crash-looping, see log above"
elif [ "$FRANK_TRIED" = 1 ] && [ "$FRANK_ANY" = 0 ]; then
  say "NEXT STEP: join home Wi-Fi or turn on Tailscale"
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
