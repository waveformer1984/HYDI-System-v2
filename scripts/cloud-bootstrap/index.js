#!/usr/bin/env node
'use strict';

/**
 * Cloud bootstrap orchestrator — "run locally, set up cloud services as we go."
 *
 * For each service module (supabase, stripe): verify() first; if not
 * already verified, attempt provision() once, then verify() again. Every run
 * is idempotent and safe to re-invoke — this is exactly what lets Heidi call
 * it repeatedly as an allowlisted `run_script` action (scripts/ is already an
 * approved directory in heidi-core/actions/action-executor.js) without any
 * executor changes.
 *
 * Usage:
 *   node scripts/cloud-bootstrap/index.js [--force] [--only=supabase,stripe]
 *
 * Exit code is 0 even when a service is 'blocked' — blocked means "a human
 * must act", not "this script failed". Exit code is 1 only on an internal
 * crash (a service module throwing instead of returning a result object).
 *
 * The `vercel` module was removed 2026-07-16 (Local-First execution plan,
 * Phase 0) — Vercel deployment is confirmed unused (see CLAUDE.md), so
 * there was nothing left for it to verify/provision.
 */

const path = require('path');
const { loadState, saveState, recordResult, planRuns, DEFAULT_STATE_PATH } = require('./state');

const SERVICES = {
  supabase: require('./supabase'),
  stripe: require('./stripe'),
};

function parseArgs(argv) {
  const force = argv.includes('--force');
  const onlyArg = argv.find((a) => a.startsWith('--only='));
  const only = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()) : null;
  return { force, only };
}

async function runOne(mod) {
  let result = await mod.verify();
  if (result.status === 'verified') return result;

  // Not verified yet — try to provision, then re-verify to confirm.
  const provisioned = await mod.provision();
  if (provisioned.status !== 'verified') return provisioned;

  const reverified = await mod.verify();
  return reverified;
}

async function main() {
  const { force, only } = parseArgs(process.argv.slice(2));
  const names = only && only.length ? only.filter((n) => SERVICES[n]) : Object.keys(SERVICES);

  let state = loadState();
  const toRun = planRuns(state, names, { force });
  const skipped = names.filter((n) => !toRun.includes(n));

  const summary = [];

  for (const name of skipped) {
    const rec = state.services[name];
    summary.push({ service: name, status: rec.status, detail: `(cached) ${rec.detail}` });
  }

  for (const name of toRun) {
    const mod = SERVICES[name];
    let result;
    try {
      result = await runOne(mod);
    } catch (error) {
      result = { status: 'failed', detail: `Module '${name}' threw: ${error instanceof Error ? error.message : 'unknown error'}` };
    }
    state = recordResult(state, name, result);
    summary.push({ service: name, ...result });
  }

  saveState(state);

  console.log('\n=== Cloud Bootstrap Summary ===');
  for (const row of summary) {
    const marker = row.status === 'verified' ? 'OK' : row.status === 'blocked' ? 'BLOCKED' : 'FAILED';
    console.log(`[${marker}] ${row.service}: ${row.detail}`);
    if (row.actionRequired) console.log(`         -> ACTION NEEDED: ${row.actionRequired}`);
  }
  console.log(`\nState recorded at ${path.relative(process.cwd(), DEFAULT_STATE_PATH)}`);

  const anyBlocked = summary.some((r) => r.status === 'blocked');
  const anyFailed = summary.some((r) => r.status === 'failed');
  if (anyFailed) process.exitCode = 0; // still 0: report, don't fail the caller
  if (anyBlocked) process.exitCode = 0;
}

if (require.main === module) {
  main().catch((error) => {
    console.error('[cloud-bootstrap] internal error:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}

module.exports = { main, runOne, SERVICES };
