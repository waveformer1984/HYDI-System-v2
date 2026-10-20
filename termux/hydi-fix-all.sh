#!/bin/sh
# One idempotent pass for the Termux phone node.
# hydi.py reads OLLAMA_URL from the environment (hydi.py:152), after
# ~/.hydi/thin-client.env fills any variable that is not already set
# (hydi.py:28-44). This script writes OLLAMA_URL. It does not add a new
# model-URL variable.
# HYDI_FIX_WAIT_SECS overrides the 20s pause before hydi-doctor (default 20).
set -u

say() { printf '%s\n' "$*"; }

src=$0
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
root=$(CDPATH= cd -- "$(dirname "$src")/.." && pwd)
prefix="${PREFIX:-/data/data/com.termux/files/usr}"
svdir="$prefix/var/service"
env_file="$HOME/.hydi/thin-client.env"
wait_secs="${HYDI_FIX_WAIT_SECS:-20}"
verdict="incomplete"
mode=""

env_val() {
  key=$1
  [ -f "$env_file" ] || return 0
  sed -n "s/^[[:space:]]*\\(export[[:space:]][[:space:]]*\\)\\{0,1\\}${key}=//p" "$env_file" |
    tail -n 1 | tr -d '\r' |
    sed 's/^[[:space:]]*//;s/[[:space:]]*$//;s/^"//;s/"$//;s/^'"'"'//;s/'"'"'$//'
}

upsert_env() {
  key=$1
  val=$2
  mkdir -p "$HOME/.hydi"
  tmp="$HOME/.hydi/.thin-client.$$"
  if [ -f "$env_file" ]; then
    grep -v "^${key}=" "$env_file" | grep -v "^export ${key}=" > "$tmp" || true
  else
    printf '%s\n' '# Phone node settings. No secrets.' > "$tmp"
  fi
  printf '%s=%s\n' "$key" "$val" >> "$tmp"
  chmod 600 "$tmp"
  mv -f "$tmp" "$env_file"
}

# --- a. wake lock -----------------------------------------------------------
say "== wake-lock"
if command -v termux-wake-lock >/dev/null 2>&1; then
  termux-wake-lock >/dev/null 2>&1 || say "termux-wake-lock returned non-zero"
  say "termux-wake-lock ran"
else
  say "termux-wake-lock is not on PATH"
fi

# --- b. orphans on the hydi.py / llama-server ports -------------------------
say "== port conflicts"
ancestor_is_runsv() {
  cur=$1
  n=0
  while [ "$n" -lt 15 ] && [ -n "$cur" ] && [ "$cur" != 0 ] && [ "$cur" != 1 ]; do
    if [ ! -r "/proc/$cur/cmdline" ]; then
      return 1
    fi
    cmd=$(tr '\0' ' ' < "/proc/$cur/cmdline" 2>/dev/null || true)
    case $cmd in
      *runsv*) return 0 ;;
    esac
    if [ ! -r "/proc/$cur/status" ]; then
      return 1
    fi
    cur=$(awk '/^PPid:/ { print $2; exit }' "/proc/$cur/status" 2>/dev/null || true)
    n=$((n + 1))
  done
  return 1
}

kill_orphans() {
  label=$1
  pattern=$2
  if ! command -v pgrep >/dev/null 2>&1; then
    say "pgrep is not on PATH; $label not checked"
    return 0
  fi
  hits="${TMPDIR:-/tmp}/hydi-fix-pgrep.$$"
  pgrep -af "$pattern" > "$hits" 2>/dev/null || true
  while IFS= read -r line; do
    pid=${line%% *}
    case $pid in
      ''|*[!0-9]*) continue ;;
    esac
    [ "$pid" = "$$" ] && continue
    case $line in
      *pgrep*) continue ;;
      *hydi-fix-all*) continue ;;
    esac
    if ancestor_is_runsv "$pid"; then
      printf 'kept (runsv child) %s: %s\n' "$label" "$line"
    else
      printf 'killing %s: %s\n' "$label" "$line"
      kill "$pid" 2>/dev/null || printf 'kill failed %s: %s\n' "$label" "$pid"
      sleep 1
      if kill -0 "$pid" 2>/dev/null; then
        state=$(awk '/^State:/ { print $2; exit }' "/proc/$pid/status" 2>/dev/null || true)
        case $state in
          Z) ;;
          *)
            kill -9 "$pid" 2>/dev/null || true
            printf 'killed -9 %s: %s\n' "$label" "$pid"
            ;;
        esac
      fi
    fi
  done < "$hits"
  rm -f "$hits"
  return 0
}

kill_orphans "3006 hydi.py" "hydi.py"
kill_orphans "8080 llama-server" "llama-server"

