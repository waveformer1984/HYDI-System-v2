/**
 * R0 daemon recovery entry point.
 *
 * Runs the same bounded self-repair the ops.recover_daemon_r0 capability
 * executes inside the daemon — reconciliation → classify → canonical
 * restart → post-recovery reconciliation → persisted attempt. Exists as a
 * standalone entry because a DOWN daemon cannot execute its own recovery
 * goal; this is the same module, same gates, same evidence path.
 *
 * Never kills processes, never steals locks. Exits:
 *   0 = VERIFIED or NO_ACTION or COOLDOWN
 *   2 = HUMAN_REQUIRED / REFUSED
 *   1 = FAILED / fatal
 *
 * Usage:  npx tsx scripts/recover-daemon-r0.ts
 */

import path from 'path';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { runR0Recovery } from '../lib/heidi/SelfRepairR0';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main(): Promise<void> {
  const repoDir = path.resolve(__dirname, '..');
  const pool = new Pool({
    host: process.env.PG_HOST || '127.0.0.1',
    port: parseInt(process.env.PG_PORT || '54322', 10),
    database: process.env.PG_DATABASE || 'postgres',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    max: 1,
  });

  try {
    const report = await runR0Recovery({ pool, repoDir });
    console.log(`[recover] state=${report.state} class=${report.failureClass} action=${report.action}`);
    console.log(`[recover] detail: ${report.detail}`);
    console.log(`[recover] attemptRowId: ${report.attemptRowId}`);
    if (report.postRecovery) {
      console.log(`[recover] post verdict=${report.postRecovery.verdict} identity=${report.postRecovery.deploymentIdentity}`);
    }
    process.exit(
      report.state === 'VERIFIED' || report.state === 'NO_ACTION' || report.state === 'COOLDOWN' ? 0
        : report.state === 'HUMAN_REQUIRED' || report.state === 'REFUSED' ? 2
          : 1,
    );
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[recover] fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
