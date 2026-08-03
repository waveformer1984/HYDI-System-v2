/**
 * Validation Tooling Integrity
 * ============================
 *
 * Regression protection for the accuracy of HYDI's production validation
 * tooling. These tests do not assert that the system is healthy; they assert
 * that the tools which measure the system report the truth.
 *
 * Each test below corresponds to a defect found during the validation tooling
 * audit. They exist to stop those defects returning.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..', '..');
const PACKAGE_JSON_PATH = path.join(REPO_ROOT, 'package.json');

const rawPackageJson = fs.readFileSync(PACKAGE_JSON_PATH, 'utf8');
const pkg = JSON.parse(rawPackageJson);

/**
 * Extract script keys from the raw text rather than the parsed object.
 * JSON.parse silently keeps only the last of a duplicated key, which is
 * exactly how `npm run soak-test` came to run a 280ms unit test.
 */
function rawScriptKeys() {
  const start = rawPackageJson.indexOf('"scripts"');
  const braceStart = rawPackageJson.indexOf('{', start);

  let depth = 0;
  let end = braceStart;
  for (let i = braceStart; i < rawPackageJson.length; i += 1) {
    if (rawPackageJson[i] === '{') depth += 1;
    if (rawPackageJson[i] === '}') {
      depth -= 1;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }

  const block = rawPackageJson.slice(braceStart, end);
  const keys = [];
  const re = /"([^"\\]+)"\s*:/g;
  let match;
  while ((match = re.exec(block)) !== null) keys.push(match[1]);
  return keys;
}

describe('package.json script integrity', () => {
  test('contains no duplicate script names', () => {
    const keys = rawScriptKeys();
    const seen = new Set();
    const duplicates = new Set();

    for (const key of keys) {
      if (seen.has(key)) duplicates.add(key);
      seen.add(key);
    }

    expect([...duplicates]).toEqual([]);
  });

  test('every script key parsed matches the number of raw keys', () => {
    // A mismatch means JSON.parse collapsed a duplicate that the raw scan saw.
    expect(Object.keys(pkg.scripts).length).toBe(rawScriptKeys().length);
  });

  test('the ambiguous legacy names soak-test and leak-test are not reintroduced', () => {
    // These names each mapped to two different implementations. Any script
    // whose name does not say which implementation it runs is banned.
    expect(pkg.scripts['soak-test']).toBeUndefined();
    expect(pkg.scripts['leak-test']).toBeUndefined();
  });
});

describe('validation commands invoke the script their name implies', () => {
  const expectations = {
    // Long-running endurance harness — must be the script, not a unit test.
    'soak-test-24h': 'node scripts/soak-test.js',
    'soak-test-1h': 'node scripts/soak-test.js --duration 1h',
    'soak-test-24h:chaos': 'node scripts/soak-test.js --chaos',
    // Unit test that validates the soak harness logic — must be the jest test.
    'soak-harness-test': 'RC2Hardening.test.js',
    'resource-auditor-test': 'RC2Hardening.test.js',
    'resource-leak-test': 'ProductionReliability.test.js',
    'runtime-validation': 'node scripts/op-validation.js',
    'security-audit': 'node scripts/security-audit.js',
    'production-certification': 'operational-qualification.js full',
    'operational-qualification': 'operational-qualification.js quick',
  };

  test.each(Object.entries(expectations))('%s runs %s', (name, expected) => {
    expect(pkg.scripts[name]).toBeDefined();
    expect(pkg.scripts[name]).toContain(expected);
  });

  test('every referenced script file exists on disk', () => {
    const missing = [];
    for (const command of Object.values(pkg.scripts)) {
      const re = /(?:node|npx jest)\s+([\w./-]+\.(?:js|json))/g;
      let match;
      while ((match = re.exec(command)) !== null) {
        const target = path.join(REPO_ROOT, match[1]);
        if (!fs.existsSync(target)) missing.push(match[1]);
      }
    }
    expect(missing).toEqual([]);
  });

  test('the endurance harness is not aliased to a jest unit test', () => {
    // The original defect: a 24-hour soak command that actually ran jest.
    for (const name of ['soak-test-24h', 'soak-test-1h', 'soak-test-24h:chaos']) {
      expect(pkg.scripts[name]).not.toMatch(/jest/);
    }
  });
});

