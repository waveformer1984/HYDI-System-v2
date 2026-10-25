'use strict';

/**
 * PM2 starts the frank-* loops as plain Node forks, which never read
 * .env.local, so HYDI_BOARD_URL / HYDI_BOARD_TOKEN_* were absent and every
 * #alerts post was skipped as "board auth not configured" (frank-auto-deploy
 * sat blocked ~8h on 2026-10-24 with no alert).
 *
 * Load only the HYDI_BOARD_* keys from .env.local (then .env), never
 * overriding a value PM2 already provides. Everything else in those files is
 * left alone on purpose: these processes run `pm2 restart --update-env`,
 * which pushes their environment into the apps they restart, and a stray
 * PORT or NODE_ENV from .env.local must never ride along.
 */

const fs = require('fs');
const path = require('path');

const BOARD_KEY = /^HYDI_BOARD_[A-Z0-9_]+$/;

function parse(text) {
  try {
    return require('dotenv').parse(text);
  } catch {
    return {};
  }
}

/** @returns {string[]} the key names it set (never values) */
function loadBoardEnv(root, { env = process.env, files = ['.env.local', '.env'] } = {}) {
  const set = [];
  for (const name of files) {
    let text;
    try { text = fs.readFileSync(path.join(root, name), 'utf8'); } catch { continue; }
    const parsed = parse(text);
    for (const [key, value] of Object.entries(parsed)) {
      if (!BOARD_KEY.test(key) || !value) continue;
      if (env[key] !== undefined && env[key] !== '') continue;
      env[key] = value;
      set.push(key);
    }
  }
  return set;
}

module.exports = { loadBoardEnv, BOARD_KEY };
