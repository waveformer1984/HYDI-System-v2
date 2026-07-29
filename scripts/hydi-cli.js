#!/usr/bin/env node
'use strict';
/* eslint-disable no-console */

/**
 * `hydi status` and `hydi readiness` command-line surface.
 *
 * `status`, `memory-review`, and `outcome` use `HYDIContinuousRuntime` with the
 * connector-based sensor layer. `readiness` now also starts the continuous
 * runtime so it evaluates the real connector health that `status` reports,
 * rather than the legacy `OperatorSession.sensors` array that is no longer
 * populated when connectors are used.
 *
 * Usage:
 *   node scripts/hydi-cli.js status
 *   node scripts/hydi-cli.js readiness
 *   node scripts/hydi-cli.js status --data-path ./data
 */

const path = require('path');
const { boot } = require('../src/hydi-v3/HYDIOperationalBoot');
const SignalCoverage = require('../src/hydi-v3/SignalCoverage');
const HYDIContinuousRuntime = require('../src/hydi-v3/HYDIContinuousRuntime');
const LifecycleRegistry = require('../src/hydi-v3/LifecycleRegistry');
const DeploymentManifest = require('../src/hydi-v3/DeploymentManifest');
const SnapshotManager = require('../src/hydi-v3/SnapshotManager');
const MarketplaceManager = require('../src/hydi-v3/MarketplaceManager');

function parseFlags(argv) {
  const args = argv.slice(2);
  const command = args[0];
  let id = null;
  let flagStart = 1;
  if (args[1] && !args[1].startsWith('--')) {
    id = args[1];
    flagStart = 2;
  }
  const flags = {};
  for (let i = flagStart; i < args.length; i++) {
    if (args[i] === '--data-path' && args[i + 1]) { flags.dataPath = args[i + 1]; i++; }
    else if (args[i] === '--result' && args[i + 1]) { flags.result = args[i + 1]; i++; }
    else if (args[i] === '--value' && args[i + 1]) { flags.value = args[i + 1]; i++; }
    else if (args[i] === '--source' && args[i + 1]) { flags.source = args[i + 1]; i++; }
    else if (args[i] === '--notes' && args[i + 1]) { flags.notes = args[i + 1]; i++; }
  }
  return { command, id, flags };
}

function sensorState(session) {
  const sensors = (session.sensors || []).map((sensor) =>
    (typeof sensor.healthCheck === 'function' ? sensor.healthCheck() : { ok: true }));
  if (sensors.length === 0) return 'offline';
  const degraded = sensors.filter((h) => h.ok === false);
  return degraded.length > 0 ? `degraded (${degraded.length} of ${sensors.length})` : 'healthy';
}

function signalState(session) {
  const coverage = session.signalCoverage || SignalCoverage.audit({ registry: session.eventBus.registry });
  const issues = coverage.dropped.length || coverage.double.length || coverage.unknown.length || coverage.orphan.length;
  return issues ? 'orphaned' : 'covered';
}

function runtimeConnectorState(runtime) {
  const status = runtime.getStatus();
  const connectors = status.connectors || [];
  if (connectors.length === 0) return 'offline';
  const degraded = connectors.filter((c) => !c.ok || c.state === 'failed');
  const states = connectors.map((c) => `${c.name} ${c.state}`).join(', ');
  if (degraded.length > 0) {
    return `degraded (${degraded.length} of ${connectors.length}): ${states}`;
  }
  return `healthy (${connectors.length}): ${states}`;
}

function connectorSignalState(session) {
  const coverage = session.signalCoverage || SignalCoverage.audit({ registry: session.eventBus.registry });
  const realIssues = coverage.dropped.length || coverage.double.length || coverage.unknown.length;
  if (realIssues) return 'coverage issues (dropped/double/unknown)';
  return 'covered';
}

function auditState(session) {
  if (!session.auditLedger) return 'not initialized';
  const verify = session.auditLedger.verify();
  return verify.ok ? 'chain verified' : `chain broken at record ${verify.failedAt}`;
}

function learningState(session) {
  if (!session.evidenceEngine) return 'not initialized';
  const awaiting = session.evidenceEngine.getAwaitingEvidence ? session.evidenceEngine.getAwaitingEvidence().length : 0;
  return awaiting > 0 ? `awaiting ${awaiting} measurement${awaiting === 1 ? '' : 's'}` : 'no measured outcomes recorded';
}

