#!/usr/bin/env node
'use strict';

const os = require('os');
const path = require('path');
const fs = require('fs').promises;

const LifecycleRegistry = require('../src/hydi-v3/LifecycleRegistry');
const CompatibilityManager = require('../src/hydi-v3/CompatibilityManager');
const SnapshotManager = require('../src/hydi-v3/SnapshotManager');
const PluginRuntime = require('../src/hydi-v3/PluginRuntime');
const DeploymentManifest = require('../src/hydi-v3/DeploymentManifest');
const UpgradeManager = require('../src/hydi-v3/UpgradeManager');
const LifecycleDashboard = require('../src/hydi-v3/LifecycleDashboard');

const silent = { log: () => {}, error: () => {}, warn: () => {} };
const reportPath = path.resolve(__dirname, '../reports/business-os/phase39-lifecycle-report.md');

function assert(ok, message) {
  if (!ok) throw new Error(message);
}

async function tmpDir() {
  return path.join(os.tmpdir(), `hydi-p39-${Date.now()}-${Math.random().toString(36).slice(2)}`);
}

async function lifecycleTest() {
  const registry = new LifecycleRegistry({ logger: silent });
  registry.setHealth('Kernel', 'healthy');
  const health = registry.healthReport();
  assert(health.total >= 10, 'Registry should contain default subsystems');
  assert(registry.get('Kernel').health === 'healthy', 'Registry health should update');
  return { passed: true, summary: health };
}

async function upgradeTest() {
  const registry = new LifecycleRegistry({ logger: silent });
  const dataPath = await tmpDir();
  await fs.mkdir(dataPath, { recursive: true });
  const snapshotManager = await new SnapshotManager({ dataPath, registry, logger: silent }).start();
  const compatibility = new CompatibilityManager({ registry });
  const upgrade = new UpgradeManager({ registry, snapshotManager, compatibilityManager: compatibility, logger: silent });
  const candidate = { name: 'Kernel', current: '1.0.0', proposed: '1.0.1', phase: 34 };
  const result = await upgrade.runUpgrade(candidate);
  assert(result.success, `Upgrade lifecycle should pass: ${JSON.stringify(result.report)}`);
  assert(registry.get('Kernel').version === '1.0.1', 'Kernel should be upgraded');
  await fs.rm(dataPath, { recursive: true, force: true });
  return { passed: true, version: registry.get('Kernel').version };
}

async function rollbackTest() {
  const registry = new LifecycleRegistry({ logger: silent });
  const dataPath = await tmpDir();
  await fs.mkdir(dataPath, { recursive: true });
  const snapshotManager = await new SnapshotManager({ dataPath, registry, logger: silent }).start();
  const compatibility = new CompatibilityManager({ registry });
  const upgrade = new UpgradeManager({ registry, snapshotManager, compatibilityManager: compatibility, logger: silent });

  // snapshot baseline
  await snapshotManager.create('baseline');

  // block the upgrade
  compatibility.rules.push({ component: 'Kernel', blocked: ['1.0.1'], reason: 'test_block' });
  const candidate = { name: 'Kernel', current: '1.0.0', proposed: '1.0.1', phase: 34 };
  const result = await upgrade.runUpgrade(candidate, { autoRollback: true });
  assert(!result.success, 'Blocked upgrade should fail');
  assert(registry.get('Kernel').version === '1.0.0', 'Kernel should remain at baseline version');
  await fs.rm(dataPath, { recursive: true, force: true });
  return { passed: true, restoredVersion: registry.get('Kernel').version };
}

async function pluginSecurityTest() {
  const runtime = new PluginRuntime({ logger: silent });
  runtime.register({ name: 'safe-plugin', version: '1.0.0', permissions: { filesystem: true, network: false } });
  const allowed = runtime.execute('safe-plugin', 'filesystem', 'read');
  const denied = runtime.execute('safe-plugin', 'network', 'request');
  assert(allowed.success, 'Allowed permission should succeed');
  assert(!denied.success && denied.error.includes('permission_denied'), 'Denied permission should fail closed');
  assert(!runtime.hasPermission('missing-plugin', 'filesystem'), 'Unknown plugin should have no permissions');
  return { passed: true, allowed, denied };
}

