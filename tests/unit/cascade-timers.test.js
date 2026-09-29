'use strict';

/**
 * CASCADE's background timers (uptime, heartbeat, fingerprint/quarantine
 * cleanup, health snapshot, emission tracking cleanup) are housekeeping.
 * They must not keep a process alive on their own, so a script or test that
 * starts CASCADE without stopping it can still exit. protoforge-core stays up
 * because of its HTTP server, not because of these.
 */

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');

it('lets a process that started CASCADE and never stopped it exit on its own', () => {
  const script = `
    const CascadeCompleteV2 = require('./modules/cascade-complete-v2').constructor;
    const { MemoryLedger } = require('./lib/pipeline/memory-ledger');
    const cascade = new CascadeCompleteV2({ pipeline: { ledger: new MemoryLedger() } });
    cascade.start();
    console.log(cascade.isRunning ? 'started' : 'not started');
  `;
  const result = spawnSync(process.execPath, ['-e', script], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 15000,
    env: { ...process.env, SUPABASE_URL: '', SUPABASE_SERVICE_ROLE_KEY: '' },
  });

  expect(result.error).toBeUndefined(); // ETIMEDOUT here means a timer held the process open
  expect(result.stdout).toContain('started');
  expect(result.status).toBe(0);
}, 20000);