describe('soak harness: chaos is opt-in', () => {
  const { parseArgs } = require('../../scripts/soak-test');

  test('chaos is disabled by default', () => {
    expect(parseArgs(['node', 'soak-test.js']).chaos).toBe(false);
  });

  test('chaos stays disabled for every non-chaos flag', () => {
    const argv = ['node', 'soak-test.js', '--duration', '1000', '--interval', '100', '--supervised'];
    expect(parseArgs(argv).chaos).toBe(false);
  });

  test('chaos activates only when --chaos is passed explicitly', () => {
    expect(parseArgs(['node', 'soak-test.js', '--chaos']).chaos).toBe(true);
  });

  test('a duration alone never enables chaos', () => {
    expect(parseArgs(['node', 'soak-test.js', '--duration', '86400000']).chaos).toBe(false);
  });

  test('scenario selection is parsed but inert without --chaos', () => {
    const parsed = parseArgs(['node', 'soak-test.js', '--chaos-scenarios', 'restart-next,kill-bridge']);
    expect(parsed.chaos).toBe(false);
    expect(parsed.chaosScenarios).toEqual(['restart-next', 'kill-bridge']);
  });
});

describe('soak harness: documented scope matches implementation', () => {
  const source = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'soak-test.js'), 'utf8');

  test('does not describe a sleep as failure injection', () => {
    // The original harness logged "Injecting network blip" around a
    // setTimeout(5000) and then logged "Network recovered".
    expect(source).not.toMatch(/simulateNetworkBlip/);
    expect(source).not.toMatch(/Injecting network blip/);
  });

  test('header documents both verified and not-verified scope', () => {
    expect(source).toMatch(/VERIFIED by the default run/);
    expect(source).toMatch(/NOT VERIFIED by the default run/);
  });

  test('chaos scenarios live in a module that is only required under --chaos', () => {
    // A top-level require would load destructive code on the default path.
    const topOfFile = source.slice(0, source.indexOf('class SoakTest'));
    expect(topOfFile).not.toMatch(/require\(['"]\.\/lib\/soak-chaos['"]\)/);
  });
});

describe('soak harness: operational metrics are generated correctly', () => {
  const { OperationalMetrics } = require('../../scripts/lib/soak-metrics');

  test('collects a sample containing every required metric family', async () => {
    const metrics = new OperationalMetrics({});
    const sample = await metrics.sample();

    expect(sample).toHaveProperty('timestamp');
    expect(sample).toHaveProperty('cpu.systemPercent');
    expect(sample).toHaveProperty('cpu.harnessPercent');
    expect(sample).toHaveProperty('memory.harnessHeapUsedBytes');
    expect(sample).toHaveProperty('memory.harnessRssBytes');
    expect(sample).toHaveProperty('processCount');
    expect(sample).toHaveProperty('harnessHandles');
    expect(sample).toHaveProperty('disk');
    expect(sample).toHaveProperty('dependencies.postgres');
    expect(sample).toHaveProperty('dependencies.redis');
    expect(sample).toHaveProperty('counters.restarts');
    expect(sample).toHaveProperty('counters.exceptions');
    expect(sample).toHaveProperty('counters.unhandledRejections');
  }, 20000);

  test('process count is a real process table read, not a CPU core count', async () => {
    const os = require('os');
    const metrics = new OperationalMetrics({});
    const count = await metrics.sampleProcessCount();

    if (count !== null) {
      expect(count).toBeGreaterThan(os.cpus().length);
    }
  }, 20000);

  test('handle count is not a hardcoded zero placeholder', () => {
    const metrics = new OperationalMetrics({});
    const { harnessHandles } = metrics.sampleHandles();
    expect(harnessHandles === null || typeof harnessHandles === 'number').toBe(true);
  });

  test('unreachable dependencies report null latency, never zero', async () => {
    const metrics = new OperationalMetrics({
      // Port 1 is reserved and will not be listening.
      probes: { postgres: { host: '127.0.0.1', port: 1 }, redis: null },
    });
    const deps = await metrics.sampleDependencies();
    expect(deps.postgres.tcpConnectMs).toBeNull();
    expect(deps.postgres.reachable).toBe(false);
  }, 20000);

  test('a short sample window reports no trend rather than a fabricated one', () => {
    // Extrapolating a few seconds to an hourly rate yields absurd figures.
    const points = [
      { x: 0, y: 100 },
      { x: 1000, y: 200 },
      { x: 2000, y: 300 },
    ];
    expect(OperationalMetrics.trendPerHour(points, 2000)).toBeNull();
    expect(OperationalMetrics.trendPerHour(points, 3600000)).not.toBeNull();
  });

  test('stats ignore nulls and report null rather than zero when empty', () => {
    expect(OperationalMetrics.stats([null, null])).toEqual({
      samples: 0, min: null, max: null, avg: null, p95: null,
    });
    expect(OperationalMetrics.stats([1, 2, 3, null]).samples).toBe(3);
  });
});

describe('operational qualification: chaos is opt-in', () => {
  const Harness = require('../../operational-qualification/operational-qualification');
  const config = require('../../operational-qualification/config/qualification-config.json');

  test('chaos defaults to disabled when no options are supplied', () => {
    expect(new Harness(config).options.chaos).toBe(false);
  });

  test('failures.*.enabled in config does not by itself enable injection', () => {
    // Every failure entry is enabled: true in the shipped config. That selects
    // scenarios; it must not arm them.
    const anyEnabled = Object.values(config.failures).some((f) => f && f.enabled);
    expect(anyEnabled).toBe(true);
    expect(new Harness(config).failureInjector.enabled).toBe(false);
  });

  test('injection arms only when chaos is explicitly requested', () => {
    expect(new Harness(config, { chaos: true }).failureInjector.enabled).toBe(true);
  });

  test('with chaos disabled, executeAll injects nothing and reports skipped', async () => {
    const harness = new Harness(config);
    harness.failureInjector.registerFailure('database');
    const results = await harness.failureInjector.executeAll();

    expect(results).toHaveLength(1);
    expect(results[0].executed).toBe(false);
    expect(results[0].status).toBe('skipped');
    expect(results[0].recoveryTime).toBeNull();
  });
});

describe('operational qualification: harness is runnable', () => {
  const StackOrchestrator = require('../../operational-qualification/orchestrator/stack-orchestrator');

  test('startService does not shadow the global process object', () => {
    // Regression: `const process = spawn(...)` put the global `process` into
    // the temporal dead zone, so every call threw
    // "Cannot access 'process' before initialization" and the harness could
    // never start a single service.
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'operational-qualification', 'orchestrator', 'stack-orchestrator.js'),
      'utf8'
    );
    expect(source).not.toMatch(/const\s+process\s*=/);
    expect(source).not.toMatch(/\(\s*process\s*,\s*name\s*\)\s*=>/);
  });

  test('workload config keys match the keys the harness reads', () => {
    const config = require('../../operational-qualification/config/qualification-config.json');
    const required = [
      'conversation', 'memory-storage', 'memory-retrieval',
      'supervisor-status', 'bridge-request', 'database-operation',
    ];
    for (const key of required) {
      expect(config.workloads[key]).toBeDefined();
      expect(config.workloads[key].endpoint).toMatch(/^https?:\/\//);
    }
  });

  test('workloads use the configured endpoint verbatim without re-appending a path', () => {
    const {
      ConversationWorkload, MemoryStorageWorkload, MemoryRetrievalWorkload,
      SupervisorStatusWorkload, BridgeRequestWorkload, DatabaseOperationWorkload,
    } = require('../../operational-qualification/workloads/workload-driver');

    const url = 'http://example.test/api/thing';
    for (const Workload of [
      ConversationWorkload, MemoryStorageWorkload, MemoryRetrievalWorkload,
      SupervisorStatusWorkload, BridgeRequestWorkload, DatabaseOperationWorkload,
    ]) {
      expect(new Workload(url).endpoint).toBe(url);
    }

    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'operational-qualification', 'workloads', 'workload-driver.js'),
      'utf8'
    );
    // Regression: fetch(`${this.apiUrl}/api/chat`) against an endpoint that
    // already ended in /api/chat produced /api/chat/api/chat.
    expect(source).not.toMatch(/fetch\(`\$\{this\.\w+\}\/api/);
  });

  test('services manifest referenced by the orchestrator exists', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'services-manifest.json'))).toBe(true);
    expect(() => new StackOrchestrator({}).loadManifest()).not.toThrow();
  });
});

describe('failure injection reports only what it actually executed', () => {
  const { FailureInjector } = require('../../operational-qualification/failures/failure-injector');

  test('no scenario fabricates a recovery or a data integrity pass', () => {
    const source = fs.readFileSync(
      path.join(REPO_ROOT, 'operational-qualification', 'failures', 'failure-injector.js'),
      'utf8'
    );
    // The original scenarios were sleeps that returned hardcoded booleans.
    expect(source).not.toMatch(/validateDataIntegrity\s*\([^)]*\)\s*\{\s*return true/);
    expect(source).not.toMatch(/await this\.sleep\(\d+\); \/\/ Simulate/);
    expect(source).not.toMatch(/class DatabaseFailureScenario/);
  });

  test('statistics exclude skipped scenarios from the success rate', () => {
    const injector = new FailureInjector({}, { enabled: true });
    injector.registerFailure('database');
    injector.results = [
      { failure: 'database', executed: false, status: 'skipped', recoveryTime: null },
    ];

    const stats = injector.getStatistics().database;
    // Nothing ran, so there is no success rate to report — not 100%.
    expect(stats.executed).toBe(0);
    expect(stats.skipped).toBe(1);
    expect(stats.successRate).toBeNull();
  });

  test('data integrity is never asserted as verified', () => {
    const injector = new FailureInjector({}, { enabled: true });
    injector.registerFailure('database');
    injector.results = [
      { failure: 'database', executed: true, status: 'passed', recoveryTime: 1200, dataIntegrity: null },
    ];
    expect(injector.getStatistics().database.dataIntegrityRate).toBeNull();
  });
});

describe('qualification reports reflect only executed tests', () => {
  const ReportGenerator = require('../../operational-qualification/reports/report-generator');
  const config = require('../../operational-qualification/config/qualification-config.json');

  const baseData = {
    qualificationType: 'quick',
    duration: 60000,
    stackLifecycle: { status: 'started', startTime: Date.now() - 60000, services: ['next-app'] },
    stackShutdown: { status: 'stopped', shutdownTime: Date.now(), uptimeMs: 60000 },
    workloadExecution: [
      { workload: 'conversation', success: true, duration: 120, timestamp: Date.now() },
      { workload: 'conversation', success: true, duration: 130, timestamp: Date.now() },
    ],
    metrics: [],
  };

  test('a chaos-free run never reports resilience as passed', () => {
    const report = new ReportGenerator(config).generateReport({ ...baseData, chaosEnabled: false });
    const resilience = report.acceptanceCriteria.filter((c) =>
      /failure scenarios|Recovery time|Data integrity/i.test(c.name)
    );

    expect(resilience.length).toBeGreaterThan(0);
    for (const criterion of resilience) {
      expect(criterion.status).toBe('not_tested');
      expect(criterion.classification).toBe('NOT TESTED');
    }
  });

  test('a chaos-free run is never graded a clean pass', () => {
    const report = new ReportGenerator(config).generateReport({ ...baseData, chaosEnabled: false });
    expect(report.summary.status).toBe('pass_with_gaps');
  });

  test('startup and shutdown are graded from separate records', () => {
    const report = new ReportGenerator(config).generateReport({ ...baseData, chaosEnabled: false });
    const starts = report.acceptanceCriteria.find((c) => c.name === 'Stack starts successfully');
    const stops = report.acceptanceCriteria.find((c) => c.name === 'Stack stops gracefully');

    // Both must be able to pass in the same run; grading both from one status
    // field guaranteed one always failed.
    expect(starts.status).toBe('pass');
    expect(stops.status).toBe('pass');
  });

  test('skipped scenarios are classified NOT TESTED, not passed', () => {
    const report = new ReportGenerator(config).generateReport({
      ...baseData,
      chaosEnabled: true,
      failureInjection: [
        { failure: 'redis', executed: false, status: 'skipped', reason: 'container not running', recoveryTime: null },
      ],
    });

    expect(report.failureInjection.details[0].classification).toBe('NOT TESTED');
    const criterion = report.acceptanceCriteria.find((c) => /failure scenarios recover/i.test(c.name));
    expect(criterion.status).toBe('not_tested');
  });

  test('executed and recovered scenarios are reported as verified', () => {
    const report = new ReportGenerator(config).generateReport({
      ...baseData,
      chaosEnabled: true,
      failureInjection: [
        {
          failure: 'process-crash', executed: true, status: 'passed',
          recoveryTime: 4200, observedBehaviour: 'endpoint recovered', dataIntegrity: null,
        },
      ],
    });

    expect(report.failureInjection.details[0].classification).toBe('VERIFIED');
    const criterion = report.acceptanceCriteria.find((c) => /executed failure scenarios recover/i.test(c.name));
    expect(criterion.status).toBe('pass');
  });

  test('a phase with no data is not_executed rather than pass', () => {
    const report = new ReportGenerator(config).generateReport({
      qualificationType: 'quick', duration: 0, chaosEnabled: false,
    });
    expect(report.summary.phases.workloadExecution).toBe('not_executed');
    expect(report.summary.phases.metrics).toBe('not_executed');
  });

  test('report carries an explicit scope statement listing untested areas', () => {
    const report = new ReportGenerator(config).generateReport({ ...baseData, chaosEnabled: false });
    expect(report.scopeStatement.chaosEnabled).toBe(false);
    expect(report.scopeStatement.notTested).toEqual(
      expect.arrayContaining(['supervisor recovery', 'database recovery', 'Redis recovery'])
    );
    expect(report.scopeStatement.caveat).toMatch(/NO failure injection/);
  });

  test('every acceptance criterion carries a classification', () => {
    const report = new ReportGenerator(config).generateReport({ ...baseData, chaosEnabled: false });
    const allowed = ['VERIFIED', 'OBSERVED', 'INFERRED', 'PENDING', 'NOT TESTED'];
    for (const criterion of report.acceptanceCriteria) {
      expect(allowed).toContain(criterion.classification);
    }
  });

  test('inconclusive leak detection is PENDING, not a pass', () => {
    const now = Date.now();
    const shortWindow = [
      { epochMs: now, cpu: { systemPercent: 10 }, memory: { systemUsedPercent: 50, harnessHeapUsedBytes: 1000 }, processCount: 100, harnessHandles: 3, disk: null, dependencies: { postgres: {}, redis: {} } },
      { epochMs: now + 1000, cpu: { systemPercent: 11 }, memory: { systemUsedPercent: 51, harnessHeapUsedBytes: 2000 }, processCount: 100, harnessHandles: 3, disk: null, dependencies: { postgres: {}, redis: {} } },
      { epochMs: now + 2000, cpu: { systemPercent: 12 }, memory: { systemUsedPercent: 52, harnessHeapUsedBytes: 3000 }, processCount: 100, harnessHandles: 3, disk: null, dependencies: { postgres: {}, redis: {} } },
    ];

    const report = new ReportGenerator(config).generateReport({
      ...baseData, chaosEnabled: false, metrics: shortWindow,
    });

    const criterion = report.acceptanceCriteria.find((c) => /resource leaks/i.test(c.name));
    expect(criterion.status).toBe('not_tested');
    expect(criterion.classification).toBe('PENDING');
  });
});
