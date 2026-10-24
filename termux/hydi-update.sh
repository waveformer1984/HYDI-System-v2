#!/bin/sh
# Fast-forward the phone checkout, restart enabled HYDI services, and diagnose.
# POSIX sh; suitable for installation as $PREFIX/bin/hydi-update.

set -u

WAKE_LOCKED=0
SERVICES_RESTARTED=0

release_wake_lock() {
  if [ "$WAKE_LOCKED" -eq 1 ] && command -v termux-wake-unlock >/dev/null 2>&1; then
    termux-wake-unlock >/dev/null 2>&1 || true
  fi
  WAKE_LOCKED=0
}

finish_failed() {
  reason=$1
  if [ "$SERVICES_RESTARTED" -eq 0 ]; then
    release_wake_lock
  fi
  printf 'UPDATE FAILED: %s\n' "$reason"
  exit 1
}

trap 'finish_failed "interrupted"' HUP INT TERM

if ! command -v termux-wake-lock >/dev/null 2>&1; then
  finish_failed "termux-wake-lock is unavailable (install Termux:API)"
fi
if ! termux-wake-lock >/dev/null 2>&1; then
  finish_failed "termux-wake-lock failed"
fi
WAKE_LOCKED=1

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
base=$(CDPATH= cd -- "$(dirname "$src")" 2>/dev/null && pwd) ||
  finish_failed "cannot resolve script directory"
root=$(CDPATH= cd -- "$base/.." 2>/dev/null && pwd) ||
  finish_failed "cannot resolve repository"

if ! git -C "$root" rev-parse --is-inside-work-tree >/dev/null 2>&1; then
  finish_failed "$root is not a git checkout"
fi

dirty=$(git -C "$root" status --porcelain --untracked-files=no 2>/dev/null) ||
  finish_failed "cannot inspect the working tree"
if [ -n "$dirty" ]; then
  finish_failed "working tree is dirty; commit or remove local changes first"
fi

if ! git -C "$root" checkout clean-main; then
  finish_failed "git checkout clean-main failed"
fi
if ! git -C "$root" pull --ff-only origin clean-main; then
  finish_failed "git pull --ff-only failed; services were not restarted"
fi

# Self-heal HYDI_PHONE_READ_TOKEN via /api/phone/pair — never prints the token.
# Re-pairs when the token is missing or the stored one earns a 401.
pair_base() {
  case $1 in
    *://*) printf '%s' "$1" ;;
    *:*) printf 'http://%s' "$1" ;;
    *) printf 'http://%s:3000' "$1" ;;
  esac
}

sync_phone_read_token() {
  env_file="$HOME/.hydi/thin-client.env"
  [ -f "$env_file" ] || return 0
  # shellcheck disable=SC1090
  set -a; . "$env_file"; set +a
  human=${HYDI_BOARD_HUMAN_TOKEN:-}
  hosts=${FRANK_HOSTS:-${FRANK_IP:-}}
  if [ -z "$human" ] || [ -z "$hosts" ]; then
    return 0
  fi
  tok=${HYDI_PHONE_READ_TOKEN:-}
  need_pair=0
  if [ -z "$tok" ]; then
    need_pair=1
  else
    for h in $hosts; do
      base=$(pair_base "$h")
      code=$(curl -s -o /dev/null -w '%{http_code}' --max-time 5 \
        -H "Authorization: Bearer $tok" "$base/api/phone/revenue-summary" 2>/dev/null) || code=000
      if [ "$code" = "200" ]; then break; fi
      if [ "$code" = "401" ]; then need_pair=1; fi
    done
  fi
  if [ "$need_pair" -eq 0 ]; then
    return 0
  fi
  for h in $hosts; do
    base=$(pair_base "$h")
    body=$(curl -sf --max-time 5 -H "Authorization: Bearer $human" "$base/api/phone/pair" 2>/dev/null) || continue
    new=$(printf '%s' "$body" | sed -n 's/.*"token"[ ]*:[ ]*"\([^"]*\)".*/\1/p')
    if [ -n "$new" ] && [ "$new" != "$body" ]; then
      grep -v '^HYDI_PHONE_READ_TOKEN=' "$env_file" > "$env_file.new" 2>/dev/null || true
      printf 'HYDI_PHONE_READ_TOKEN=%s\n' "$new" >> "$env_file.new"
      chmod 600 "$env_file.new"
      mv "$env_file.new" "$env_file"
      printf 'phone read token synced via pair endpoint\n'
      return 0
    fi
  done
  printf 'note: could not pair for a fresh phone read token; continuing\n'
  return 0
}

sync_phone_read_token

if ! command -v sv >/dev/null 2>&1; then
  finish_failed "sv is unavailable (install termux-services)"
fi
if ! sv restart hydi-daemon; then
  finish_failed "could not restart hydi-daemon"
fi
SERVICES_RESTARTED=1

prefix=${PREFIX:-/data/data/com.termux/files/usr}
if [ -d "$prefix/var/service/hydi" ] && [ ! -e "$prefix/var/service/hydi/down" ]; then
  if ! sv restart hydi; then
    finish_failed "could not restart hydi"
  fi
fi

sleep 10
doctor_warning=0
sh "$root/scripts/hydi-doctor.sh" || doctor_warning=1

short_hash=$(git -C "$root" rev-parse --short HEAD 2>/dev/null) ||
  finish_failed "cannot read the updated commit"
merge_body=$(git -C "$root" log -1 --merges --format=%B 2>/dev/null) ||
  finish_failed "cannot read the latest merge"
merge_title=$(printf '%s\n' "$merge_body" | awk 'NF { seen++; if (seen == 2) { print; exit } }')
if [ -z "$merge_title" ]; then
  merge_title=$(printf '%s\n' "$merge_body" | awk 'NF { print; exit }')
fi
if [ -z "$merge_title" ]; then
  merge_title="no merge commit found"
fi

if [ "$doctor_warning" -eq 1 ]; then
  printf 'UPDATED to %s — %s (doctor reported warnings above)\n' "$short_hash" "$merge_title"
else
  printf 'UPDATED to %s — %s\n' "$short_hash" "$merge_title"
fi
