#!/data/data/com.termux/files/usr/bin/bash
# ─────────────────────────────────────────────────────────
#  Hydi BLE Chat Portal — Termux Setup
#  Run once:  bash setup-ble.sh
# ─────────────────────────────────────────────────────────

set -e

echo ""
echo "  ██╗  ██╗██╗   ██╗██████╗ ██╗"
echo "  ██║  ██║╚██╗ ██╔╝██╔══██╗██║"
echo "  ███████║ ╚████╔╝ ██║  ██║██║"
echo "  ██╔══██║  ╚██╔╝  ██║  ██║██║"
echo "  ██║  ██║   ██║   ██████╔╝██║"
echo "  ╚═╝  ╚═╝   ╚═╝   ╚═════╝ ╚═╝"
echo "  BLE Setup"
echo ""

HYDI_DIR="$HOME/hydi"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

mkdir -p "$HYDI_DIR"

echo "→ Copying BLE files..."
for f in hydi-ble.py hydi-ble-client.html; do
  if [ -f "$SCRIPT_DIR/$f" ]; then
    cp "$SCRIPT_DIR/$f" "$HYDI_DIR/$f"
    echo "  ✓ $f"
  else
    echo "  ⚠ $f not found"
  fi
done

echo ""
echo "→ Installing packages..."
pkg install -y python bluez bluez-libs 2>/dev/null || true

echo ""
echo "→ Installing bless (BLE GATT server library)..."
pip install bless 2>/dev/null || {
  echo ""
  echo "  ⚠  bless install failed."
  echo "  This is common on plain Termux because BlueZ/DBus is not available."
  echo ""
  echo "  Option A — proot-distro Ubuntu (recommended):"
  echo "    pkg install proot-distro"
  echo "    proot-distro install ubuntu"
  echo "    proot-distro login ubuntu -- apt install -y python3 python3-pip bluetooth"
  echo "    proot-distro login ubuntu -- pip3 install bless"
  echo "    proot-distro login ubuntu -- python3 ~/hydi/hydi-ble.py"
  echo ""
  echo "  Option B — just use the WiFi URL instead:"
  echo "    python ~/hydi/hydi.py"
  echo "    Then open the IP it prints in Chrome (not localhost)"
  echo ""
}

echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  BLE Setup complete!"
echo ""
echo "  Start BLE server:"
echo "    python ~/hydi/hydi-ble.py"
echo ""
echo "  Then open the client in Chrome:"
echo "    https://waveformer1984.github.io/hydi-system-v2/hydi-ble-client.html"
echo ""
echo "  Or open ~/hydi/hydi-ble-client.html from your Files app."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