# --- c. respawn runsv so a newly added log/ service gets a supervisor -------
say "== runsv"
if command -v pkill >/dev/null 2>&1; then
  pkill -f 'runsv hydi' >/dev/null 2>&1 || true
  say "signaled runsv hydi and runsv hydi-daemon (runsvdir respawns them)"
else
  say "pkill is not on PATH; runsv was not restarted"
fi
sleep 1
n=0
logs_up=0
while [ "$n" -lt 20 ]; do
  if ! command -v sv >/dev/null 2>&1; then
    say "sv is not on PATH"
    break
  fi
  hlog=$(sv status hydi/log 2>&1 || true)
  dlog=$(sv status hydi-daemon/log 2>&1 || true)
  case $hlog in
    *'run:'*) hok=1 ;;
    *) hok=0 ;;
  esac
  case $dlog in
    *'run:'*) dok=1 ;;
    *) dok=0 ;;
  esac
  if [ "$hok" = 1 ] && [ "$dok" = 1 ]; then
    logs_up=1
    break
  fi
  sleep 1
  n=$((n + 1))
done
if command -v sv >/dev/null 2>&1; then
  say "hydi/log: $(sv status hydi/log 2>&1 || true)"
  say "hydi-daemon/log: $(sv status hydi-daemon/log 2>&1 || true)"
fi
if [ "$logs_up" != 1 ]; then
  say "log subservices are not both running yet"
fi

