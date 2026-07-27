'use strict';

const path = require('path');
const OperatorSession = require('./OperatorSession');

const MIN_NODE_MAJOR = 20;

const STATUS_COMPONENT_ORDER = [
  'Executive OS', 'Memory', 'Event Bus', 'Sensors', 'Evidence', 'Learning', 'Audit Ledger',
];

const HEALTH_CHECK_LABELS = {
  memory: 'Memory',
  executiveOS: 'Executive OS',
  cockpit: 'Operator Interface',
  workflowEngine: 'Workflow Engine',
  executionGateway: 'Execution Gateway',
  decisionOutcomeStore: 'Decision Outcome Store',
  recommendationTracker: 'Recommendation Tracker',
  businessOutcomeEngine: 'Business Outcome Engine',
  learningMetrics: 'Learning',
  timeline: 'Executive Timeline',
  agentWorkspace: 'Agent Workspace',
  approvalCenter: 'Approval Center',
  sessionMemory: 'Session Memory',
  conversationEngine: 'Conversation Engine',
  consoleAPI: 'Console API',
  eventBus: 'Event Bus',
  signalCoverage: 'Signal Coverage',
};

function validateEnvironment() {
  const nodeMajor = parseInt(process.versions.node.split('.')[0], 10);
  return [
    {
      name: 'NodeVersion',
      ok: Number.isFinite(nodeMajor) && nodeMajor >= MIN_NODE_MAJOR,
      detail: `Node ${process.version} (>= ${MIN_NODE_MAJOR} required)`,
    },
    { name: 'Platform', ok: true, detail: process.platform },
  ];
}

function validateConfig(config) {
  const dataPath = config.dataPath ? path.resolve(config.dataPath) : path.resolve(__dirname, '../../data');
  return {
    dataPath,
    checks: [
      { name: 'DataPathResolved', ok: typeof dataPath === 'string' && dataPath.length > 0, detail: dataPath },
    ],
  };
}

/**
 * Composes the already-live health surfaces of a started OperatorSession
 * (`healthCheck()`, `signalCoverage`, `auditLedger.verify()`, the pending
 * approvals queue, and the briefing's own learning/data-gap fields) into one
 * readiness report. Deliberately does not re-derive any of these numbers —
 * every subsystem already computes its own status; this only assembles them.
 */
function generateHealthReport(session) {
  const components = [];
  const warnings = [];
  const failures = [];

  const health = session.healthCheck();
  for (const [key, ok] of Object.entries(health.checks)) {
    const name = HEALTH_CHECK_LABELS[key] || key;
    components.push({ name, ok, detail: ok ? 'ready' : 'not ready' });
    if (!ok) failures.push({ step: name, error: `${name} health check failed` });
  }

  if (session.evidenceEngine) {
    const evidenceHealth = session.evidenceEngine.healthCheck();
    components.push({
      name: 'Evidence',
      ok: evidenceHealth.ok,
      detail: `${evidenceHealth.kpiCount || 0} KPI(s), ${evidenceHealth.providerCount || 0} provider(s)`,
    });
    if (!evidenceHealth.ok) failures.push({ step: 'Evidence', error: 'BusinessEvidenceEngine health check failed' });
  } else {
    components.push({ name: 'Evidence', ok: false, detail: 'not initialized' });
    failures.push({ step: 'Evidence', error: 'BusinessEvidenceEngine not initialized' });
  }

  if (session.auditLedger) {
    const verify = session.auditLedger.verify();
    components.push({
      name: 'Audit Ledger',
      ok: verify.ok,
      detail: verify.ok ? `${verify.count} record(s) verified` : `chain broken at record ${verify.failedAt} (${verify.reason})`,
    });
    if (!verify.ok) failures.push({ step: 'AuditLedger.verify', error: `${verify.reason} at record ${verify.failedAt}` });
  } else {
    components.push({ name: 'Audit Ledger', ok: false, detail: 'not initialized' });
    failures.push({ step: 'Audit Ledger', error: 'not initialized' });
  }

  const sensorDetail = session.sensors.length
    ? `${session.sensors.length} registered (${session.sensors.map((s) => s.constructor.name).join(', ')})`
    : 'none registered (no sensors configured — not a failure)';
  components.push({ name: 'Sensors', ok: true, detail: sensorDetail });
  for (const sensor of session.sensors) {
    if (typeof sensor.healthCheck !== 'function') {
      warnings.push(`${sensor.constructor.name} has no healthCheck() implemented; readiness for this sensor could not be assessed.`);
      continue;
    }
    const sensorHealth = sensor.healthCheck();
    if (!sensorHealth.ok) warnings.push(`${sensor.constructor.name} reports degraded: ${JSON.stringify(sensorHealth)}`);
  }

  if (session.signalCoverage) {
    const sc = session.signalCoverage;
    if (sc.dropped && sc.dropped.length) warnings.push(`Dropped event types (registered, no interpreter): ${sc.dropped.join(', ')}`);
    if (sc.double && sc.double.length) warnings.push(`Double-handled event types: ${sc.double.map((d) => d.type).join(', ')}`);
    if (sc.orphan && sc.orphan.length) warnings.push(`Orphan event types (interpreter handles them, but no sensor is registered to emit them): ${sc.orphan.join(', ')}`);
    if (sc.unknown && sc.unknown.length) warnings.push(`Unknown event types seen at runtime: ${sc.unknown.join(', ')}`);
    if (sc.stale && sc.stale.length) warnings.push(`Stale event types (no recent emissions): ${sc.stale.join(', ')}`);
  }

  const pending = session.executionGateway ? session.executionGateway.getPendingApprovals() : [];
  if (pending.length) warnings.push(`${pending.length} action(s) awaiting approval.`);

  let briefing = null;
  try {
    briefing = session.executiveOS ? session.executiveOS.morningBriefing() : null;
  } catch (error) {
    failures.push({ step: 'ExecutiveOperatingSystem.morningBriefing', error: error instanceof Error ? error.message : String(error) });
  }
  if (briefing) {
    if (briefing.awaitingMeasurements && briefing.awaitingMeasurements.length) {
      warnings.push(`${briefing.awaitingMeasurements.length} recommendation(s) awaiting measured evidence.`);
    }
    if (briefing.missingData && briefing.missingData.length) {
      warnings.push(`Missing data: ${briefing.missingData.join('; ')}`);
    }
    if (briefing.losingConfidence && briefing.losingConfidence.length) {
      warnings.push(`Losing confidence: ${briefing.losingConfidence.map((r) => r.action || r.title || r.id).join(', ')}`);
    }
  }

  return { status: failures.length === 0 ? 'healthy' : 'failed', components, warnings, failures };
}

