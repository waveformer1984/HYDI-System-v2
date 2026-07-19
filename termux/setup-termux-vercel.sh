#!/data/data/com.termux/files/usr/bin/bash
# HYDI Termux + Vercel setup — clone the full repo onto your phone and link
# it to Vercel for on-demand manual deploys.
#
# This does NOT set up auto-deploy-on-push. HYDI stays local-first (see
# CLAUDE.md's "Local-First Architecture" section) — this script only wires
# up the `vercel` CLI so you can run `vercel --prod` by hand from Termux
# when you actually want to ship a build.
#
# Run inside Termux:  bash setup-termux-vercel.sh
set -e

REPO_URL="${HYDI_REPO_URL:-https://github.com/waveformer1984/HYDI-System-v2.git}"
REPO_DIR="${HYDI_REPO_DIR:-$HOME/HYDI-System-v2}"

echo "HYDI Termux + Vercel setup"
echo ""

# 1. Packages: git + Node.js.
# Termux's 'nodejs' and 'nodejs-lts' packages conflict (both provide `node`),
# so switch to nodejs-lts first if the plain 'nodejs' package is installed —
# doing it up front avoids apt forcing a same-transaction remove/install that
# can leave dpkg mid-swap.
echo "-> Updating package index..."
pkg update -y

if pkg list-installed 2>/dev/null | grep -q '^nodejs/'; then
  echo "-> Switching 'nodejs' -> 'nodejs-lts' (they conflict; avoids a dependency error)..."
  pkg uninstall -y nodejs || true
fi
pkg install -y git nodejs-lts

echo "-> node $(node --version), npm $(npm --version)"
echo "-> $(git --version)"
echo ""

# 2. Repo: clone fresh, or pull if it's already there.
# Plain `git clone` fails with "destination path already exists" on a second
# run — pull instead when it's already our repo.
if [ -d "$REPO_DIR/.git" ]; then
  echo "-> $REPO_DIR already exists — pulling latest instead of cloning"
  git -C "$REPO_DIR" pull --ff-only
elif [ -d "$REPO_DIR" ]; then
  echo "ERROR: $REPO_DIR exists and isn't a git repo." >&2
  echo "Move it aside, or set HYDI_REPO_DIR to a different path and re-run." >&2
  exit 1
else
  echo "-> Cloning $REPO_URL into $REPO_DIR"
  git clone "$REPO_URL" "$REPO_DIR"
fi

cd "$REPO_DIR"
echo ""

# 3. Dependencies
echo "-> npm install"
npm install
echo ""

# 4. Vercel CLI + link
if ! command -v vercel >/dev/null 2>&1; then
  echo "-> Installing the Vercel CLI"
  npm install -g vercel
fi

echo "-> vercel login (opens a device-auth link — open it on any browser)"
vercel login

echo "-> vercel link"
vercel link

cat <<'EOF'

Done. The Vercel CLI is linked for manual deploys only — no git integration
was configured, so nothing auto-deploys on push. To ship a build by hand
from Termux:

  cd ~/HYDI-System-v2
  vercel --prod

Re-run this script any time; it pulls instead of failing on an existing
clone, and skips steps that are already done.
EOF
