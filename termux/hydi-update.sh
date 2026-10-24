#!/bin/sh
# Fast-forward the phone checkout, restart enabled HYDI services, and diagnose.
# POSIX sh; suitable for installation as $PREFIX/bin/hydi-update.

set -u

WAKE_LOCKED=0
SERVICES_RESTARTED=0
PAIR_BODY_FILE=

release_wake_lock() {
  if [ "$WAKE_LOCKED" -eq 1 ] && command -v termux-wake-unlock >/dev/null 2>&1; then
    termux-wake-unlock >/dev/null 2>&1 || true
  fi
  WAKE_LOCKED=0
}

finish_failed() {
  reason=$1
  if [ -n "$PAIR_BODY_FILE" ]; then
    rm -f "$PAIR_BODY_FILE"
    PAIR_BODY_FILE=
  fi
  if [ "$SERVICES_RESTARTED" -eq 0 ]; then
    release_wake_lock
  fi
  printf 'UPDATE FAILED: %s\n' "$reason"
  exit 1
}

trap 'finish_failed "interrupted"' HUP INT TERM

read_env_value() {
  key=$1
  file=$2
  [ -f "$file" ] || return 0
  awk -v wanted="$key" '
    {
      line = $0
      sub(/^[ \t]*/, "", line)
      sub(/^export[ \t]+/, "", line)
      equals = index(line, "=")
      if (equals > 0 && substr(line, 1, equals - 1) == wanted) {
        value = substr(line, equals + 1)
        if ((substr(value, 1, 1) == "\"" && substr(value, length(value), 1) == "\"") ||
            (substr(value, 1, 1) == "\047" && substr(value, length(value), 1) == "\047")) {
          value = substr(value, 2, length(value) - 2)
        }
        print value
        exit
      }
    }
  ' "$file"
}

authorized_status() {
  auth_token=$1
  request_url=$2
  output_file=$3
  printf 'header = "Authorization: Bearer %s"\n' "$auth_token" |
    curl --config - --silent --connect-timeout 3 --max-time 8 \
      --output "$output_file" --write-out '%{http_code}' "$request_url" 2>/dev/null
}

pair_phone_token() {
  env_file=$HOME/.hydi/thin-client.env
  hosts=$(read_env_value FRANK_HOSTS "$env_file")
  if [ -z "$hosts" ]; then
    hosts=$(read_env_value FRANK_IP "$env_file")
  fi
  if [ -z "$hosts" ]; then
    printf 'phone token: pairing failed (FRANK_HOSTS missing)\n'
    return
  fi
  if ! command -v curl >/dev/null 2>&1 || ! command -v node >/dev/null 2>&1; then
    printf 'phone token: pairing failed (curl or node missing)\n'
    return
  fi

  phone_token=$(read_env_value HYDI_PHONE_READ_TOKEN "$env_file")
  scratch_dir=${TMPDIR:-$HOME/.hydi}
  mkdir -p "$scratch_dir" "$HOME/.hydi" 2>/dev/null || {
    printf 'phone token: pairing failed (cannot create private directory)\n'
    return
  }
  chmod 700 "$HOME/.hydi" 2>/dev/null || true
  body_file=$scratch_dir/hydi-phone-pair.$$
  PAIR_BODY_FILE=$body_file
  umask 077
  : > "$body_file" || {
    printf 'phone token: pairing failed (cannot create response file)\n'
    return
  }

  needs_pair=0
  auth_accepted=0
  case $phone_token in
    '') needs_pair=1 ;;
    *[!A-Za-z0-9._~-]*) phone_token=; needs_pair=1 ;;
  esac
  if [ -n "$phone_token" ]; then
    old_ifs=$IFS
    IFS=,
    for host in $hosts; do
      IFS=$old_ifs
      host=$(printf '%s' "$host" | tr -d ' ')
      case $host in
        ''|*[!A-Za-z0-9._:-]*) IFS=,; continue ;;
      esac
      status=$(authorized_status "$phone_token" "http://$host:3000/api/phone/revenue-summary" "$body_file") || status=000
      case $status in
        200|429|503) auth_accepted=1; break ;;
        401) needs_pair=1 ;;
      esac
      IFS=,
    done
    IFS=$old_ifs
  fi

  if [ "$auth_accepted" -eq 1 ]; then
    rm -f "$body_file"
    PAIR_BODY_FILE=
    printf 'phone token: paired\n'
    return
  fi
  if [ "$needs_pair" -ne 1 ]; then
    rm -f "$body_file"
    PAIR_BODY_FILE=
    printf 'phone token: pairing failed (Frank unreachable)\n'
    return
  fi

  human_token=$(read_env_value HYDI_BOARD_HUMAN_TOKEN "$env_file")
  case $human_token in
    ''|*[!A-Za-z0-9._~-]*)
      rm -f "$body_file"
      PAIR_BODY_FILE=
      printf 'phone token: pairing failed (human token missing or invalid)\n'
      return
      ;;
  esac

  failure=Frank-unreachable
  old_ifs=$IFS
  IFS=,
  for host in $hosts; do
    IFS=$old_ifs
    host=$(printf '%s' "$host" | tr -d ' ')
    case $host in
      ''|*[!A-Za-z0-9._:-]*) IFS=,; continue ;;
    esac
    status=$(authorized_status "$human_token" "http://$host:3000/api/phone/pair" "$body_file") || status=000
    if [ "$status" = 200 ] && node "$root/termux/store-phone-token.js" "$body_file" "$env_file" >/dev/null 2>&1; then
      rm -f "$body_file"
      PAIR_BODY_FILE=
      printf 'phone token: paired\n'
      return
    fi
    case $status in
      401) failure=human-auth-rejected ;;
      404) failure=network-denied ;;
      429) failure=rate-limited ;;
      503) failure=Frank-token-unavailable ;;
      000) failure=Frank-unreachable ;;
      *) failure="HTTP-$status" ;;
    esac
    IFS=,
  done
  IFS=$old_ifs
  rm -f "$body_file"
  PAIR_BODY_FILE=
  printf 'phone token: pairing failed (%s)\n' "$failure"
}

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

pair_phone_token

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