function buildRecommendations(report) {
  if (report.failures.length) return report.failures.map((f) => `Resolve ${f.step}: ${f.error}`);
  if (report.warnings.length) return ['System is healthy; review the warnings above before relying on autonomous recommendations.'];
  return ['System is fully ready. No outstanding action required.'];
}

/**
 * Deterministic startup pipeline. Steps 1-2 (environment + config validation)
 * are genuinely new checks. Steps 3-12 are `OperatorSession.start()` itself —
 * already the real, ordered implementation of persistence, BusinessMemory,
 * BusinessEventBus, sensors, interpreters, SignalCoverage, TrustEngine (built
 * inside ExecutiveOperatingSystem), BusinessEvidenceEngine, and the learning
 * stack — re-deriving that control flow here would be exactly the duplicate
 * intelligence layer this feature must not add. Step 13 is `generateHealthReport`.
 */
async function runStartupSequence(config = {}) {
  const logger = config.logger || console;
  const startedAt = Date.now();
  const components = [];
  const warnings = [];
  const failures = [];

  const envChecks = validateEnvironment();
  components.push({ name: 'Environment', ok: envChecks.every((c) => c.ok), detail: envChecks.map((c) => c.detail).join('; ') });
  for (const c of envChecks) {
    if (!c.ok) {
      failures.push({ step: c.name, error: c.detail });
      logger.error(`[HYDIStartupSequence] ${c.name} failed: ${c.detail}`);
    }
  }

  const { checks: configChecks, dataPath } = validateConfig(config);
  components.push({ name: 'Configuration', ok: configChecks.every((c) => c.ok), detail: configChecks.map((c) => c.detail).join('; ') });
  for (const c of configChecks) {
    if (!c.ok) {
      failures.push({ step: c.name, error: c.detail });
      logger.error(`[HYDIStartupSequence] ${c.name} failed: ${c.detail}`);
    }
  }

  if (failures.length) {
    return {
      status: 'failed',
      startupTime: Date.now() - startedAt,
      components,
      warnings,
      failures,
      recommendations: ['Fix environment/configuration errors above before retrying startup.'],
    };
  }

  let session;
  try {
    session = new OperatorSession({ ...config, dataPath });
    await session.start();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error('[HYDIStartupSequence] OperatorSession failed to start', { error: message });
    failures.push({ step: 'OperatorSession.start', error: message });
    if (session && session.auditLedger) {
      try {
        await session.auditLedger.record({ category: 'startup-failure', actor: 'HYDIStartupSequence', payload: { error: message } });
      } catch (auditError) {
        // Ledger itself never came up; nothing further can be audited for this failure.
      }
    }
    return {
      status: 'failed',
      startupTime: Date.now() - startedAt,
      components,
      warnings,
      failures,
      recommendations: ['OperatorSession failed to start; inspect the failure above.'],
    };
  }

  const report = generateHealthReport(session);
  components.push(...report.components);
  warnings.push(...report.warnings);
  failures.push(...report.failures);

  if (session.auditLedger) {
    try {
      await session.auditLedger.record({
        category: 'startup-report',
        actor: 'HYDIStartupSequence',
        payload: { status: report.status, startupTime: Date.now() - startedAt, componentCount: components.length, warningCount: warnings.length },
      });
    } catch (auditError) {
      const message = auditError instanceof Error ? auditError.message : String(auditError);
      logger.error('[HYDIStartupSequence] failed to audit startup report', { error: message });
      failures.push({ step: 'AuditLedger.record(startup-report)', error: message });
    }
  }

  const finalReport = {
    status: failures.length === 0 ? 'healthy' : 'failed',
    startupTime: Date.now() - startedAt,
    components,
    warnings,
    failures,
  };
  finalReport.recommendations = buildRecommendations(finalReport);
  // Non-spec convenience field: callers (e.g. the CLI, the demo script) that
  // want to keep operating the system after boot don't have to start another.
  finalReport.session = session;
  return finalReport;
}

function toStatusText(report) {
  const byName = new Map(report.components.map((c) => [c.name, c]));
  const lines = ['SYSTEM STATUS', ''];
  for (const name of STATUS_COMPONENT_ORDER) {
    const component = byName.get(name);
    const label = name.padEnd(18, ' ');
    lines.push(`${label}${component ? (component.ok ? 'READY' : 'NOT READY') : 'UNKNOWN'}`);
  }
  if (report.warnings.length) {
    lines.push('', 'Warnings:', '');
    report.warnings.forEach((w) => lines.push(`- ${w}`));
  }
  if (report.failures.length) {
    lines.push('', 'Failures:', '');
    report.failures.forEach((f) => lines.push(`- ${f.step}: ${f.error}`));
  }
  return lines.join('\n');
}

module.exports = { runStartupSequence, generateHealthReport, toStatusText };
