#!/bin/sh
# Fast-forward the phone checkout, restart enabled HYDI services, and diagnose.
# POSIX sh; suitable for installation as $PREFIX/bin/hydi-update.

set -u

WAKE_LOCKED=0

release_wake_lock() {
  if [ "$WAKE_LOCKED" -eq 1 ] && command -v termux-wake-unlock >/dev/null 2>&1; then
    termux-wake-unlock >/dev/null 2>&1 || true
  fi
  WAKE_LOCKED=0
}

finish_failed() {
  reason=$1
  release_wake_lock
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

dirty=$(git -C "$root" status --porcelain 2>/dev/null) ||
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

if ! command -v sv >/dev/null 2>&1; then
  finish_failed "sv is unavailable (install termux-services)"
fi
if ! sv restart hydi-daemon; then
  finish_failed "could not restart hydi-daemon"
fi

prefix=${PREFIX:-/data/data/com.termux/files/usr}
if [ ! -e "$prefix/var/service/hydi/down" ]; then
  if ! sv restart hydi; then
    finish_failed "could not restart hydi"
  fi
fi

sleep 10
if ! sh "$root/scripts/hydi-doctor.sh"; then
  finish_failed "hydi-doctor reported a failure"
fi

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

release_wake_lock
printf 'UPDATED to %s — %s\n' "$short_hash" "$merge_title"
