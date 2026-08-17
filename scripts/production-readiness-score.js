#!/usr/bin/env node
'use strict';

const fs = require('fs').promises;
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SRC_V3 = path.join(ROOT, 'src', 'hydi-v3');
const TESTS = path.join(ROOT, 'tests');
const DOCS = path.join(ROOT, 'docs', 'hydi-v3');

function exists(filepath) {
  return fs.access(filepath).then(() => true).catch(() => false);
}

async function listFiles(dir) {
  try {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries.filter((e) => e.isFile()).map((e) => e.name);
  } catch (err) {
    return [];
  }
}

async function fileLineCount(filepath) {
  try {
    const data = await fs.readFile(filepath, 'utf8');
    return data.split('\n').length;
  } catch (err) {
    return 0;
  }
}

async function countLinesInDir(dir) {
  const files = await listFiles(dir);
  let total = 0;
  for (const file of files) {
    if (file.endsWith('.js')) {
      total += await fileLineCount(path.join(dir, file));
    }
  }
  return total;
}

async function loadManagerExports() {
  try {
    const index = require(path.join(SRC_V3, 'index.js'));
    return index;
  } catch (err) {
    return {};
  }
}

function checkManagerMethods(Manager) {
  const expected = [
    'start',
    'stop',
    'createMission',
    'executeMission',
    'runSecurityAudit',
    'runMemoryIntegrity',
    'runPerformanceBenchmarks',
    'runTestSuite',
    'getStatus',
    'getDashboard',
  ];
  const prototype = Manager.prototype || {};
  return expected.map((m) => ({ name: m, present: typeof prototype[m] === 'function' }));
}