async function deploymentRebuildTest() {
  const dataPath = await tmpDir();
  await fs.mkdir(dataPath, { recursive: true });
  const manifestPath = path.join(dataPath, 'manifest.json');

  const source = new LifecycleRegistry({ logger: silent });
  source.setHealth('Kernel', 'healthy');
  const manifest = DeploymentManifest.fromRegistry(source, {
    runtimeVersions: { node: process.version },
    services: ['api', 'worker'],
    ports: { api: 3000, worker: 4000 },
    models: ['mock/fast'],
    databases: ['supabase'],
    environment: { NODE_ENV: 'test' },
    agents: { planner: true },
    plugins: [{ name: 'safe-plugin', version: '1.0.0' }],
    configuration: { autonomous: false },
  });
  assert(manifest.validate().valid, 'Manifest should validate');
  await manifest.write(manifestPath);

  const rebuilt = await DeploymentManifest.fromFile(manifestPath);
  const target = new LifecycleRegistry({ logger: silent });
  await rebuilt.bootstrap(target);
  const verify = await rebuilt.verify(target);
  assert(verify.ok, `Deployment rebuild should match manifest: ${JSON.stringify(verify)}`);

  await fs.rm(dataPath, { recursive: true, force: true });
  return { passed: true, componentCount: target.list().length };
}

async function runAll() {
  const results = {};
  const sections = [];

  const lifecycle = await lifecycleTest();
  results.lifecycle = lifecycle;
  sections.push({ title: 'Lifecycle Registry', passed: true, detail: lifecycle.summary });

  const upgrade = await upgradeTest();
  results.upgrade = upgrade;
  sections.push({ title: 'Upgrade Simulation', passed: true, detail: upgrade });

  const rollback = await rollbackTest();
  results.rollback = rollback;
  sections.push({ title: 'Rollback Test', passed: true, detail: rollback });

  const plugin = await pluginSecurityTest();
  results.plugin = plugin;
  sections.push({ title: 'Plugin Security', passed: true, detail: plugin });

  const rebuild = await deploymentRebuildTest();
  results.rebuild = rebuild;
  sections.push({ title: 'Deployment Rebuild', passed: true, detail: rebuild });

  const registry = new LifecycleRegistry({ logger: silent });
  const snapshotManager = await new SnapshotManager({ dataPath: await tmpDir(), registry, logger: silent }).start();
  const dashboard = new LifecycleDashboard({ registry, snapshotManager });
  const report = await dashboard.fullReport();
  results.dashboard = report;
  sections.push({ title: 'Lifecycle Dashboard', passed: true, detail: report });
  await fs.rm(snapshotManager.store.dataPath, { recursive: true, force: true });

  const overall = { overall: 'PASS', results, sections };
  console.log(JSON.stringify(overall, null, 2));

  let md = '# Phase 39 — Lifecycle Operating System Acceptance Report\n\n';
  md += `Generated: ${new Date().toISOString()}\n\n`;
  md += `Overall: **PASS**\n\n`;
  for (const section of sections) {
    md += `## ${section.title}\n\n`;
    md += `- Status: PASS\n`;
    md += `- Detail: \`\`\`json\n${JSON.stringify(section.detail, null, 2)}\n\`\`\`\n\n`;
  }
  await fs.writeFile(reportPath, md, 'utf8');
  return overall;
}

async function main() {
  const mode = process.argv[2] || 'all';
  try {
    switch (mode) {
      case 'lifecycle': {
        const r = await lifecycleTest();
        console.log(JSON.stringify(r, null, 2));
        process.exit(r.passed ? 0 : 1);
      }
      case 'upgrade': {
        const r = await upgradeTest();
        console.log(JSON.stringify(r, null, 2));
        process.exit(r.passed ? 0 : 1);
      }
      case 'rollback': {
        const r = await rollbackTest();
        console.log(JSON.stringify(r, null, 2));
        process.exit(r.passed ? 0 : 1);
      }
      case 'plugin-security': {
        const r = await pluginSecurityTest();
        console.log(JSON.stringify(r, null, 2));
        process.exit(r.passed ? 0 : 1);
      }
      case 'deployment-rebuild': {
        const r = await deploymentRebuildTest();
        console.log(JSON.stringify(r, null, 2));
        process.exit(r.passed ? 0 : 1);
      }
      case 'all':
      default: {
        const r = await runAll();
        process.exit(r.overall === 'PASS' ? 0 : 1);
      }
    }
  } catch (e) {
    console.error(JSON.stringify({ overall: 'FAIL', error: e instanceof Error ? e.message : String(e) }, null, 2));
    process.exit(1);
  }
}

main();
