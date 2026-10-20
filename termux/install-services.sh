#!/bin/sh
# Copy termux/services/hydi and hydi-daemon into $PREFIX/var/service/.
# An existing run script is copied to run.bak-<date> before it is replaced.
set -u

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
base=$(dirname "$src")
services="$base/services"
prefix="${PREFIX:-/data/data/com.termux/files/usr}"
svdir="$prefix/var/service"
stamp=$(date +%Y%m%d-%H%M%S)

if [ ! -f "$services/hydi/run" ] || [ ! -f "$services/hydi-daemon/run" ]; then
  printf 'service definitions missing under %s\n' "$services" >&2
  exit 1
fi

install_one() {
  name=$1
  from="$services/$name"
  dest="$svdir/$name"
  mkdir -p "$dest/log" || exit 1
  if [ -e "$dest/run" ]; then
    bak="$dest/run.bak-$stamp"
    n=0
    while [ -e "$bak" ]; do
      n=$((n + 1))
      bak="$dest/run.bak-$stamp-$n"
    done
    cp -p "$dest/run" "$bak" || exit 1
    printf 'backed up %s -> %s\n' "$dest/run" "$bak"
  fi
  if [ -e "$dest/log/run" ]; then
    bak="$dest/log/run.bak-$stamp"
    n=0
    while [ -e "$bak" ]; do
      n=$((n + 1))
      bak="$dest/log/run.bak-$stamp-$n"
    done
    cp -p "$dest/log/run" "$bak" || exit 1
    printf 'backed up %s -> %s\n' "$dest/log/run" "$bak"
  fi
  cp "$from/run" "$dest/run" || exit 1
  cp "$from/log/run" "$dest/log/run" || exit 1
  chmod +x "$dest/run" "$dest/log/run" || exit 1
  printf 'installed %s\n' "$dest"
}

install_one hydi
install_one hydi-daemon

if ! command -v sv >/dev/null 2>&1; then
  printf 'sv is not on PATH. Install termux-services, then: sv restart hydi hydi-daemon\n' >&2
  exit 1
fi
sv restart hydi hydi-daemon
