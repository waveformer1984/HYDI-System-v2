#!/usr/bin/env node
'use strict';
/**
 * Restart ONE PM2 app by name. Allowlisted action target — only reachable
 * through the mission approval pipeline (context.allowlist = pm2_restart).
 *
 * Usage: node scripts/pm2-restart.js <pm2-app-name>
 *
 * Safety: the name must look like a PM2 app id/name and the app must exist
 * in `pm2 jlist` before we touch it. `pm2 restart` is used rather than
 * kill+spawn so PM2's own restart policy, env and cwd are preserved.
 */
const { spawnSync } = require('child_process');

const APP_RE = /^[a-zA-Z0-9:_-]{1,64}$/;

function pm2(args) {
  const cmd = process.platform === 'win32' ? 'pm2.cmd' : 'pm2';
  return spawnSync(cmd, args, { encoding: 'utf8', timeout: 30000, windowsHide: true });
}

function main() {
  const app = process.argv[2];
  if (!app || !APP_RE.test(app)) {
    console.error('usage: node scripts/pm2-restart.js <pm2-app-name>');
    process.exit(2);
  }
  const list = pm2(['jlist']);
  if (list.error || list.status !== 0) {
    console.error(`pm2 jlist failed: ${(list.stderr || list.error?.message || 'unknown').slice(0, 300)}`);
    process.exit(1);
  }
  let apps;
  try { apps = JSON.parse(list.stdout); } catch {
    console.error('pm2 jlist returned non-JSON');
    process.exit(1);
  }
  const names = new Set((apps || []).flatMap((a) => [a.name, String(a.pm_id)]));
  if (!names.has(app)) {
    console.error(`no PM2 app named '${app}'. Known: ${[...names].slice(0, 30).join(', ')}`);
    process.exit(1);
  }
  const r = pm2(['restart', app]);
  if (r.error || r.status !== 0) {
    console.error(`pm2 restart ${app} failed: ${(r.stderr || r.error?.message || 'unknown').slice(0, 300)}`);
    process.exit(1);
  }
  console.log(`restarted ${app}`);
  process.exit(0);
}

main();