function lastRecommendation(session) {
  if (!session.recommendationTracker) return 'none';
  const recent = session.recommendationTracker.getRecentRecommendations(1);
  return recent.length ? (recent[0].action || 'unknown') : 'none';
}

function lastDecision(session) {
  if (session.executiveOS && session.executiveOS.lastBriefing) {
    return session.executiveOS.lastBriefing.executiveSummary || 'briefing generated';
  }
  if (session.executiveOS && Array.isArray(session.executiveOS.decisions) && session.executiveOS.decisions.length) {
    const last = session.executiveOS.decisions[session.executiveOS.decisions.length - 1];
    return last.summary || 'decision recorded';
  }
  return 'none';
}

function buildSummary(report, session, runtime = null) {
  const sensors = runtime ? runtimeConnectorState(runtime) : sensorState(session);
  const signals = runtime ? connectorSignalState(session) : signalState(session);
  const audit = auditState(session);
  const learning = learningState(session);
  const lastRec = lastRecommendation(session);
  const lastDec = lastDecision(session);

  let system = 'READY';
  if (report.status !== 'ready') {
    system = 'FAILED';
  } else if (runtime && runtime.getStatus().state !== 'READY') {
    system = `DEGRADED — runtime state ${runtime.getStatus().state}`;
  } else if (runtime ? !runtime.getStatus().connectorHealth : sensors === 'offline') {
    system = 'DEGRADED — no sensors active';
  } else if (sensors.startsWith('degraded')) {
    system = 'DEGRADED — sensor degraded';
  } else if (signals === 'coverage issues (dropped/double/unknown)') {
    system = 'DEGRADED — signal coverage issues';
  } else if (!audit.startsWith('chain verified')) {
    system = 'DEGRADED — audit chain broken';
  }

  return {
    system,
    boot: report.status === 'ready' ? 'Complete' : 'Failed',
    sensors,
    signals,
    audit,
    learning,
    lastRecommendation: lastRec,
    lastExecutiveDecision: lastDec,
  };
}

function appendIssues(lines, report) {
  if (report.warnings.length) {
    lines.push('', 'Warnings:');
    for (const w of report.warnings) lines.push(`  - ${w}`);
  }
  if (report.failures.length) {
    lines.push('', 'Failures:');
    for (const f of report.failures) lines.push(`  - ${f.step}: ${f.error}`);
  }
  return lines;
}

function renderOperatingState(status, session) {
  const lines = [
    'HYDI OPERATING STATE',
    '',
    `Runtime: ${status.state}`,
    `Uptime: ${status.uptime}ms`,
    `Events processed: ${status.eventsProcessed}`,
    `Recommendations: ${status.recommendations}`,
    `Pending approvals: ${status.pendingApprovals}`,
    `Awaiting measurements: ${status.awaitingMeasurements}`,
    `Audit entries: ${status.auditEntries}`,
    `Learning updates: ${status.learningUpdates}`,
    `Last verified action: ${status.lastVerifiedAction || 'none'}`,
  ];
  if (session && typeof session.certify === 'function') {
    const report = session.certify();
    return appendIssues(lines, report).join('\n');
  }
  return lines.join('\n');
}

function renderReadiness(report, session, runtime = null) {
  const s = buildSummary(report, session, runtime);
  const lines = [
    'HYDI SYSTEM READINESS',
    '',
    `System: ${s.system}`,
    `Boot: ${s.boot}`,
    `Sensors: ${s.sensors}`,
    `Signals: ${s.signals}`,
    `Audit: ${s.audit}`,
    `Learning: ${s.learning}`,
    `Last recommendation: ${s.lastRecommendation}`,
    `Last executive decision: ${s.lastExecutiveDecision}`,
    '',
    'Checks:',
  ];
  for (const check of report.checks) {
    const state = check.status === 'healthy' ? 'OK' : 'NOT OK';
    lines.push(`  ${check.name}: ${state}${check.detail ? ` (${check.detail})` : ''}`);
  }
  return appendIssues(lines, report).join('\n');
}

function renderHealth(report, session) {
  const lines = ['HYDI HEALTH', ''];
  for (const check of report.checks) {
    const state = check.status === 'healthy' ? 'OK' : 'NOT OK';
    lines.push(`  ${check.name}: ${state}${check.detail ? ` (${check.detail})` : ''}`);
  }
  if (session && typeof session.certify === 'function') {
    const certify = session.certify();
    if (certify.warnings.length) {
      lines.push('', 'Warnings:');
      for (const w of certify.warnings) lines.push(`  - ${w}`);
    }
    if (certify.failures.length) {
      lines.push('', 'Failures:');
      for (const f of certify.failures) lines.push(`  - ${f.step}: ${f.error}`);
    }
  }
  return lines.join('\n');
}

