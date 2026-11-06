'use strict';
// Runbook target for the ops-fixture incident: (re)start the fixture server.
// Idempotent — if the port is already listening it exits 0 without spawning
// a second copy. The spawn is detached so this script returns while the
// server keeps running (same shape as scripts/restart-module.js).
const { spawn } = require('child_process');
const net = require('net');
const path = require('path');

const port = Number(process.env.OPS_FIXTURE_PORT) || 34455;
const server = path.join(__dirname, 'ops-fixture-server.js');

function portInUse(cb) {
  const s = net.connect(port, '127.0.0.1');
  s.once('connect', () => { s.destroy(); cb(true); });
  s.once('error', () => cb(false));
}

portInUse((up) => {
  if (up) { console.log(`ops-fixture already listening on ${port} — nothing to restart`); process.exit(0); }
  const child = spawn(process.execPath, [server], { detached: true, stdio: 'ignore' });
  child.unref();
  console.log(`ops-fixture restarted pid=${child.pid} port=${port}`);
  process.exit(0);
});