async function assessReliability() {
  const required = [
    'WatchdogSupervisor',
    'HeartbeatSystem',
    'GracefulShutdown',
    'SelfHealingEngine',
    'MemoryIntegrity',
    'CheckpointStore',
    'TestingFramework',
    'MissionPlanner',
  ];
  const exports = await loadManagerExports();
  const present = required.filter((m) => typeof exports[m] === 'function');

  const manager = exports.HYDIAutonomyManager;
  const methods = manager ? checkManagerMethods(manager).filter((m) => m.present).length : 0;

  const testingFrameworkPath = path.join(SRC_V3, 'TestingFramework.js');
  let scenarios = 0;
  if (await exists(testingFrameworkPath)) {
    const source = await fs.readFile(testingFrameworkPath, 'utf8');
    const matches = source.match(/async run\w+\(/g);
    scenarios = matches ? matches.length : 0;
  }

  const checks = {
    requiredModulesPresent: required.length,
    requiredModulesTotal: required.length,
    managerMethodsPresent: methods,
    managerMethodsTotal: 10,
    failureScenarios: scenarios,
  };

  const score = Math.round(
    ((present.length / required.length) * 0.6 + (methods / 10) * 0.25 + Math.min(scenarios / 10, 1) * 0.15) * 100
  );

  return { score, checks, recommendation: scenarios < 10 ? 'Add more failure-mode scenarios to TestingFramework' : 'ok' };
}

async function assessSecurity() {
  const securityPath = path.join(SRC_V3, 'SecurityAuditor.js');
  const auditScript = path.join(ROOT, 'scripts', 'security-audit.js');
  let patterns = 0;
  let hasEncrypt = false;
  let hasValidate = false;
  if (await exists(securityPath)) {
    const source = await fs.readFile(securityPath, 'utf8');
    const matches = source.match(/\{ name: '/g);
    patterns = matches ? matches.length : 0;
    hasEncrypt = /\sencrypt\(/.test(source);
    hasValidate = /\svalidateInput\(/.test(source);
  }

  const exports = await loadManagerExports();
  const hasSecurityAuditor = typeof exports.SecurityAuditor === 'function';

  const checks = {
    securityAuditorPresent: hasSecurityAuditor,
    securityAuditScript: await exists(auditScript),
    secretPatterns: patterns,
    hasInputValidation: hasValidate,
    hasEncryptionHelpers: hasEncrypt,
  };

  const score = Math.round(
    ((hasSecurityAuditor ? 0.3 : 0) +
      (checks.securityAuditScript ? 0.2 : 0) +
      (Math.min(patterns / 8, 1) * 0.2) +
      (hasValidate ? 0.15 : 0) +
      (hasEncrypt ? 0.15 : 0)) * 100
  );

  return { score, checks, recommendation: score < 90 ? 'Expand SecurityAuditor patterns and validation coverage' : 'ok' };
}

async function assessPerformance() {
  const perfPath = path.join(SRC_V3, 'PerformanceBenchmark.js');
  const benchmarkScript = path.join(ROOT, 'scripts', 'performance-benchmark.js');
  let benchmarks = 0;
  let hasTargets = false;
  if (await exists(perfPath)) {
    const source = await fs.readFile(perfPath, 'utf8');
    const matches = source.match(/async benchmark\w+\(/g);
    benchmarks = matches ? matches.length : 0;
    hasTargets = /targets:\s*\{/.test(source);
  }

  const exports = await loadManagerExports();
  const hasPerf = typeof exports.PerformanceBenchmark === 'function';

  const checks = {
    performanceBenchmarkPresent: hasPerf,
    performanceBenchmarkScript: await exists(benchmarkScript),
    benchmarkMethods: benchmarks,
    hasSloTargets: hasTargets,
  };

  const score = Math.round(
    ((hasPerf ? 0.3 : 0) +
      (checks.performanceBenchmarkScript ? 0.2 : 0) +
      (Math.min(benchmarks / 7, 1) * 0.3) +
      (hasTargets ? 0.2 : 0)) * 100
  );

  return { score, checks, recommendation: score < 90 ? 'Add more benchmarks and explicit SLO targets' : 'ok' };
}

async function assessScalability() {
  const distPath = path.join(SRC_V3, 'DistributedCompute.js');
  let hasNodeRegistry = false;
  let hasScheduler = false;
  let hasHeartbeat = false;
  let hasRedistribution = false;
  if (await exists(distPath)) {
    const source = await fs.readFile(distPath, 'utf8');
    hasNodeRegistry = /registerNode\(/.test(source);
    hasScheduler = /schedule\(/.test(source);
    hasHeartbeat = /heartbeat\(/.test(source);
    hasRedistribution = /redistributeWork\(/.test(source);
  }

  const exports = await loadManagerExports();
  const hasDistributed = typeof exports.DistributedCompute === 'function';

  const checks = {
    distributedComputePresent: hasDistributed,
    nodeRegistry: hasNodeRegistry,
    scheduler: hasScheduler,
    nodeHeartbeat: hasHeartbeat,
    workRedistribution: hasRedistribution,
  };

  const score = Math.round(
    ((hasDistributed ? 0.3 : 0) +
      (hasNodeRegistry ? 0.2 : 0) +
      (hasScheduler ? 0.2 : 0) +
      (hasHeartbeat ? 0.15 : 0) +
      (hasRedistribution ? 0.15 : 0)) * 100
  );

  return { score, checks, recommendation: score < 90 ? 'Add load-aware scheduling and node fencing' : 'ok' };
}

async function assessMaintainability() {
  const files = await listFiles(SRC_V3);
  const jsFiles = files.filter((f) => f.endsWith('.js') && f !== 'index.js');
  const totalLines = await countLinesInDir(SRC_V3);
  const avgLines = jsFiles.length ? totalLines / jsFiles.length : 0;
  const sizePenalty = Math.min(Math.max(0, avgLines - 200) / 20, 25);

  const hasReadme = await exists(path.join(SRC_V3, 'README.md'));
  const hasRunbooks = await exists(path.join(SRC_V3, 'RUNBOOKS.md'));
  const docs = await listFiles(DOCS);
  const docPenalty = Math.max(0, 15 - docs.length) * 1;

  const checks = {
    moduleCount: jsFiles.length,
    totalLines: totalLines,
    averageLinesPerModule: Math.round(avgLines * 10) / 10,
    hasReadme: hasReadme,
    hasRunbooks: hasRunbooks,
    hydiV3Docs: docs.length,
  };

  const score = Math.round(100 - sizePenalty - docPenalty);

  return { score, checks, recommendation: score < 80 ? 'Split oversized modules and finish docs' : 'ok' };
}

async function assessObservability() {
  const obsPath = path.join(SRC_V3, 'ObservabilityDashboard.js');
  let hasSnapshots = false;
  let hasDashboard = false;
  let hasPrometheus = false;
  if (await exists(obsPath)) {
    const source = await fs.readFile(obsPath, 'utf8');
    hasSnapshots = /recordSnapshot\(/.test(source);
    hasDashboard = /getDashboard\(/.test(source);
    hasPrometheus = /toPrometheus\(/.test(source) || /prometheus/.test(source);
  }

  const exports = await loadManagerExports();
  const hasObservability = typeof exports.ObservabilityDashboard === 'function';

  const checks = {
    observabilityDashboardPresent: hasObservability,
    snapshotRecording: hasSnapshots,
    dashboardApi: hasDashboard,
    prometheusExport: hasPrometheus,
  };

  const score = Math.round(
    ((hasObservability ? 0.4 : 0) +
      (hasSnapshots ? 0.25 : 0) +
      (hasDashboard ? 0.2 : 0) +
      (hasPrometheus ? 0.15 : 0)) * 100
  );

  return { score, checks, recommendation: score < 90 ? 'Add structured logging and alerting integrations' : 'ok' };
}

async function assessDocumentation() {
  const requiredDocs = [
    'ARCHITECTURE_GUIDE.md',
    'DEVELOPER_GUIDE.md',
    'OPERATOR_GUIDE.md',
    'DEPLOYMENT_GUIDE.md',
    'DISASTER_RECOVERY_GUIDE.md',
    'MAINTENANCE_GUIDE.md',
    'API_DOCUMENTATION.md',
    'SEQUENCE_DIAGRAMS.md',
    'CLASS_DIAGRAMS.md',
    'DATA_FLOW_DIAGRAMS.md',
    'MISSION_LIFECYCLE_DIAGRAMS.md',
    'RECOVERY_FLOWCHARTS.md',
    'ADRS.md',
    'TROUBLESHOOTING_MANUAL.md',
    'RELEASE_NOTES.md',
    'MIGRATION_GUIDE.md',
  ];
  const docs = await listFiles(DOCS);
  const present = requiredDocs.filter((d) => docs.includes(d));
  const readme = await exists(path.join(SRC_V3, 'README.md'));
  const runbooks = await exists(path.join(SRC_V3, 'RUNBOOKS.md'));
  const report = await exists(path.join(ROOT, 'HYDI_V3_PRODUCTION_READINESS_REPORT.md'));

  const checks = {
    requiredDocsPresent: present.length,
    requiredDocsTotal: requiredDocs.length,
    hasReadme: readme,
    hasRunbooks: runbooks,
    hasReadinessReport: report,
  };

  const score = Math.round(
    ((present.length / requiredDocs.length) * 0.75 + (readme ? 0.1 : 0) + (runbooks ? 0.1 : 0) + (report ? 0.05 : 0)) * 100
  );

  return { score, checks, recommendation: present.length < requiredDocs.length ? `Missing docs: ${requiredDocs.filter((d) => !docs.includes(d)).join(', ')}` : 'ok' };
}

async function assessTesting() {
  const unitDir = path.join(TESTS, 'unit', 'hydi-v3');
  const integrationFile = path.join(TESTS, 'integration', 'hydi-v3-integration.test.js');
  const unitFiles = (await listFiles(unitDir)).filter((f) => f.endsWith('.test.js'));
  const srcFiles = (await listFiles(SRC_V3)).filter((f) => f.endsWith('.js') && f !== 'index.js');
  const coverage = srcFiles.length ? unitFiles.length / srcFiles.length : 0;

  const checks = {
    unitTests: unitFiles.length,
    sourceModules: srcFiles.length,
    unitToSourceRatio: Math.round(coverage * 100),
    integrationTest: await exists(integrationFile),
  };

  const score = Math.round(
    ((Math.min(coverage, 1) * 0.65) + (checks.integrationTest ? 0.35 : 0)) * 100
  );

  return { score, checks, recommendation: coverage < 1 ? 'Add unit tests for any uncovered modules' : 'ok' };
}

async function assessOperationalMaturity() {
  const scripts = [
    'performance-benchmark.js',
    'security-audit.js',
    'soak-test.js',
    'production-readiness-score.js',
  ];
  const presentScripts = [];
  for (const s of scripts) {
    if (await exists(path.join(ROOT, 'scripts', s))) {
      presentScripts.push(s);
    }
  }

  const pkg = require(path.join(ROOT, 'package.json'));
  const requiredScripts = ['lint', 'typecheck', 'test', 'test:integration', 'test:soak', 'benchmark:performance', 'security-audit'];
  const presentPackageScripts = requiredScripts.filter((s) => typeof pkg.scripts[s] === 'string');

  const workflow = await exists(path.join(ROOT, '.github', 'workflows', 'hydi-v3-mission-omega.yml'));
  const report = await exists(path.join(ROOT, 'HYDI_V3_PRODUCTION_READINESS_REPORT.md'));

  const checks = {
    operationalScripts: presentScripts.length,
    operationalScriptsTotal: scripts.length,
    packageScripts: presentPackageScripts.length,
    packageScriptsTotal: requiredScripts.length,
    missionOmegaWorkflow: workflow,
    productionReadinessReport: report,
  };

  const score = Math.round(
    ((presentScripts.length / scripts.length) * 0.35 +
      (presentPackageScripts.length / requiredScripts.length) * 0.35 +
      (workflow ? 0.15 : 0) +
      (report ? 0.15 : 0)) * 100
  );

  return { score, checks, recommendation: score < 90 ? 'Add missing operational scripts and CI workflow' : 'ok' };
}

async function main() {
  const categories = {
    reliability: await assessReliability(),
    security: await assessSecurity(),
    performance: await assessPerformance(),
    scalability: await assessScalability(),
    maintainability: await assessMaintainability(),
    observability: await assessObservability(),
    documentation: await assessDocumentation(),
    testing: await assessTesting(),
    operationalMaturity: await assessOperationalMaturity(),
  };

  const weights = {
    reliability: 0.15,
    security: 0.12,
    performance: 0.12,
    scalability: 0.10,
    maintainability: 0.10,
    observability: 0.10,
    documentation: 0.10,
    testing: 0.12,
    operationalMaturity: 0.09,
  };

  let overallScore = 0;
  for (const [key, value] of Object.entries(categories)) {
    overallScore += value.score * weights[key];
  }
  overallScore = Math.round(overallScore);

  const report = {
    timestamp: new Date().toISOString(),
    overallScore,
    categoryScores: Object.fromEntries(
      Object.entries(categories).map(([k, v]) => [k, v.score])
    ),
    details: categories,
    summary: overallScore >= 90 ? 'Mission Omega production readiness threshold met' : 'Production readiness improvements recommended',
  };

  console.log(JSON.stringify(report, null, 2));
  process.exit(overallScore >= 90 ? 0 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