function formatRec(r) {
  const conf = (r.confidence * 100).toFixed(0);
  const observed = r.observedOutcome ? ` — ${r.observedOutcome.type}` : '';
  return `- ${r.action || 'Unknown'} (${conf}%${observed})`;
}

function renderMemoryReview(session) {
  const decisions = (session.executiveOS && Array.isArray(session.executiveOS.decisions)
    ? session.executiveOS.decisions.slice(-5)
    : []);
  const actions = (session.executionGateway
    ? session.executionGateway.getExecutionHistory({}).slice(0, 5)
    : []);
  const recs = (session.recommendationTracker
    ? session.recommendationTracker.getRecentRecommendations(20)
    : []);
  const measured = recs.filter((r) => r.observedOutcome).slice(0, 5);
  const changed = recs.filter((r) => r.confidenceHistory && r.confidenceHistory.length > 1).slice(0, 5);
  const lessons = (session.learningMetrics
    ? (session.learningMetrics.getDashboardData().recentLessons || [])
    : []);

  const lines = ['HYDI MEMORY REVIEW', ''];

  lines.push('Recent decisions:');
  lines.push(...(decisions.length ? decisions.map((d) => `- ${d.summary || 'decision'} @ ${new Date(d.at || Date.now()).toISOString()}`) : ['No decisions recorded.']));
  lines.push('', 'Recent actions:');
  lines.push(...(actions.length ? actions.map((a) => `- [${a.status}] ${a.type} (${a.adapter}) @ ${new Date(a.timestamp).toISOString()}`) : ['No actions recorded.']));
  lines.push('', 'Measured outcomes:');
  lines.push(...(measured.length ? measured.map(formatRec) : ['No measured outcomes yet.']));
  lines.push('', 'Confidence changes:');
  lines.push(...(changed.length ? changed.map((r) => {
    const h = r.confidenceHistory;
    const first = h[0].confidence;
    const last = h[h.length - 1].confidence;
    return `- ${r.action || 'Unknown'}: ${(first * 100).toFixed(0)}% → ${(last * 100).toFixed(0)}%`;
  }) : ['No confidence changes yet.']));
  lines.push('', 'Lessons learned:');
  lines.push(...(lessons.length ? lessons.slice(0, 5).map((l) => `- ${l.lesson}`) : ['No lessons recorded.']));

  return lines.join('\n');
}

async function runOutcome(session, recommendationId, flags) {
  if (!recommendationId) throw new Error('Recommendation id required. Usage: hydi outcome <id> --result <successful|unsuccessful|unknown> [--value <n>] [--source <text>] [--notes <text>]');
  const rec = session.recommendationTracker.getRecommendation(recommendationId);
  if (!rec) throw new Error(`Recommendation ${recommendationId} not found.`);

  const resultMap = { successful: 'successful', unsuccessful: 'failed', unknown: 'unknown' };
  const result = flags.result ? String(flags.result).toLowerCase() : null;
  if (!result || !resultMap[result]) throw new Error('Invalid --result. Use successful, unsuccessful, or unknown.');

  const numericValue = flags.value !== undefined ? Number(flags.value) : NaN;
  const hasNumeric = Number.isFinite(numericValue);
  const hasSource = !!flags.source;
  const measured = hasNumeric && hasSource;

  const outcome = session.businessOutcomeEngine.recordOutcome(recommendationId, {
    value: measured ? numericValue : null,
    type: resultMap[result],
    measured,
    provenance: measured ? flags.source : 'operator-qualitative',
    lesson: flags.notes || (measured ? 'Measured outcome recorded.' : 'Qualitative outcome recorded.'),
  });

  const lines = [
    `Outcome recorded for ${recommendationId}`,
    `Result: ${outcome.type || resultMap[result]}`,
    `Measured: ${measured ? `yes (${numericValue}, source: ${flags.source})` : 'no'}`,
    `Confidence: ${(outcome.confidence * 100).toFixed(0)}%`,
    `Confidence delta: ${outcome.confidenceDelta.toFixed(4)}`,
    `Lesson: ${outcome.lesson}`,
  ];
  if (!measured) lines.push('(Learning unchanged because no measured value with provenance was provided.)');
  return lines.join('\n');
}

