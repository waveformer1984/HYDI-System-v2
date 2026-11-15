#!/usr/bin/env node
'use strict';

/**
 * Weekly resource discovery cycle — hooks into hydi-schedulers (no new PM2 app).
 *
 * Disabled unless HYDI_ENABLE_WEEKLY_RESOURCE_DISCOVERY=1 (operator opt-in).
 *
 *   node scripts/resource-discovery-scheduler.js --once
 */

const path = require('path');
const fs = require('fs');
const { MissionRunLock } = require('./mission-run-lock');
const { HydiResourceAcquisitionSystem } = require('../lib/resource-acquisition/system');
const { loadApprovedOrgProfileFromEnv } = require('../lib/partnerships-funding/profile-loader');
const { runVerificationPass } = require('../lib/resource-acquisition/verify/run-pass');

const ROOT = path.resolve(__dirname, '..');
const ONCE = process.argv.includes('--once');
const LOCK_PATH = process.env.HYDI_RESOURCE_DISCOVERY_LOCK || path.join(ROOT, '.runtime', 'resource-discovery.lock');
const LOG_PATH = process.env.HYDI_RESOURCE_DISCOVERY_LOG || path.join(ROOT, 'logs', 'resource-discovery-scheduler.log');
const RECORD_PATH = path.join(ROOT, '.runtime', 'resource-discovery', 'last-cycle.json');

async function runCycle() {
  if (process.env.HYDI_ENABLE_WEEKLY_RESOURCE_DISCOVERY !== '1') {
    const skip = { ok: true, skipped: true, reason: 'HYDI_ENABLE_WEEKLY_RESOURCE_DISCOVERY_not_set' };
    console.log(JSON.stringify(skip));
    return skip;
  }

  const lock = new MissionRunLock(LOCK_PATH);
  const acquired = lock.acquire({ owner: 'resource-discovery-scheduler' });
  if (!acquired.acquired) {
    const dup = { ok: false, skipped: true, reason: 'lock_held' };
    console.log(JSON.stringify(dup));
    return dup;
  }

  try {
    const system = new HydiResourceAcquisitionSystem();
    const loaded = loadApprovedOrgProfileFromEnv();
    const profile = loaded.ok ? loaded.profile : null;
    const cycle = await system.runCycle({
      mode: 'weekly',
      profile,
      liveReachability: process.env.HYDI_ALLOW_LIVE_DISCOVERY === '1',
    });
    const verify =
      process.env.HYDI_ALLOW_AUTOMATED_VERIFICATION === '1'
        ? await runVerificationPass(system.runner.engine.coordinator, { limit: Number(process.env.HYDI_VERIFY_LIMIT || 12) })
        : null;

    const record = {
      at: new Date().toISOString(),
      cycle_ok: cycle.ok,
      verify_summary: verify?.counts || null,
      discovery_intake: cycle.discover?.output?.intake_count ?? null,
    };
    fs.mkdirSync(path.dirname(RECORD_PATH), { recursive: true });
    fs.writeFileSync(RECORD_PATH, JSON.stringify(record, null, 2));
    fs.mkdirSync(path.dirname(LOG_PATH), { recursive: true });
    fs.appendFileSync(LOG_PATH, `${record.at} ok=${record.cycle_ok} intake=${record.discovery_intake}\n`);
    const out = { ok: true, record, cycle_trace: cycle.trace, verify };
    console.log(JSON.stringify(out));
    return out;
  } finally {
    lock.release();
  }
}

if (ONCE || require.main === module) {
  runCycle()
    .then((r) => process.exit(r?.ok === false && !r?.skipped ? 1 : 0))
    .catch((e) => {
      console.error(e instanceof Error ? e.message : e);
      process.exit(1);
    });
}

module.exports = { runCycle };