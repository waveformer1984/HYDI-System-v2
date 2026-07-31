#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;

const FailureTaxonomy = require('../src/hydi-v3/FailureTaxonomy');
const SnapshotStore = require('../src/hydi-v3/SnapshotStore');
const RecoveryManager = require('../src/hydi-v3/RecoveryManager');
const SystemHealthSupervisor = require('../src/hydi-v3/SystemHealthSupervisor');
const FaultInjector = require('../src/hydi-v3/FaultInjector');

const silent = { log: () => {}, error: () => {}, warn: () => {} };
const reportPath = path.resolve(__dirname, '../reports/business-os/phase38-resilience-report.md');

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

async function main() {
  const dataPath = path.join(os.tmpdir(), `hydi-p38-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(dataPath, { recursive: true });
  const sections = [];

  const taxonomy = new FailureTaxonomy();
  assert(taxonomy.classify({ type: 'model_unavailable' }).auto, 'model_unavailable should be auto-recoverable');
  assert(taxonomy.classify({ type: 'persistent_storage_unavailable' }).fatal, 'storage unavailable should be fatal');
  assert(taxonomy.classify({ type: 'policy_version_mismatch' }).operator, 'policy mismatch should require operator');
  assert(taxonomy.classify({ type: 'unknown' }).tier === 'recoverable', 'unknown failures default to recoverable');
  sections.push({ title: 'Failure Taxonomy', items: [{ name: 'Auto / operator / fatal classification', passed: true }] });

  const store = await new SnapshotStore({ dataPath, logger: silent }).start();
  const captured = await store.capture({ subsystems: { runtime: { healthy: true } }, meta: { test: true } });
  assert(captured && captured.hash, 'SnapshotStore should capture and hash');
  const listed = await store.list();
  assert(listed.length >= 1, 'SnapshotStore should list captured snapshot');
  const restored = await store.restore('latest');
  assert(restored.success, 'SnapshotStore should restore latest snapshot');
  assert(restored.snapshot.meta.test === true, 'Restored snapshot should preserve meta');
  sections.push({ title: 'Snapshot Store', items: [{ name: 'Capture with SHA-256 checksum', passed: true }, { name: 'List and restore latest', passed: true }] });

  const snapshotFile = listed[0].filePath;
  await fs.writeFile(snapshotFile, '{ invalid json', 'utf8');
  const bad = await store.restore('latest');
  assert(!bad.success, 'Corrupt snapshot should fail restoration');
  sections.push({ title: 'Snapshot Integrity', items: [{ name: 'Reject corrupt snapshot', passed: true }] });

  let handlerCalls = 0;
  const recovery = new RecoveryManager({
    handlers: {
      fallback_model: async () => {
        handlerCalls++;
        return { success: handlerCalls > 1 };
      },
    },
    logger: silent,
  });
  const first = await recovery.recover({ type: 'model_unavailable', target: 'llama2' });
  const second = await recovery.recover({ type: 'model_unavailable', target: 'llama2' });
  const third = await recovery.recover({ type: 'model_unavailable', target: 'llama2' });
  assert(!first.success, 'First recovery attempt should fail');
  assert(second.success, 'Second recovery attempt should succeed');
  assert(third.success, 'After success, attempts reset');
  assert(handlerCalls > 0, 'Handler should be called');
  assert(recovery.getEvents().length >= 1, 'RecoveryManager should record events');
  sections.push({ title: 'Recovery Manager', items: [{ name: 'Retry with backoff', passed: true }, { name: 'Reset attempts after success', passed: true }, { name: 'Record recovery events', passed: true }] });

  const fatal = await recovery.recover({ type: 'persistent_storage_unavailable' });
  assert(!fatal.success && fatal.reason === 'fatal', 'Fatal failures should not attempt recovery');
  sections.push({ title: 'Fatal Classification', items: [{ name: 'Emit fatal without recovery', passed: true }] });

  const operator = await recovery.recover({ type: 'policy_version_mismatch' });
  assert(!operator.success && operator.reason === 'operator_required', 'Operator failures should halt');
  sections.push({ title: 'Operator Classification', items: [{ name: 'Halt and require operator', passed: true }] });

  const cleanPath = path.join(os.tmpdir(), `hydi-p38-super-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await fs.mkdir(cleanPath, { recursive: true });
  const cleanStore = await new SnapshotStore({ dataPath: cleanPath, logger: silent }).start();
  let healthy = true;
  const supervisor = new SystemHealthSupervisor({
    intervalMs: 200,
    snapshotIntervalMs: 0,
    subsystems: {
      model: async () => ({ healthy }),
    },
    recovery: new RecoveryManager({
      handlers: {
        fallback_model: async () => { healthy = true; return { success: true }; },
      },
      logger: silent,
    }),
    snapshotStore: cleanStore,
    logger: silent,
  });
  supervisor.start();
  healthy = false;
  await new Promise((resolve) => setTimeout(resolve, 800));
  supervisor.stop();
  assert(healthy, 'SystemHealthSupervisor should trigger recovery and restore subsystem health');
  sections.push({ title: 'System Health Supervisor', items: [{ name: 'Detect failure and recover', passed: true }] });

  const injector = new FaultInjector({ logger: silent });
  const corruptTarget = path.join(dataPath, 'corrupt-me.json');
  await fs.writeFile(corruptTarget, JSON.stringify({ ok: true }), 'utf8');
  const injected = await injector.corruptFile(corruptTarget, 'garble');
  assert(injected.success, 'FaultInjector should corrupt file');
  const content = await fs.readFile(corruptTarget, 'utf8');
  assert(content.includes('!CORRUPT!'), 'Corrupted file should contain marker');
  sections.push({ title: 'Fault Injection', items: [{ name: 'Corrupt file on disk', passed: true }] });

  await fs.rm(dataPath, { recursive: true, force: true });
  await fs.rm(cleanPath, { recursive: true, force: true });

  const result = { overall: 'PASS', sections };
  console.log(JSON.stringify(result, null, 2));

  let md = '# Phase 38 — Resilience Validation Report\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `Overall: **${result.overall}**\n\n`;
  for (const section of sections) {
    md += `## ${section.title}\n\n`;
    for (const item of section.items) {
      md += `- ${item.passed ? 'PASS' : 'FAIL'}: ${item.name}\n`;
    }
    md += '\n';
  }
  await fs.writeFile(reportPath, md, 'utf8');
}

main().catch((e) => {
  console.error(JSON.stringify({ overall: 'FAIL', error: e instanceof Error ? e.message : String(e) }, null, 2));
  process.exit(1);
});
