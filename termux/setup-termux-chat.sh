#!/data/data/com.termux/files/usr/bin/bash
# HYDI Chat on Termux — one-shot setup.
# Run inside Termux:  bash setup-termux-chat.sh
set -e

echo "⚡ HYDI Chat — Termux setup"

# 1. Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "→ Installing Node.js…"
  pkg update -y && pkg install -y nodejs
fi
echo "→ Node $(node --version)"

# 2. Files: server + UI live in this directory
DIR="$(cd "$(dirname "$0")" && pwd)"
if [ ! -f "$DIR/hydi-chat.html" ] && [ -f "$DIR/../public/hydi-chat.html" ]; then
  cp "$DIR/../public/hydi-chat.html" "$DIR/hydi-chat.html"
fi

# 3. Env template (edit with your real values — never commit this file)
ENVFILE="$DIR/.env.hydi"
if [ ! -f "$ENVFILE" ]; then
  cat > "$ENVFILE" <<'EOF'
# HYDI Chat Termux node — fill these in, then: source .env.hydi
export SUPABASE_URL="https://YOUR-PROJECT-REF.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="PASTE-SERVICE-ROLE-KEY"
# Optional: require HMAC auth like production (leave empty for local-only use)
export HYDI_SERVICE_SECRET=""
export PORT=8787
EOF
  echo "→ Created $ENVFILE — edit it with your Supabase credentials."
fi

echo ""
echo "Done. To start the chat:"
echo "  1. nano $ENVFILE        # paste your Supabase URL + service role key"
echo "  2. source $ENVFILE"
echo "  3. node $DIR/hydi-chat-server.js"
echo "  4. Open http://localhost:8787 in your phone browser"
echo ""
echo "Keep it running in the background:"
echo "  nohup node $DIR/hydi-chat-server.js > $DIR/hydi-chat.log 2>&1 &"
echo "  (or use pm2: npm i -g pm2 && pm2 start $DIR/hydi-chat-server.js --name hydi-chat)"