# --- d. storage report; caches only, and only after y/N --------------------
say "== storage"
du_top() {
  base=$1
  [ -d "$base" ] || return 0
  tmp="${TMPDIR:-/tmp}/hydi-fix-du.$$"
  : > "$tmp"
  for item in "$base"/* "$base"/.[!.]*; do
    [ -e "$item" ] || [ -L "$item" ] || continue
    if [ -L "$item" ]; then
      printf 'symlink %s\n' "$item"
      continue
    fi
    kb=$(du -sk "$item" 2>/dev/null | awk '{print $1; exit}')
    [ -n "$kb" ] || continue
    printf '%s %s\n' "$kb" "$item" >> "$tmp"
  done
  if [ -s "$tmp" ]; then
    sort -n "$tmp" | tail -n 15
  fi
  rm -f "$tmp"
}
say "-- largest under ~ (KiB, 15 biggest) --"
du_top "$HOME"
shared="$HOME/storage/shared"
if [ -d "$shared" ] && [ -r "$shared" ]; then
  say "-- largest under ~/storage/shared (KiB, 15 biggest) --"
  du_top "$shared"
elif [ -e "$shared" ]; then
  say "~/storage/shared is not readable"
else
  say "~/storage/shared is not present"
fi

say "-- gguf files --"
gguf_found=0
if [ -d "$HOME" ]; then
  find "$HOME" -xdev -type f -name '*.gguf' 2>/dev/null | while IFS= read -r f; do
    sz=$(ls -ln "$f" 2>/dev/null | awk '{print $5; exit}')
    printf '%s bytes %s\n' "${sz:-?}" "$f"
  done
fi
if [ -d "$shared" ] && [ -r "$shared" ]; then
  find "$shared" -xdev -type f -name '*.gguf' 2>/dev/null | while IFS= read -r f; do
    sz=$(ls -ln "$f" 2>/dev/null | awk '{print $5; exit}')
    printf '%s bytes %s\n' "${sz:-?}" "$f"
  done
fi

say "-- caches and build leftovers (not deleted) --"
for d in "$HOME/.cache/pip" "$HOME/.npm" "$prefix/var/cache/apt" "$HOME/llama.cpp/build"; do
  if [ -d "$d" ]; then
    kb=$(du -sk "$d" 2>/dev/null | awk '{print $1; exit}')
    printf '%s KiB %s\n' "${kb:-?}" "$d"
  fi
done
if [ -d "$svdir" ]; then
  find "$svdir" -type f -name 'run.bak-*' 2>/dev/null | while IFS= read -r f; do
    sz=$(ls -ln "$f" 2>/dev/null | awk '{print $5; exit}')
    printf '%s bytes %s\n' "${sz:-?}" "$f"
  done
fi

say "-- safe cleanup commands (caches only) --"
say "pip cache purge"
say "npm cache clean --force"
say "apt clean"
ans=N
if [ -t 0 ]; then
  printf 'Run those three cache cleans now? [y/N] '
  read ans || ans=N
fi
case $ans in
  y|Y)
    if command -v pip >/dev/null 2>&1; then
      pip cache purge || say "pip cache purge failed"
    else
      say "pip is not on PATH"
    fi
    if command -v npm >/dev/null 2>&1; then
      npm cache clean --force || say "npm cache clean failed"
    else
      say "npm is not on PATH"
    fi
    if command -v apt >/dev/null 2>&1; then
      apt clean || say "apt clean failed"
    else
      say "apt is not on PATH"
    fi
    ;;
  *) say "cache cleans skipped" ;;
esac

# --- e. thin client to Frank, or a small local GGUF ------------------------
say "== backend"
frank="${FRANK_IP-}"
if [ -z "$frank" ]; then
  frank=$(env_val FRANK_IP)
fi
case $frank in
  *[!A-Za-z0-9.:-]*)
    say "FRANK_IP has unexpected characters; ignoring it"
    frank=""
    ;;
esac

free_kib=$(df -kP "$HOME" 2>/dev/null | awk 'NR==2 { print $4; exit }')
thin=0
if [ -n "$frank" ] && command -v curl >/dev/null 2>&1; then
  if curl -s --max-time 3 "http://${frank}:11434/api/tags" >/dev/null 2>&1; then
    thin=1
  else
    say "Frank at $frank:11434 did not answer /api/tags"
  fi
elif [ -n "$frank" ]; then
  say "curl is not on PATH; cannot check Frank"
fi

if [ "$thin" = 1 ]; then
  mode=frank
  upsert_env HYDI_BACKEND frank
  upsert_env OLLAMA_URL "http://${frank}:11434"
  say "THIN: OLLAMA_URL=http://${frank}:11434 (hydi.py:152, loaded from thin-client.env at hydi.py:28-44)"
  if command -v sv >/dev/null 2>&1; then
    sv down hydi || true
  fi
  mkdir -p "$svdir/hydi"
  touch "$svdir/hydi/down"
  say "local llama.cpp left down"
else
  mode=local
  cap=1610612736
  best=""
  best_sz=0
  if [ -d "$HOME/models" ]; then
    find "$HOME/models" -type f -name '*.gguf' 2>/dev/null | while IFS= read -r f; do
      printf '%s\n' "$f"
    done > "${TMPDIR:-/tmp}/hydi-fix-gguf.$$"
    while IFS= read -r f; do
      [ -n "$f" ] || continue
      sz=$(ls -ln "$f" 2>/dev/null | awk '{print $5; exit}')
      case $sz in
        ''|*[!0-9]*) continue ;;
      esac
      if [ "$sz" -lt "$cap" ]; then
        if [ -z "$best" ] || [ "$sz" -gt "$best_sz" ]; then
          best=$f
          best_sz=$sz
        fi
      fi
    done < "${TMPDIR:-/tmp}/hydi-fix-gguf.$$"
    rm -f "${TMPDIR:-/tmp}/hydi-fix-gguf.$$"
  fi
  if [ -n "$best" ]; then
    upsert_env HYDI_BACKEND local
    upsert_env HYDI_MODEL "$best"
    rm -f "$svdir/hydi/down"
    say "LOCAL: HYDI_MODEL=$best (${best_sz} bytes, under 1.5 GiB)"
  else
    need_kib=2621440
    if [ -z "$free_kib" ]; then
      say "could not read free space; not downloading"
      verdict="free space unknown"
      say "VERDICT: $verdict"
      exit 2
    fi
    if [ "$free_kib" -ge "$need_kib" ]; then
      say "No GGUF under 1.5 GiB in ~/models. Free space is enough for a ~1.1 GiB Q4_K_M 1.5B. Not downloading."
      say "curl -L --fail --output $HOME/models/qwen2.5-1.5b-instruct-q4_k_m.gguf https://huggingface.co/Qwen/Qwen2.5-1.5B-Instruct-GGUF/resolve/main/qwen2.5-1.5b-instruct-q4_k_m.gguf"
      verdict="no small model yet; curl command printed, not run"
      say "VERDICT: $verdict"
      exit 0
    fi
    say "free space first"
    verdict="free space first"
    say "VERDICT: $verdict"
    exit 2
  fi
fi

# --- f. restart, doctor, verdict --------------------------------------------
# In THIN mode hydi stays down. Restarting it would launch llama-server.
say "== restart"
if command -v sv >/dev/null 2>&1; then
  if [ "$mode" = "frank" ]; then
    sv down hydi || true
    sv restart hydi-daemon || true
  else
    sv restart hydi hydi-daemon || true
  fi
else
  say "sv is not on PATH"
fi
say "waiting ${wait_secs}s"
sleep "$wait_secs"
if [ -f "$root/scripts/hydi-doctor.sh" ]; then
  sh "$root/scripts/hydi-doctor.sh" || true
else
  say "scripts/hydi-doctor.sh is missing"
fi
if [ "$mode" = "frank" ]; then
  verdict="THIN frank at ${frank}:11434; local hydi is down; hydi.py uses OLLAMA_URL"
else
  verdict="LOCAL model $(env_val HYDI_MODEL)"
fi
say "VERDICT: $verdict"
