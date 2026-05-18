#!/data/data/com.termux/files/usr/bin/bash
# One-time setup: install cloudflared and create a named tunnel for TermuxBridge.
# Named tunnels have a permanent URL that never changes across Termux restarts,
# unlike quick tunnels which get a new random URL every time.
#
# Run this script ONCE from Termux, then follow the printed instructions.
# Usage: bash ~/termux/HYDI-System-v2/scripts/termux/setup-cloudflared.sh

set -euo pipefail

TUNNEL_NAME="termux-bridge"
BRIDGE_PORT="5151"

echo "=== TermuxBridge cloudflared named tunnel setup ==="
echo ""

# ── 1. Install cloudflared ────────────────────────────────────────────────────
if command -v cloudflared &>/dev/null; then
  echo "cloudflared already installed: $(cloudflared --version 2>&1 | head -1)"
else
  echo "Installing cloudflared..."
  pkg install cloudflared -y
  echo "Installed: $(cloudflared --version 2>&1 | head -1)"
fi
echo ""

# ── 2. Authenticate (opens browser — one-time only) ──────────────────────────
if [ -f ~/.cloudflared/cert.pem ]; then
  echo "Cloudflare auth cert found at ~/.cloudflared/cert.pem — skipping login"
else
  echo "Step 1/3: Authenticate with Cloudflare (will open a browser link)"
  echo "If on Android without a browser, copy the URL into your phone browser."
  echo ""
  cloudflared tunnel login
fi
echo ""

# ── 3. Create named tunnel ───────────────────────────────────────────────────
echo "Step 2/3: Creating named tunnel '$TUNNEL_NAME'..."
if cloudflared tunnel list 2>/dev/null | grep -q "$TUNNEL_NAME"; then
  echo "Tunnel '$TUNNEL_NAME' already exists"
else
  cloudflared tunnel create "$TUNNEL_NAME"
fi
echo ""

# ── 4. Extract tunnel ID and permanent URL ───────────────────────────────────
TUNNEL_ID=$(cloudflared tunnel list --output json 2>/dev/null \
  | grep -oP '"id":"[^"]+"' | head -1 | grep -oP '[0-9a-f-]{36}')

if [ -z "$TUNNEL_ID" ]; then
  echo "ERROR: Could not read tunnel ID. Run: cloudflared tunnel list"
  exit 1
fi

TUNNEL_URL="https://${TUNNEL_ID}.cfargotunnel.com"
echo "Tunnel ID:  $TUNNEL_ID"
echo "Tunnel URL: $TUNNEL_URL  (this URL is permanent)"
echo ""

# ── 5. Write cloudflared config ──────────────────────────────────────────────
echo "Step 3/3: Writing ~/.cloudflared/config.yml"
mkdir -p ~/.cloudflared
cat > ~/.cloudflared/config.yml << EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${HOME}/.cloudflared/${TUNNEL_ID}.json

ingress:
  - service: http://localhost:${BRIDGE_PORT}
EOF
echo "Config written."
echo ""

# ── 6. Print PM2 ecosystem snippet ───────────────────────────────────────────
echo "────────────────────────────────────────────────────"
echo "Add this app to ~/termux/ecosystem.config.js:"
echo ""
cat << 'EOFPM2'
    {
      name: 'cloudflared',
      script: 'cloudflared',
      args: 'tunnel run termux-bridge',
      interpreter: 'none',
      restart_delay: 5000,
      autorestart: true,
    },
EOFPM2
echo ""
echo "Then reload PM2:"
echo "  pm2 delete cloudflared 2>/dev/null; pm2 start ~/termux/ecosystem.config.js; pm2 save"
echo ""

# ── 7. Print HYDI registration instructions ──────────────────────────────────
echo "────────────────────────────────────────────────────"
echo "Register the tunnel URL with HYDI (do this once):"
echo ""
echo "From heidi-chat-portal, switch to mode=infra and run:"
echo ""
echo "  env set hydi TERMUX_BRIDGE_URL=${TUNNEL_URL}"
echo "  redeploy hydi"
echo ""
echo "The URL is permanent — you only need to do this once, even across reboots."
echo "────────────────────────────────────────────────────"
