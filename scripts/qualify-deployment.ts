/**
 * Deployment qualification gate.
 *
 * The ONLY sanctioned way to write .hydi-operational/qualified-deployment.json:
 * it runs full deployment reconciliation and writes the record only when the
 * runtime identity chain agrees end-to-end:
 *
 *   PM2 online → real process alive → lock owner is a PM2 descendant →
 *   canonical cwd → lock/cycle commit == expected HEAD → fresh cycle
 *   carries the lock owner's pid+commit
 *
 * A stale orphan, a mismatched commit, or an unobservable predicate refuses
 * qualification with a non-zero exit and prints the failed predicates.
 *
 * Usage:  npx tsx scripts/qualify-deployment.ts [--note "reason"]
 */

import path from 'path';
import fs from 'fs';
import dotenv from 'dotenv';
import { Pool } from 'pg';
import { collectReconciliation, resolveGitHead } from '../lib/heidi/DeploymentReconciliation';

dotenv.config({ path: path.resolve(__dirname, '../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function main(): Promise<void> {
  const repoDir = path.resolve(__dirname, '..');
  const noteIdx = process.argv.indexOf('--note');
  const note = noteIdx >= 0 ? process.argv[noteIdx + 1] : undefined;

  const pool = new Pool({
    host: process.env.PG_HOST || '127.0.0.1',
    port: parseInt(process.env.PG_PORT || '54322', 10),
    database: process.env.PG_DATABASE || 'postgres',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    max: 1,
  });

  try {
    const head = resolveGitHead(repoDir);
    console.log(`[qualify] git HEAD: ${head}`);

    // expectedCommit = the canonical tree's HEAD (deployment intent) —
    // the qualified file can't be the baseline for its own rewrite.
    const report = await collectReconciliation({ pool, repoDir, expectedCommit: head ?? undefined });

    console.log(`[qualify] verdict=${report.verdict} deploymentIdentity=${report.deploymentIdentity} applicationHealth=${report.applicationHealth}`);
    for (const [k, v] of Object.entries(report.predicates)) {
      console.log(`  ${v === true ? 'PASS' : v === false ? 'FAIL' : 'UNOBSERVABLE'}  ${k}`);
    }
    console.log(`[qualify] expected=${JSON.stringify(report.expected)}`);
    console.log(`[qualify] actual  =${JSON.stringify(report.actual)}`);

    if (report.verdict !== 'QUALIFIED') {
      console.error(`[qualify] NOT QUALIFIED — ${report.failures.join(', ') || 'predicates unobservable'}`);
      process.exit(2);
    }

    const file = path.join(repoDir, '.hydi-operational', 'qualified-deployment.json');
    const record = {
      deployedHead: head,
      branch: 'clean-main',
      repository: repoDir,
      deployedAt: new Date().toISOString(),
      pm2Process: 'hydi-daemon',
      pm2Pid: report.expected.pm2Pid,
      daemonPid: report.actual.lockPid,
      qualifiedBy: note ?? 'ops.reconcile_deployment — full runtime identity chain verified',
      previousQualifiedHead: (() => {
        try { return (JSON.parse(fs.readFileSync(file, 'utf8')) as { deployedHead?: string }).deployedHead ?? null; }
        catch { return null; }
      })(),
    };
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, JSON.stringify(record, null, 2) + '\n');
    console.log(`[qualify] QUALIFIED — wrote ${file}`);
  } finally {
    await pool.end();
  }
}

main().catch((e) => {
  console.error('[qualify] fatal:', e instanceof Error ? e.message : e);
  process.exit(1);
});