async function runLifecycleCommand(command, id, flags) {
  const dataPath = flags.dataPath
    ? path.resolve(process.cwd(), flags.dataPath)
    : path.resolve(__dirname, '..', 'data');
  await require('fs').promises.mkdir(dataPath, { recursive: true });
  const registry = new LifecycleRegistry({ logger: { log: () => {}, warn: () => {}, error: () => {} } });
  const snapshotManager = await new SnapshotManager({ dataPath, registry, logger: { log: () => {}, warn: () => {}, error: () => {} } }).start();
  const manifestPath = id || path.join(dataPath, 'hydi-manifest.json');

  if (command === 'bootstrap' || command === 'deploy') {
    const manifest = await DeploymentManifest.fromFile(manifestPath).catch(() => DeploymentManifest.fromRegistry(registry, {}));
    const bootstrapped = await manifest.bootstrap(registry);
    console.log(JSON.stringify({ command, bootstrapped, components: registry.list().length }, null, 2));
    return 0;
  }

  if (command === 'verify') {
    const manifest = await DeploymentManifest.fromFile(manifestPath).catch(() => null);
    if (!manifest) {
      console.error('Manifest not found:', manifestPath);
      return 1;
    }
    await manifest.bootstrap(registry);
    const verify = await manifest.verify(registry);
    console.log(JSON.stringify({ command, verify }, null, 2));
    return verify.ok ? 0 : 1;
  }

  if (command === 'export-manifest') {
    const manifest = DeploymentManifest.fromRegistry(registry, { runtimeVersions: { node: process.version } });
    await manifest.write(manifestPath);
    console.log(JSON.stringify({ command, path: manifestPath, components: manifest.manifest.components.length }, null, 2));
    return 0;
  }

  if (command === 'snapshot') {
    const sub = id || 'create';
    if (sub === 'create') {
      const snap = await snapshotManager.create(flags.label || '');
      console.log(JSON.stringify({ command, snapshot: snap.hash }, null, 2));
      return 0;
    }
    if (sub === 'list') {
      const list = await snapshotManager.list();
      console.log(JSON.stringify({ command, snapshots: list.map((s) => s.hash) }, null, 2));
      return 0;
    }
    if (sub === 'restore') {
      const target = flags.hash || 'latest';
      const restored = await snapshotManager.restore(target);
      console.log(JSON.stringify({ command, restored: restored.success }, null, 2));
      return restored.success ? 0 : 1;
    }
    if (sub === 'compare') {
      const a = flags.a;
      const b = flags.b;
      const cmp = await snapshotManager.compare(a, b);
      console.log(JSON.stringify({ command, compare: cmp }, null, 2));
      return cmp.success ? 0 : 1;
    }
    console.error('Unknown snapshot subcommand:', sub);
    return 1;
  }

  return 1;
}

async function runMarketplaceCommand(command, id, flags) {
  const sub = id;
  const target = process.argv[4];
  const extra = process.argv[5];

  const marketplace = new MarketplaceManager({ logger: { log: () => {}, warn: () => {}, error: () => {} } });
  const official = marketplace.repositories;
  const officialPackages = [
    { id: 'audio.mastering', version: '1.0.0', type: 'Skill', publisher: 'protoforge', category: 'audio', offlineCompatible: true, requiredPermissions: { filesystem: true } },
    { id: 'vision.ocr', version: '1.0.0', type: 'Skill', publisher: 'protoforge', category: 'vision', offlineCompatible: false, requiredPermissions: { hardware: true } },
  ];
  for (const pkg of officialPackages) {
    const { digest, signature } = marketplace.verifier.sign(pkg, 'test-private-key');
    pkg.digest = digest;
    pkg.signature = signature;
  }
  official.addRepository({
    id: 'official',
    name: 'Official HYDI Marketplace',
    type: 'official',
    offline: false,
    packages: officialPackages,
  });
  official.addRepository({ id: 'local', name: 'Local', type: 'local', offline: true, packages: [] });
  marketplace.publishers.register({ id: 'protoforge', name: 'ProtoForge', status: 'official' });

  if (sub === 'search') {
    const results = marketplace.search({ q: target });
    console.log(JSON.stringify({ command: 'marketplace search', results: results.map((r) => ({ id: r.id, version: r.version, publisher: r.publisher })) }, null, 2));
    return 0;
  }
  if (sub === 'install') {
    const result = await marketplace.install(target, { allowUnsigned: flags['allow-unsigned'] });
    console.log(JSON.stringify(result, null, 2));
    return result.success ? 0 : 1;
  }
  if (sub === 'verify') {
    const cap = official.getCapability(target);
    if (!cap) { console.error('Capability not found:', target); return 1; }
    const result = marketplace.verify(cap);
    console.log(JSON.stringify(result, null, 2));
    return result.valid ? 0 : 1;
  }
  if (sub === 'update') {
    const result = await marketplace.update(target);
    console.log(JSON.stringify(result, null, 2));
    return result.success ? 0 : 1;
  }
  if (sub === 'remove') {
    const result = await marketplace.remove(target);
    console.log(JSON.stringify(result, null, 2));
    return result.success ? 0 : 1;
  }
  if (sub === 'publish') {
    const repoId = target || 'local';
    const pkgId = extra || 'unknown';
    const result = marketplace.publish(repoId, { id: pkgId, version: '1.0.0', type: 'Skill', publisher: 'protoforge', category: 'local', offlineCompatible: true, requiredPermissions: {} }, 'protoforge');
    console.log(JSON.stringify(result, null, 2));
    return result.success ? 0 : 1;
  }
  console.error('Unknown marketplace subcommand:', sub);
  return 1;
}

