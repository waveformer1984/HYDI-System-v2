'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

function poolRuntimeDir(root = ROOT) {
  return path.join(root, '.runtime', 'pool');
}

function pauseFile(root = ROOT) {
  return path.join(poolRuntimeDir(root), 'paused.json');
}

function isPoolPaused(env = process.env, root = ROOT) {
  if (String(env.POOL_PAUSED || '').trim() === '1') return true;
  try {
    const p = pauseFile(root);
    if (!fs.existsSync(p)) return false;
    const data = JSON.parse(fs.readFileSync(p, 'utf8'));
    return data.paused === true;
  } catch {
    return false;
  }
}

function setPoolPaused(paused, root = ROOT, reason = 'operator') {
  const dir = poolRuntimeDir(root);
  fs.mkdirSync(dir, { recursive: true });
  const file = pauseFile(root);
  if (!paused) {
    try {
      fs.unlinkSync(file);
    } catch {
      /* absent */
    }
    return { ok: true, paused: false };
  }
  const payload = { paused: true, at: new Date().toISOString(), reason };
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  return { ok: true, paused: true, ...payload };
}

function isPoolStopQuery(input) {
  const t = String(input || '').trim().toLowerCase();
  return t === 'pool stop' || t === 'pool pause';
}

function isPoolStartQuery(input) {
  const t = String(input || '').trim().toLowerCase();
  return t === 'pool start' || t === 'pool resume';
}

function handlePoolChatCommand(input, root = ROOT) {
  if (isPoolStopQuery(input)) {
    setPoolPaused(true, root, 'mobile_chat');
    return 'Pool paused — current tasks may finish; no new claims until pool start or POOL_PAUSED cleared.';
  }
  if (isPoolStartQuery(input)) {
    setPoolPaused(false, root);
    return 'Pool resumed — clones may claim subtasks again.';
  }
  return null;
}

module.exports = {
  isPoolPaused,
  setPoolPaused,
  isPoolStopQuery,
  isPoolStartQuery,
  handlePoolChatCommand,
  poolRuntimeDir,
  pauseFile,
};