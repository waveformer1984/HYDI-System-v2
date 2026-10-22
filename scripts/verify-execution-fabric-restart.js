'use strict';

/**
 * Create (or inspect) an AWAITING_APPROVAL test task, restart heidi-web, and
 * prove the same task still exists. This script never approves or executes it.
 */

const crypto = require('crypto');
const path = require('path');
const { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const TASK_ID_RE = /^[a-f0-9]{24}$/;
const SERVICE = 'fabric-persistence-proof';

function loadLocalEnv() {
  try {
    require('dotenv').config({ path: path.join(ROOT, '.env.local'), override: false });
    require('dotenv').config({ path: path.join(ROOT, '.env'), override: false });
  } catch { /* optional */ }
}

function serviceToken(secret) {
  const ts = String(Date.now());
  const requestId = crypto.randomUUID();
  const signature = crypto.createHmac('sha256', secret)
    .update(`${ts}:${requestId}:${SERVICE}`)
    .digest('hex');
  return `${ts}.${requestId}.${SERVICE}.${signature}`;
}

async function jsonRequest(fetchFn, url, secret, options = {}) {
  const response = await fetchFn(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      'x-hydi-service-token': serviceToken(secret),
      ...(options.headers || {}),
    },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${(body && body.error) || 'request failed'}`);
  return body;
}

function restartWeb(platform = process.platform) {
  const pm2 = platform === 'win32' ? 'pm2.cmd' : 'pm2';
  return new Promise((resolve, reject) => {
    execFile(pm2, ['restart', 'heidi-web-standalone', '--update-env'], {
      cwd: ROOT,
      timeout: 2 * 60 * 1000,
      windowsHide: true,
    }, (error) => error ? reject(new Error('PM2 restart failed')) : resolve());
  });
}

async function waitForWeb(fetchFn, base, {
  now = () => Date.now(),
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  timeoutMs = 2 * 60 * 1000,
} = {}) {
  const deadline = now() + timeoutMs;
  do {
    try {
      const response = await fetchFn(`${base}/api/ping`, { signal: AbortSignal.timeout(4_000) });
      if (response.ok) return true;
    } catch { /* restarting */ }
    if (now() >= deadline) break;
    await sleep(2_000);
  } while (now() <= deadline);
  return false;
}

async function verifyFabricRestart({
  taskId = null,
  base = 'http://127.0.0.1:3000',
  secret,
  fetchFn = globalThis.fetch,
  restart = restartWeb,
  wait = waitForWeb,
} = {}) {
  if (!secret) throw new Error('HYDI_SERVICE_SECRET is not configured');
  const readiness = await jsonRequest(fetchFn, `${base}/api/mobile-ops/fabric?readiness=1`, secret);
  if (readiness.persistence_mode !== 'postgres') {
    throw new Error(`execution fabric is ${readiness.persistence_mode || 'unknown'}, expected postgres`);
  }

  let before;
  if (taskId) {
    if (!TASK_ID_RE.test(taskId)) throw new Error('task id must be 24 lowercase hex characters');
    const found = await jsonRequest(fetchFn, `${base}/api/mobile-ops/fabric?task_id=${taskId}`, secret);
    before = found.task;
  } else {
    const created = await jsonRequest(fetchFn, `${base}/api/mobile-ops/fabric`, secret, {
      method: 'POST',
      headers: { 'x-idempotency-key': `persistence-proof:${Date.now()}` },
      body: JSON.stringify({
        capability: 'board.request',
        confirm: false,
        objective: 'Execution-fabric persistence proof only; do not approve.',
        args: { request: 'Persistence proof only; no action requested.' },
      }),
    });
    before = created.task;
  }
  if (!before || before.state !== 'AWAITING_APPROVAL') {
    throw new Error('proof task is not awaiting approval');
  }

  await restart();
  if (!(await wait(fetchFn, base))) throw new Error('heidi-web did not become healthy after restart');

  const found = await jsonRequest(fetchFn, `${base}/api/mobile-ops/fabric?task_id=${before.id}`, secret);
  const after = found.task;
  if (!after || after.id !== before.id || after.state !== 'AWAITING_APPROVAL') {
    throw new Error('approval did not survive heidi-web restart');
  }
  return { ok: true, task_id: after.id, state: after.state };
}

function taskIdFromArgs(argv) {
  const item = argv.find((arg) => arg.startsWith('--task-id='));
  return item ? item.slice('--task-id='.length) : null;
}

if (require.main === module) {
  loadLocalEnv();
  verifyFabricRestart({
    taskId: taskIdFromArgs(process.argv.slice(2)),
    secret: process.env.HYDI_SERVICE_SECRET,
  }).then((result) => {
    process.stdout.write(`PASS: approval ${result.task_id} survived heidi-web-standalone restart in ${result.state}; nothing was approved.\n`);
  }).catch((error) => {
    process.stderr.write(`FAIL: ${error instanceof Error ? error.message : 'persistence proof failed'}\n`);
    process.exitCode = 1;
  });
}

module.exports = {
  TASK_ID_RE,
  serviceToken,
  waitForWeb,
  verifyFabricRestart,
  taskIdFromArgs,
};