async function main() {
  const { command, id, flags } = parseFlags(process.argv);
  const dataPath = flags.dataPath
    ? path.resolve(process.cwd(), flags.dataPath)
    : path.resolve(__dirname, '..', 'data');
  const logger = { log: () => {}, warn: () => {}, error: () => {} };

  const lifecycleCommands = ['bootstrap', 'deploy', 'verify', 'export-manifest', 'snapshot'];
  if (lifecycleCommands.includes(command)) {
    const code = await runLifecycleCommand(command, id, flags);
    process.exit(code);
  }

  const marketplaceCommands = ['marketplace'];
  if (marketplaceCommands.includes(command)) {
    const code = await runMarketplaceCommand(command, id, flags);
    process.exit(code);
  }

  const validCommands = ['status', 'readiness', 'health', 'outcome', 'memory-review'];
  if (!command || !validCommands.includes(command)) {
    console.error('Usage: hydi <status|readiness|health|outcome|memory-review|bootstrap|deploy|verify|export-manifest|snapshot|marketplace> [--data-path <dir>]');
    process.exit(1);
  }

  if (command === 'readiness') {
    const cwd = process.cwd();
    const runtime = new HYDIContinuousRuntime({
      dataPath,
      logger,
      healthIntervalMs: 60000,
      connectors: [
        { type: 'local-process', name: 'process', enabled: true },
        { type: 'filesystem', name: 'filesystem', enabled: true, roots: { [path.basename(cwd)]: cwd } },
        { type: 'git', name: 'git', enabled: true, cwd, project: path.basename(cwd), pollIntervalMs: 60000 },
      ],
    });
    let exitCode = 1;
    try {
      const report = await runtime.start();
      const session = runtime.session;
      const summary = buildSummary(report, session, runtime);
      console.log(renderReadiness(report, session, runtime));
      exitCode = summary.system === 'READY' ? 0 : 1;
    } catch (error) {
      console.error(error instanceof Error ? error.message : String(error));
      exitCode = 1;
    } finally {
      await runtime.stop().catch(() => {});
    }
    process.exit(exitCode);
  }

  if (command === 'health') {
    const report = await boot({ dataPath, logger });
    const { session } = report;
    try {
      console.log(renderHealth(report, session));
    } finally {
      if (session && typeof session.destroy === 'function') {
        await session.destroy().catch(() => {});
      }
    }
    process.exit(report.status === 'ready' ? 0 : 1);
  }

  const runtime = new HYDIContinuousRuntime({ dataPath, logger, healthIntervalMs: 60000 });
  let output;
  let exitCode = 0;
  try {
    await runtime.start();
    if (command === 'status') {
      const status = runtime.getStatus();
      output = renderOperatingState(status, runtime.session);
      exitCode = status.state === 'READY' ? 0 : 1;
    } else if (command === 'memory-review') {
      output = renderMemoryReview(runtime.session);
    } else if (command === 'outcome') {
      output = await runOutcome(runtime.session, id, flags);
    }
    console.log(output);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    exitCode = 1;
  } finally {
    await runtime.stop().catch(() => {});
  }
  process.exit(exitCode);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
