#!/bin/bash
# Heidi Cloudflare Tunnel — Linux / Termux / macOS
# Exposes http://localhost:3006 to a public HTTPS URL
# No account required for quick tunnels.
#
# Usage:
#   bash heidi-tunnel.sh
#   bash heidi-tunnel.sh 3007       # custom port

PORT=${1:-3006}

install_cloudflared_termux() {
    echo "Installing cloudflared via pkg..."
    pkg install cloudflared -y 2>/dev/null || {
        echo "pkg install failed, trying direct download..."
        ARCH=$(uname -m)
        if [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
            URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
        else
            URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
        fi
        curl -L "$URL" -o "$PREFIX/bin/cloudflared"
        chmod +x "$PREFIX/bin/cloudflared"
    }
}

install_cloudflared_linux() {
    ARCH=$(uname -m)
    if [[ "$ARCH" == "aarch64" || "$ARCH" == "arm64" ]]; then
        URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-arm64"
    else
        URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-amd64"
    fi
    echo "Downloading cloudflared for $ARCH..."
    curl -L "$URL" -o /tmp/cloudflared
    chmod +x /tmp/cloudflared
    sudo mv /tmp/cloudflared /usr/local/bin/cloudflared 2>/dev/null || mv /tmp/cloudflared "$HOME/.local/bin/cloudflared"
}

if ! command -v cloudflared &>/dev/null; then
    echo "cloudflared not found. Installing..."
    if [[ -n "$PREFIX" ]] && [[ "$PREFIX" == *"termux"* ]]; then
        install_cloudflared_termux
    elif [[ "$OSTYPE" == "darwin"* ]]; then
        brew install cloudflared 2>/dev/null || install_cloudflared_linux
    else
        install_cloudflared_linux
    fi
fi

echo ""
echo "Starting Cloudflare tunnel -> http://localhost:$PORT"
echo "Your public URL will appear below (trycloudflare.com link)."
echo "Paste it into Heidi .env as: HEIDI_PUBLIC_URL=https://xxxx.trycloudflare.com"
echo ""
echo "Press Ctrl+C to stop."
echo ""

cloudflared tunnel --url "http://localhost:$PORT"
