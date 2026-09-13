#!/usr/bin/env node
'use strict';
/**
 * Job-claim concurrency qualification.
 * ---------------------------------------------------------------------------
 * Proves the invariant introduced in JobManager.claimNextQueuedJob():
 *
 *   Multiple pollers may observe the queue, but exactly one can CLAIM a job.
 *
 * Why this is not a unit test: an in-process mock cannot demonstrate anything
 * about cross-process concurrency, and an application-level mutex would not
 * have protected the real system either — the duplicate pollers observed on
 * 2026-09-10 were separate OS processes. This harness therefore spawns real
 * child processes against a real PostgreSQL.
 *
 * Safety: everything runs inside an isolated schema (hydi_claim_test) with
 * search_path pointed at it. public.customer_jobs is never read or written.
 * The statement under test is imported from lib/revenue/JobManager.ts, so this
 * exercises the exact SQL production runs, not a copy.
 *
 * Usage:  node scripts/qualify-job-claim-concurrency.js [--workers N] [--keep]
 */

const { Pool } = require('pg');
const { spawn } = require('child_process');
const path = require('path');

const SCHEMA = 'hydi_claim_test';
const ROOT = path.resolve(__dirname, '..');

const DB = {
  host: process.env.PG_HOST || '127.0.0.1',
  port: parseInt(process.env.PG_PORT || '54322', 10),
  database: process.env.PG_DATABASE || 'postgres',
  user: process.env.PG_USER || 'postgres',
  password: process.env.PG_PASSWORD || 'postgres',
};

const argv = process.argv.slice(2);
const WORKERS = (() => {
  const i = argv.indexOf('--workers');
  return i >= 0 ? parseInt(argv[i + 1], 10) : 3;
})();
const KEEP = argv.includes('--keep');

// ---------------------------------------------------------------------------
// Worker mode: one child process attempts a single claim, prints a verdict.
// ---------------------------------------------------------------------------
async function runAsWorker() {
  const label = argv[argv.indexOf('--worker') + 1] || 'worker';
  const barrierMs = parseInt(process.env.CLAIM_BARRIER_AT || '0', 10);

  // The production statement itself — not a copy — so this cannot drift.
  const { CLAIM_NEXT_QUEUED_JOB_SQL } = require('../lib/revenue/JobManager');

  const pool = new Pool({ ...DB, options: `-c search_path=${SCHEMA}` });
  try {
    // Barrier: all workers fire as close to simultaneously as possible.
    const wait = barrierMs - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    const res = await pool.query(CLAIM_NEXT_QUEUED_JOB_SQL, [new Date().toISOString()]);
    process.stdout.write(
      res.rows.length > 0
        ? `${label}=CLAIMED:${res.rows[0].job_id}\n`
        : `${label}=NOT_CLAIMED\n`
    );
  } catch (e) {
    process.stdout.write(`${label}=ERROR:${e.message}\n`);
    process.exitCode = 2;
  } finally {
    await pool.end();
  }
}

// ---------------------------------------------------------------------------
// Coordinator
// ---------------------------------------------------------------------------
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => console.log(`  ✗ ${m}`);

