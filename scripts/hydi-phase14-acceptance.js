#!/usr/bin/env node
'use strict';

/* eslint-disable no-console */

const { execSync } = require('child_process');
const path = require('path');

function run(command, options = {}) {
  try {
    const out = execSync(command, { stdio: 'pipe', ...options }).toString().trim();
    return { status: 0, out, err: '' };
  } catch (err) {
    const out = (err.stdout || '').toString().trim();
    const stderr = (err.stderr || '').toString().trim();
    return { status: err.status || 1, out, err: stderr };
  }
}

function section(title) {
  console.log('\n=== ' + title + ' ===');
}

async function main() {
  // Enforce local-first environment for the acceptance run.
  process.env.SUPABASE_URL = 'http://127.0.0.1:54321';
  process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'sb_secret_local';
  process.env.STRIPE_MODE = 'mock';
  process.env.OPENAI_API_KEY = '';
  process.env.ANTHROPIC_API_KEY = '';
  process.env.RESEND_API_KEY = '';

  section('PHASE 14 — HYDI System-Wide Operational Acceptance');

  section('0. Environment sanity');
  console.log('SUPABASE_URL =', process.env.SUPABASE_URL);
  console.log('STRIPE_MODE =', process.env.STRIPE_MODE);
  console.log('OPENAI_API_KEY =', process.env.OPENAI_API_KEY || '(empty)');

  section('1. Heidi readiness');
  const readiness = run('npm run hydi:readiness', { cwd: path.resolve(__dirname, '..') });
  console.log(readiness.out);
  if (readiness.status !== 0) {
    console.error('readiness failed:', readiness.err);
    process.exit(1);
  }

  section('2. Local health probes');
  const {
    LocalHealthProbes,
    HealthAggregator,
    HeidiExecutive,
  } = require('../src/heidi-executive');

  const heidi = new HeidiExecutive({ dataDir: path.resolve(__dirname, '..', 'data', 'phase14') });
  const health = new HealthAggregator();
  const probes = new LocalHealthProbes({ supabaseUrl: 'http://127.0.0.1:54321' });
  health.register('persistence', () => probes.persistence());
  health.register('postgres', () => probes.postgres());
  health.register('docker', () => probes.docker());
  health.register('ollama', () => probes.ollama());
  health.register('workers', () => probes.workers());
  health.register('controlPlane', () => probes.controlPlane());
  const healthResults = await health.inspectAll();
  for (const [k, v] of Object.entries(healthResults)) {
    console.log(`  ${k}: ${v.status} — ${v.detail}`);
  }

  section('3. Heidi-mediated health.read');
  const readResult = await heidi.run({ id: 'phase14-health-read', capabilityId: 'health.read', parameters: {} }, { id: 'phase14-runner' });
  console.log('  result:', readResult.status);

  section('4. Subsystem unit tests');
  const suites = [
    'tests/unit/rezonate.test.js',
    'tests/unit/checkout.test.js',
    'tests/unit/protoforge-policy-engine.test.js',
    'tests/unit/hydi-phase14-system-acceptance.test.js',
    'tests/unit/heidi-executive/control-plane.test.js',
    'tests/unit/heidi-executive/phase12-autonomous.test.js',
    'tests/unit/hydi-phase13-autonomous-acceptance.test.js',
    'tests/unit/persistence-guard.test.js',
    'tests/unit/no-hardcoded-secrets.test.js',
  ];
  for (const suite of suites) {
    const r = run(`npx jest ${suite} --runInBand`, { cwd: path.resolve(__dirname, '..') });
    const ok = r.status === 0;
    console.log(`  ${suite}: ${ok ? 'PASS' : 'FAIL'}`);
    if (!ok) {
      console.error(r.err || r.out);
      process.exit(1);
    }
  }

  section('5. Security negative tests');
  const denied = await heidi.run({ id: 'phase14-denied-shell', capabilityId: 'docker.local', parameters: { operation: 'exec', resource: 'supabase_inbucket' } }, { id: 'phase14-runner' }).catch(e => ({ status: 'FAILED', error: e.message }));
  console.log('  forbidden docker.local exec:', denied.status, denied.error || '');

  const unsupported = await heidi.run({ id: 'phase14-unsupported', capabilityId: 'health.recover', parameters: { service: 'some_bad_thing' } }, { id: 'phase14-runner' }).catch(e => ({ status: 'FAILED', error: e.message }));
  console.log('  unsupported health.recover:', unsupported.status, unsupported.error || '');

  section('6. Persistent audit');
  const audit = heidi.audit.query({ actor: 'phase14-runner' });
  console.log('  audit events:', audit.length);
  for (const e of audit) {
    console.log(`    - ${new Date(e.timestamp).toISOString()} ${e.capabilityId} ${e.resultingState}`);
  }

  console.log('\n=== PHASE 14 SYSTEM ACCEPTANCE: PASS ===\n');
}

main().catch(err => {
  console.error('ACCEPTANCE FAILED:', err.message);
  process.exit(1);
});
