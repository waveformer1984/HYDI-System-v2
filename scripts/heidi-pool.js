#!/usr/bin/env node
'use strict';

/**
 * HEIDI specialist pool — single-process async clones over ExecutionGateway.
 * PM2: heidi-pool
 */

const { SpecialistPool } = require('../lib/dev-workforce/pool');
const { createTaskStore } = require('../lib/execution-fabric/task-store');
const { ExecutionGateway } = require('../lib/execution-fabric/gateway');

const TICK_MS = Number(process.env.POOL_TICK_MS || 3000);

function buildPool() {
  const store = createTaskStore({ mode: process.env.EXECUTION_FABRIC_PERSIST || 'memory' });
  const gateway = new ExecutionGateway({ store, skipRecovery: true });
  return new SpecialistPool({ store, gateway });
}

async function tick(pool) {
  try {
    await pool.runWorkersOnce();
  } catch (e) {
    console.error('[heidi-pool] tick error:', e instanceof Error ? e.message : e);
  }
}

async function main() {
  const pool = buildPool();
  const arg = process.argv.find((a) => a.startsWith('--mission='));
  if (arg) {
    const text = arg.slice('--mission='.length);
    const r = await pool.enqueueMission({ text });
    console.log(JSON.stringify(r));
    process.exit(r.ok ? 0 : 1);
  }
  console.log(`[heidi-pool] up — tick ${TICK_MS}ms POOL_MAX_CLONES=${process.env.POOL_MAX_CLONES || 12}`);
  await tick(pool);
  setInterval(() => {
    tick(pool);
  }, TICK_MS);
}

main().catch((e) => {
  console.error('[heidi-pool] fatal:', e);
  process.exit(1);
});