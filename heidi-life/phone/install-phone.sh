#!/data/data/com.termux/files/usr/bin/bash
# One-time setup on the Samsung (Termux). Usage:
#   bash install-phone.sh http://<FRANK_LAN_IP>:3470 <TOKEN>
# Prereqs (install as apps, from F-Droid/GitHub — same source as your Termux): Termux:API, Termux:Boot.
set -euo pipefail
FRANK_URL="${1:?Frank URL, e.g. http://192.168.1.100:3470}"
TOKEN="${2:?token from Frank config.json}"

pkg install -y termux-api jq curl termux-services coreutils

mkdir -p "$HOME/.heidi-life"
cp "$(dirname "$0")/heidi-life-collector.sh" "$HOME/.heidi-life/collector.sh"
chmod +x "$HOME/.heidi-life/collector.sh"
cat > "$HOME/.heidi-life/env" <<EOF
HEIDI_FRANK_URL=$FRANK_URL
HEIDI_TOKEN=$TOKEN
INTERVAL=300
EOF
chmod 600 "$HOME/.heidi-life/env"

# runit service, same pattern as hydi / hydi-daemon
SVC="$PREFIX/var/service/heidi-life"
mkdir -p "$SVC"
printf '#!/data/data/com.termux/files/usr/bin/sh\nexec %s 2>&1\n' "$HOME/.heidi-life/collector.sh" > "$SVC/run"
chmod +x "$SVC/run"
sv-enable heidi-life 2>/dev/null || true
sv up heidi-life || true

# start services after reboot (requires the Termux:Boot app to have been opened once)
mkdir -p "$HOME/.termux/boot"
cat > "$HOME/.termux/boot/start-heidi-life.sh" <<'EOF'
#!/data/data/com.termux/files/usr/bin/sh
termux-wake-lock
. $PREFIX/etc/profile.d/start-services.sh
EOF
chmod +x "$HOME/.termux/boot/start-heidi-life.sh"

echo "Requesting location permission (accept the Android prompt)…"
timeout 60 termux-location -p network -r once || echo "No fix yet — grant 'Allow all the time' location to Termux:API in Android settings."
echo
echo "Done. Also in Android settings: Battery → Termux and Termux:API → Unrestricted."
echo "Test now:  curl -s -H 'x-heidi-token: $TOKEN' $FRANK_URL/api/notifications/pending"
