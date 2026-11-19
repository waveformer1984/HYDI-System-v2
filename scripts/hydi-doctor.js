#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

/**
 * Hydi doctor — one command, proof Hydi is live (read-only).
 *
 *   node scripts/hydi-doctor.js
 *   npm run doctor
 *   npm run doctor -- --json
 *   npm run doctor -- --notify
 *   npm run doctor -- --scheduled --notify
 */

const {
  runHydiDoctor,
  formatDoctorTable,
  formatDoctorJson,
  saveDoctorLatest,
  shouldNotify,
  writeNotifyState,
  notifyDoctor,
} = require('../lib/hydi/doctor');

const JSON_MODE = process.argv.includes('--json');
const NOTIFY = process.argv.includes('--notify');
const SCHEDULED = process.argv.includes('--scheduled');

async function main() {
  const report = await runHydiDoctor();
  saveDoctorLatest(report);

  if (JSON_MODE) {
    console.log(formatDoctorJson(report));
  } else {
    console.log(formatDoctorTable(report));
  }

  if (NOTIFY) {
    const send =
      !SCHEDULED || shouldNotify(report) || report.summary.fail > 0;
    if (send) {
      try {
        const result = await notifyDoctor(report);
        if (!JSON_MODE) {
          console.log(result.ok ? '[notify] sent to mobile notifications' : `[notify] skipped (${result.reason || 'unknown'})`);
        }
        if (result.ok) writeNotifyState(report);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (!JSON_MODE) console.log(`[notify] failed: ${msg}`);
      }
    } else if (!JSON_MODE) {
      console.log('[notify] unchanged — skipped (no spam)');
    }
  }

  process.exit(report.summary.fail > 0 ? 1 : 0);
}

main().catch((e) => {
  console.error('Doctor failed:', e instanceof Error ? e.message : e);
  process.exit(2);
});