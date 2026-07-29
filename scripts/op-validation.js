#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');
const SoakHarness = require('../src/hydi-v3/SoakHarness');
const ResourceAuditor = require('../src/hydi-v3/ResourceAuditor');
const PerformanceBaseline = require('../src/hydi-v3/PerformanceBaseline');
const ArchitectureGuard = require('../src/hydi-v3/ArchitectureGuard');
const FederationGateway = require('../src/hydi-v3/FederationGateway');
const CapabilitySandbox = require('../src/hydi-v3/CapabilitySandbox');
const NodeScheduler = require('../src/hydi-v3/NodeScheduler');
const RecoveryCoordinator = require('../src/hydi-v3/RecoveryCoordinator');
const MarketplaceManager = require('../src/hydi-v3/MarketplaceManager');

const outputPath = path.join(__dirname, '..', 'data', 'op-validation.json');

async function main() {
  const baseline = new PerformanceBaseline({
    operations: {
      startup: async () => {
        const guard = new ArchitectureGuard({ projectRoot: process.cwd() });
        const r = guard.verify();
        return { score: r.score, ms: r.duration };
      },
      federation: async () => {
        const g = new FederationGateway();
        return { contracts: g.serviceContract.list().length };
      },
      marketplace: async () => {
        const s = new CapabilitySandbox();
        s.registerCapability({ id: 'v-cap', version: '1.0.0', requiredPermissions: { network: ['connect'] } });
        const out = s.executeCapability('v-cap', 'network', 'connect');
        return { ok: out.success };
      },
      scheduling: async () => {
        const n = new NodeScheduler();
        const out = n.schedule({ taskId: 't1', capability: 'x' }, { nodes: [{ id: 'a', score: 1, capabilities: ['x'] }] });
        return { node: out ? out.nodeId : null };
      },
      recovery: async () => {
        const rc = new RecoveryCoordinator();
        rc.registerStrategy('noop', () => ({ success: true }));
        const s = rc.selectStrategy({ id: 'c', rootCause: 'db', confidence: 0.9 });
        return { strategy: s ? s.name : null };
      },
      snapshot: async () => {
        const file = path.join(__dirname, '..', 'data', 'validation-snapshot.json');
        fs.writeFileSync(file, JSON.stringify({ at: Date.now(), ok: true }));
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        return { readMs: data.ok ? 0 : 1 };
      },
      throughput: async () => {
        const guard = new ArchitectureGuard({ projectRoot: process.cwd() });
        const start = Date.now();
        let n = 0;
        while (Date.now() - start < 250) {
          guard.verify();
          n += 1;
        }
        return { runs: n };
      },
    },
  });

  const before = new ResourceAuditor().snapshot('before');

  const soak = new SoakHarness({
    durationMs: process.env.SOAK_MS ? parseInt(process.env.SOAK_MS, 10) : 120000,
    maxIterations: process.env.SOAK_ITERS ? parseInt(process.env.SOAK_ITERS, 10) : 500,
    cooldownMs: 5,
  });
  const soakReport = await soak.run([
    'federationJoinLeave',
    'snapshotRestore',
    'marketplaceInstallRemove',
    'crashRecover',
  ]);

  const after = new ResourceAuditor().snapshot('after');
  const leakCheck = new ResourceAuditor().checkLeak(before, after, {
    heapGrowthBytes: 5 * 1024 * 1024,
    handlesGrowth: 10,
    requestsGrowth: 10,
    listenersGrowth: 10,
  });

  const baselineReport = await baseline.capture(5);

  const report = {
    ts: Date.now(),
    soak: soakReport,
    leak: {
      ok: leakCheck.ok,
      diff: leakCheck.diff,
      leaks: leakCheck.leaks,
    },
    baseline: baselineReport,
  };

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
  fs.unlinkSync(path.join(__dirname, '..', 'data', 'validation-snapshot.json'));

  console.log(`Operational validation complete: ${outputPath}`);
  console.log(`Soak iterations: ${soakReport.totalIterations}, failures: ${soakReport.failures}`);
  console.log(`Leak ok: ${leakCheck.ok}`);
  console.log(`Baseline operations: ${Object.keys(baselineReport.operations).join(', ')}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
