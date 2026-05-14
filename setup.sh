#!/data/data/com.termux/files/usr/bin/bash
# ─────────────────────────────────────────────────────────
#  Hydi ProtoForge — Termux Setup Script
#  Run once:  bash setup.sh
# ─────────────────────────────────────────────────────────

set -e

echo ""
echo "  ██╗  ██╗██╗   ██╗██████╗ ██╗"
echo "  ██║  ██║╚██╗ ██╔╝██╔══██╗██║"
echo "  ███████║ ╚████╔╝ ██║  ██║██║"
echo "  ██╔══██║  ╚██╔╝  ██║  ██║██║"
echo "  ██║  ██║   ██║   ██████╔╝██║"
echo "  ╚═╝  ╚═╝   ╚═╝   ╚═════╝ ╚═╝"
echo "  ProtoForge Mobile Setup"
echo ""

HYDI_DIR="$HOME/hydi"

# 1. Create ~/hydi if needed
echo "→ Creating $HYDI_DIR ..."
mkdir -p "$HYDI_DIR"

# 2. Copy files from repo (if running from it) or download
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

copy_if_exists() {
  local file="$1"
  if [ -f "$SCRIPT_DIR/$file" ]; then
    cp "$SCRIPT_DIR/$file" "$HYDI_DIR/$file"
    echo "  ✓ $file"
  else
    echo "  ⚠ $file not found in $SCRIPT_DIR — skipping"
  fi
}

echo "→ Copying Hydi files ..."
copy_if_exists hydi.py
copy_if_exists hydi-mobile-protoforge.html
copy_if_exists manifest.json
copy_if_exists sw.js

chmod +x "$HYDI_DIR/hydi.py" 2>/dev/null || true

# 3. Install Termux packages
echo ""
echo "→ Installing Termux packages ..."
pkg install -y python termux-api 2>/dev/null || true

# 4. Optional: create launcher alias
SHELL_RC="$HOME/.bashrc"
[ -f "$HOME/.zshrc" ] && SHELL_RC="$HOME/.zshrc"

ALIAS_LINE='alias hydi="python $HOME/hydi/hydi.py"'
if ! grep -q "alias hydi=" "$SHELL_RC" 2>/dev/null; then
  echo "" >> "$SHELL_RC"
  echo "# Hydi ProtoForge" >> "$SHELL_RC"
  echo "$ALIAS_LINE" >> "$SHELL_RC"
  echo "  ✓ Added 'hydi' alias to $SHELL_RC"
else
  echo "  ✓ 'hydi' alias already set"
fi

# 5. Done
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "  Setup complete!"
echo ""
echo "  Start Hydi (web server):"
echo "    python ~/hydi/hydi.py"
echo ""
echo "  Interactive CLI:"
echo "    python ~/hydi/hydi.py cli"
echo ""
echo "  Single command:"
echo "    python ~/hydi/hydi.py status"
echo "    python ~/hydi/hydi.py grow"
echo ""
echo "  After restarting Termux you can also just type:"
echo "    hydi"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""