async function main() {
  const admin = new Pool(DB);
  let failures = 0;

  const publicBefore = await admin.query(
    "select (select count(*) from public.customer_jobs)::int j, (select count(*) from public.customer_job_events)::int e, (select count(*) from public.customer_jobs where job_status='queued')::int q, (select count(*) from public.customer_jobs where job_status='executing')::int x"
  );
  const pb = publicBefore.rows[0];
  console.log(`\npublic.customer_jobs BEFORE: jobs=${pb.j} events=${pb.e} queued=${pb.q} executing=${pb.x}`);

  console.log(`\n=== fixture: isolated schema ${SCHEMA} ===`);
  await admin.query(`DROP SCHEMA IF EXISTS ${SCHEMA} CASCADE`);
  await admin.query(`CREATE SCHEMA ${SCHEMA}`);
  await admin.query(`
    CREATE TABLE ${SCHEMA}.customer_jobs (
      job_id text primary key,
      job_status text not null,
      execution_status text,
      execution_started_at timestamptz,
      paid_at timestamptz,
      updated_at timestamptz
    )`);
  await admin.query(`
    CREATE TABLE ${SCHEMA}.customer_job_events (
      id bigserial primary key,
      job_id text not null,
      event_type text,
      actor text,
      from_state text,
      to_state text,
      details jsonb,
      created_at timestamptz default now()
    )`);
  ok(`schema ${SCHEMA} created (public schema untouched)`);

  // ---- Test E1: N concurrent worker processes, ONE queued job ----
  console.log(`\n=== Test E1: ${WORKERS} concurrent worker processes, 1 queued job ===`);
  await admin.query(
    `INSERT INTO ${SCHEMA}.customer_jobs (job_id, job_status, paid_at) VALUES ('fixture-job-1','queued', now())`
  );

  const barrier = Date.now() + 1500;
  const results = await Promise.all(
    Array.from({ length: WORKERS }, (_, i) =>
      runWorker(`worker${String.fromCharCode(65 + i)}`, barrier)
    )
  );
  results.forEach((r) => console.log(`    ${r}`));

  const claimed = results.filter((r) => r.includes('=CLAIMED'));
  const notClaimed = results.filter((r) => r.includes('=NOT_CLAIMED'));
  const errored = results.filter((r) => r.includes('=ERROR'));

  if (errored.length) { bad(`${errored.length} worker(s) errored`); failures++; }
  if (claimed.length === 1) ok(`exactly 1 worker claimed the job (${claimed[0]})`);
  else { bad(`expected exactly 1 CLAIMED, got ${claimed.length}`); failures++; }
  if (notClaimed.length === WORKERS - 1) ok(`the other ${notClaimed.length} worker(s) got NOT_CLAIMED`);
  else { bad(`expected ${WORKERS - 1} NOT_CLAIMED, got ${notClaimed.length}`); failures++; }

  const after = await admin.query(
    `SELECT job_status, execution_status FROM ${SCHEMA}.customer_jobs WHERE job_id='fixture-job-1'`
  );
  if (after.rows[0].job_status === 'executing' && after.rows[0].execution_status === 'running') {
    ok("the claimed job transitioned to executing/running exactly once");
  } else { bad(`unexpected final state: ${JSON.stringify(after.rows[0])}`); failures++; }

  // ---- Test E2: SKIP LOCKED must not block behind an in-flight claim ----
  console.log('\n=== Test E2: a locked row is skipped, not waited on ===');
  await admin.query(`UPDATE ${SCHEMA}.customer_jobs SET job_status='queued', execution_status=null WHERE job_id='fixture-job-1'`);

  const holder = new Pool({ ...DB, options: `-c search_path=${SCHEMA}` });
  const client = await holder.connect();
  await client.query('BEGIN');
  await client.query(`SELECT job_id FROM customer_jobs WHERE job_status='queued' ORDER BY paid_at ASC LIMIT 1 FOR UPDATE`);

  const t0 = Date.now();
  const blocked = await runWorker('workerLOCKED', Date.now());
  const elapsed = Date.now() - t0;

  await client.query('ROLLBACK');
  client.release();
  await holder.end();

  if (blocked.includes('=NOT_CLAIMED')) ok(`a claimer facing a locked row returned NOT_CLAIMED in ${elapsed}ms instead of blocking`);
  else { bad(`expected NOT_CLAIMED while the row was locked, got: ${blocked}`); failures++; }

  // ---- Test E3: an empty queue yields no claim ----
  console.log('\n=== Test E3: empty queue ===');
  await admin.query(`UPDATE ${SCHEMA}.customer_jobs SET job_status='delivered' WHERE job_id='fixture-job-1'`);
  const empty = await runWorker('workerEMPTY', Date.now());
  if (empty.includes('=NOT_CLAIMED')) ok('an empty queue yields NOT_CLAIMED (no fabricated job)');
  else { bad(`expected NOT_CLAIMED on empty queue, got: ${empty}`); failures++; }

  // ---- cleanup + public-schema safety proof ----
  if (!KEEP) {
    await admin.query(`DROP SCHEMA ${SCHEMA} CASCADE`);
    ok(`schema ${SCHEMA} dropped`);
  }

  const publicAfter = await admin.query(
    "select (select count(*) from public.customer_jobs)::int j, (select count(*) from public.customer_job_events)::int e, (select count(*) from public.customer_jobs where job_status='queued')::int q, (select count(*) from public.customer_jobs where job_status='executing')::int x"
  );
  const pa = publicAfter.rows[0];
  console.log(`\npublic.customer_jobs AFTER:  jobs=${pa.j} events=${pa.e} queued=${pa.q} executing=${pa.x}`);
  if (pa.j === pb.j && pa.e === pb.e && pa.q === 0 && pa.x === 0) {
    ok('public.customer_jobs and customer_job_events are byte-for-byte unchanged; queued=0 executing=0');
  } else { bad('public schema changed — this must never happen'); failures++; }

  await admin.end();

  console.log(`\n${failures === 0 ? 'PASS' : 'FAIL'} — job-claim concurrency qualification (${failures} failure(s))\n`);
  process.exit(failures === 0 ? 0 : 1);
}

function runWorker(label, barrier) {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      ['-r', path.join(ROOT, 'scripts', 'babel-register.js'), __filename, '--worker', label],
      { cwd: ROOT, env: { ...process.env, CLAIM_BARRIER_AT: String(barrier) }, windowsHide: true }
    );
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', () => {});
    child.on('close', () => resolve(out.trim() || `${label}=NO_OUTPUT`));
  });
}

if (argv.includes('--worker')) {
  runAsWorker().catch((e) => { console.error('worker error:', e); process.exit(2); });
} else {
  main().catch((e) => { console.error('harness error:', e); process.exit(3); });
}
