#!/usr/bin/env node
'use strict';

/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

function run(file, args, timeout = 30000) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout }, (err, stdout, stderr) => {
      if (err) {
        err.stderr = stderr;
        reject(err);
      } else {
        resolve(stdout.trim());
      }
    });
  });
}

async function probeInbucket() {
  try {
    const out = await run('docker', ['ps', '--filter', 'name=supabase_inbucket_HYDI-System-v2', '--format', '{{.Names}}:{{.Status}}']);
    if (out.includes('Up')) return { status: 'HEALTHY', detail: out };
    if (out.includes('Exited') || out.includes('Restarting')) return { status: 'UNAVAILABLE', detail: out };
    return { status: 'UNAVAILABLE', detail: out || 'not found' };
  } catch (err) {
    return { status: 'UNAVAILABLE', detail: err.stderr || err.message };
  }
}

async function main() {
  const {
    HeidiExecutive,
    HealthAggregator,
    LocalHealthProbes,
    LocalRecoveryWorkflow,
  } = require('../src/heidi-executive');

  // Ensure no cloud dependencies are in use for this local acceptance.
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_local';
  process.env.STRIPE_MODE = 'mock';
  process.env.OPENAI_API_KEY = '';
  process.env.ANTHROPIC_API_KEY = '';
  process.env.RESEND_API_KEY = '';

  const dataDir = path.resolve(__dirname, '..', 'data', 'phase13');
  fs.mkdirSync(dataDir, { recursive: true });

  const heidi = new HeidiExecutive({ dataDir });
  const health = new HealthAggregator();
  const probes = new LocalHealthProbes({
    supabaseUrl: 'http://127.0.0.1:54321',
    execFile: (file, args, timeout) => run(file, args, timeout),
  });

  health.register('inbucket', async () => probes.inbucket());
  const workflow = new LocalRecoveryWorkflow(heidi, health, 'supabase_inbucket');
  workflow.setHealthName('inbucket');

  console.log('\n=== PHASE 13 — HEALTHY_INBUCKET ACCEPTANCE ===\n');

  const before = await workflow.probe();
  console.log('1. initial health:', before);
  if (before.status !== 'HEALTHY') {
    console.error('ABORT: inbucket is not healthy at start. Make sure local Supabase is running.');
    process.exit(1);
  }

  console.log('2. stopping supabase_inbucket...');
  try {
    await run('docker', ['stop', 'supabase_inbucket_HYDI-System-v2']);
  } catch (err) {
    console.error('ABORT: could not stop inbucket:', err.stderr || err.message);
    process.exit(1);
  }

  await new Promise(r => setTimeout(r, 1000));
  const during = await workflow.probe();
  console.log('3. stopped health:', during);
  if (during.status !== 'UNAVAILABLE') {
    console.error('ABORT: inbucket did not become unavailable after stop.');
    process.exit(1);
  }

  console.log('4. authorizing and executing recovery...');
  const result = await workflow.recover({ id: 'phase13-acceptance' });
  console.log('5. recovery result:', result.status);
  console.log('   health-before:', result.before);
  console.log('   health-after:', result.after);
  if (result.status !== 'RECOVERED' || result.after.status !== 'HEALTHY') {
    console.error('ABORT: recovery did not restore health.');
    process.exit(1);
  }

  console.log('6. idempotency check...');
  const second = await workflow.recover({ id: 'phase13-acceptance' });
  console.log('   second result:', second.status);

  console.log('7. persistent audit records:');
  const audit = heidi.audit.query({ capabilityId: 'health.recover' });
  for (const entry of audit) {
    console.log('   -', new Date(entry.timestamp).toISOString(), entry.taskId, entry.resultingState, 'actor=' + entry.actor);
  }

  console.log('8. prove records survive a new process...');
  const freshHeidi = new HeidiExecutive({ dataDir });
  const freshAudit = freshHeidi.audit.query({ capabilityId: 'health.recover' });
  console.log('   recovered events:', freshAudit.length);

  if (freshAudit.length === 0) {
    console.error('ABORT: audit records did not survive process restart.');
    process.exit(1);
  }

  console.log('\n=== PHASE 13 ACCEPTANCE: PASS ===\n');
}

main().catch(err => {
  console.error('ACCEPTANCE FAILED:', err.message);
  process.exit(1);
});
