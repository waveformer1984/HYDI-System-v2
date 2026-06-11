#!/usr/bin/env bash
# ============================================================
# Heidi  —  Termux/Android launcher
# Run on your Android phone: bash heidi-start.sh
# ============================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load .env if present
if [ -f "$SCRIPT_DIR/.env" ]; then
    set -o allexport
    source "$SCRIPT_DIR/.env"
    set +o allexport
fi

# Defaults
: "${HEIDI_PORT:=3006}"
: "${OLLAMA_URL:=http://localhost:11434}"
: "${URSULA_URL:=http://localhost:5050}"

echo ""
echo "Heidi Mobile Server"
echo "==================="
echo "  Port     : $HEIDI_PORT"
echo "  Ollama   : $OLLAMA_URL"
echo "  Backend  : $URSULA_URL"
echo ""

# Check Node
if ! command -v node &>/dev/null; then
    echo "ERROR: Node.js not found. Run: pkg install nodejs"
    exit 1
fi

# Check Ollama reachable
curl -sf "$OLLAMA_URL/api/tags" >/dev/null 2>&1 \
    && echo "  Ollama   : online" \
    || echo "  Ollama   : offline (start with: ollama serve)"

# Check bridge reachable
curl -sf "$URSULA_URL/health" >/dev/null 2>&1 \
    && echo "  Bridge   : online ($URSULA_URL)" \
    || echo "  Bridge   : offline (start heidi-start.bat on Windows)"

echo ""

# Install deps if needed
if [ ! -d "$SCRIPT_DIR/node_modules" ]; then
    echo "Installing dependencies..."
    cd "$SCRIPT_DIR" && npm install
fi

# Start server
cd "$SCRIPT_DIR"
node launch-heidi-mobile.js
