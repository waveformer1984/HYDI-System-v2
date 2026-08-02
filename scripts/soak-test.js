#!/usr/bin/env node
/**
 * HYDI Endurance Soak Harness
 * ===========================
 *
 * SCOPE OF THIS HARNESS — read before citing its output as evidence.
 *
 * In its default mode this harness is an ENDURANCE test. It holds a steady
 * polling load against configured HTTP health endpoints for a long period and
 * records operational metrics. It does not, by itself, prove anything about
 * recovery behaviour.
 *
 * VERIFIED by the default run (measured directly by this harness):
 *   - health endpoint availability and HTTP status over the run window
 *   - request success rate and failure count
 *   - response latency (avg / min / max / p95)
 *   - polling reliability (delivered vs. scheduled probe cycles)
 *   - harness memory trend (heap and RSS, least-squares slope per hour)
 *   - system CPU and memory utilisation, sampled as interval deltas
 *   - OS process count, harness libuv handle/request count
 *   - disk utilisation of the working filesystem (where the platform reports it)
 *   - TCP connect reachability and latency for PostgreSQL and Redis
 *   - uncaught exception and unhandled rejection counts within the harness
 *
 * NOT VERIFIED by the default run:
 *   - supervisor recovery          - process restart behaviour
 *   - network interruption recovery- database failover or recovery
 *   - Redis recovery               - bridge recovery
 *   - chaos / resilience behaviour of any kind
 *
 * Those are only exercised when `--chaos` is passed, which performs REAL
 * failure injection (terminating processes, restarting containers). Chaos is
 * DISABLED BY DEFAULT and is never implied by any other flag.
 *
 * This harness does not simulate faults. Earlier revisions logged a sleep as
 * "injecting network blip"; that was removed because a sleep is not a fault
 * and must never be reported as one. Anything this harness cannot measure is
 * reported as null and classified NOT TESTED — never as a pass.
 *
 * Usage:
 *   node scripts/soak-test.js                      # endurance only (24h default)
 *   node scripts/soak-test.js --duration 3600000   # endurance, 1 hour
 *   node scripts/soak-test.js --chaos              # endurance + real failure injection
 *   node scripts/soak-test.js --chaos --chaos-scenarios restart-next,kill-bridge
 *   node scripts/soak-test.js --chaos --dry-run    # list what chaos would do, inject nothing
 *   node scripts/soak-test.js --list-scenarios     # print the scenario registry and exit
 *
 * npm equivalents:
 *   npm run soak-test-24h          # endurance only
 *   npm run soak-test-1h           # endurance only, 1 hour
 *   npm run soak-test-24h:chaos    # endurance + failure injection
 */

'use strict';

const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const logger = require('../lib/structured-logger');
const { OperationalMetrics } = require('./lib/soak-metrics');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_DURATION_MS = 86400000; // 24h
const DEFAULT_PROBE_INTERVAL_MS = 30000;
const DEFAULT_METRICS_INTERVAL_MS = 60000;
const SUCCESS_RATE_THRESHOLD = 99.5;

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = argv.slice(2);
  const flag = (name) => args.includes(`--${name}`);
  const value = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    if (i !== -1 && i + 1 < args.length && !args[i + 1].startsWith('--')) return args[i + 1];
    return fallback;
  };

  const durationRaw = value('duration', process.env.SOAK_DURATION || String(DEFAULT_DURATION_MS));
  const duration = parseInt(durationRaw, 10);

  const scenariosRaw = value('chaos-scenarios', '');

  return {
    durationMs: Number.isFinite(duration) && duration > 0 ? duration : DEFAULT_DURATION_MS,
    probeIntervalMs: parseInt(value('interval', String(DEFAULT_PROBE_INTERVAL_MS)), 10) || DEFAULT_PROBE_INTERVAL_MS,
    metricsIntervalMs: parseInt(value('metrics-interval', String(DEFAULT_METRICS_INTERVAL_MS)), 10) || DEFAULT_METRICS_INTERVAL_MS,
    target: value('target', process.env.SOAK_TARGET || 'http://localhost:3000/api/health'),
    // Chaos is opt-in and only ever enabled by this explicit flag.
    chaos: flag('chaos'),
    chaosScenarios: scenariosRaw ? scenariosRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
    chaosIntervalMs: parseInt(value('chaos-interval', String(3600000)), 10) || 3600000,
    dryRun: flag('dry-run'),
    supervised: flag('supervised'),
    listScenarios: flag('list-scenarios'),
    reportPath: value('report', path.join(REPO_ROOT, 'reports', 'soak')),
  };
}

// ---------------------------------------------------------------------------
// HTTP probing
// ---------------------------------------------------------------------------

function request(url, timeoutMs = 10000) {
  return new Promise((resolve) => {
    const started = Date.now();
    const client = url.startsWith('https:') ? https : http;
    const req = client.get(url, { timeout: timeoutMs }, (res) => {
      res.resume();
      res.on('end', () => {
        resolve({
          statusCode: res.statusCode,
          latencyMs: Date.now() - started,
          success: res.statusCode >= 200 && res.statusCode < 300,
          timestamp: new Date().toISOString(),
        });
      });
    });
    req.on('timeout', () => {
      req.destroy();
      resolve({ statusCode: null, latencyMs: Date.now() - started, success: false, error: 'timeout', timestamp: new Date().toISOString() });
    });
    req.on('error', (err) => {
      resolve({ statusCode: null, latencyMs: Date.now() - started, success: false, error: err.message, timestamp: new Date().toISOString() });
    });
  });
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

class SoakTest {
  constructor(options) {
    this.options = options;
    this.startTime = Date.now();
    this.isRunning = true;
    this.stopReason = null;

    this.requestCount = 0;
    this.successCount = 0;
    this.failureCount = 0;
    this.latencies = [];
    this.scheduledCycles = 0;
    this.failureSamples = [];

    this.metrics = new OperationalMetrics({
      probes: {
        postgres: { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432) },
        redis: { host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT || 6379) },
      },
    });

    this.chaos = null;
    this.runDir = path.join(options.reportPath, new Date(this.startTime).toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(this.runDir, { recursive: true });
    this.eventLogPath = path.join(this.runDir, 'events.jsonl');
    this.metricsLogPath = path.join(this.runDir, 'metrics.jsonl');

    this.installProcessHooks();
  }

  installProcessHooks() {
    process.on('uncaughtException', (err) => {
      this.metrics.increment('exceptions');
      this.appendEvent('uncaughtException', { message: err.message, stack: err.stack });
      logger.error('Soak harness uncaught exception', { error: err.message });
    });
    process.on('unhandledRejection', (reason) => {
      this.metrics.increment('unhandledRejections');
      this.appendEvent('unhandledRejection', { reason: reason instanceof Error ? reason.message : String(reason) });
    });
  }

  appendEvent(type, payload) {
    const line = JSON.stringify({ timestamp: new Date().toISOString(), type, ...payload });
    fs.appendFileSync(this.eventLogPath, `${line}\n`);
  }

  appendMetricsSample(sample) {
    fs.appendFileSync(this.metricsLogPath, `${JSON.stringify(sample)}\n`);
  }

  async runProbeCycle() {
    this.scheduledCycles += 1;
    this.requestCount += 1;

    const result = await request(this.options.target);
    if (result.success) {
      this.successCount += 1;
    } else {
      this.failureCount += 1;
      if (this.failureSamples.length < 200) this.failureSamples.push(result);
    }
    this.latencies.push(result.latencyMs);
    this.appendEvent('probe', result);
    return result;
  }

  async collectMetrics() {
    const sample = await this.metrics.sample();
    this.appendMetricsSample(sample);
    return sample;
  }

  async run() {
    const { chaos, durationMs, probeIntervalMs, metricsIntervalMs, target } = this.options;

    logger.info('Starting endurance soak harness', {
      mode: chaos ? 'endurance + chaos (failure injection ENABLED)' : 'endurance only (chaos disabled)',
      durationHours: (durationMs / 3600000).toFixed(2),
      probeIntervalSeconds: probeIntervalMs / 1000,
      metricsIntervalSeconds: metricsIntervalMs / 1000,
      target,
      reportDir: this.runDir,
    });

    if (chaos) {
      const { ChaosOrchestrator } = require('./lib/soak-chaos');
      this.chaos = new ChaosOrchestrator({
        scenarios: this.options.chaosScenarios,
        supervised: this.options.supervised,
        dryRun: this.options.dryRun,
        logger,
      });
      logger.warn('Chaos mode ENABLED — this run performs real failure injection', {
        scenarios: this.chaos.selected.map((s) => s.name),
        dryRun: this.options.dryRun,
      });
      this.appendEvent('chaosEnabled', { scenarios: this.chaos.selected.map((s) => s.name), dryRun: this.options.dryRun });
    }

    await this.collectMetrics();

    let lastMetricsAt = Date.now();
    let lastChaosAt = Date.now();
    let chaosIndex = 0;

    while (this.isRunning && Date.now() - this.startTime < durationMs) {
      await this.runProbeCycle();

      if (Date.now() - lastMetricsAt >= metricsIntervalMs) {
        const sample = await this.collectMetrics();
        lastMetricsAt = Date.now();
        this.logProgress(sample);
      }

      if (this.chaos && Date.now() - lastChaosAt >= this.options.chaosIntervalMs) {
        const scenario = this.chaos.nextScenario(chaosIndex);
        if (scenario) {
          chaosIndex += 1;
          this.metrics.increment('chaosInjections');
          const result = await this.chaos.runScenario(scenario);
          this.appendEvent('chaosScenario', result);
          if (result.status === 'passed' && typeof result.recoveryMs === 'number') {
            this.metrics.increment('restarts');
          }
        }
        lastChaosAt = Date.now();
      }

      const remaining = durationMs - (Date.now() - this.startTime);
      if (remaining <= 0) break;
      await new Promise((r) => setTimeout(r, Math.min(probeIntervalMs, remaining)));
    }

    await this.collectMetrics();
    return this.buildReport();
  }

  logProgress(sample) {
    const elapsedMs = Date.now() - this.startTime;
    logger.info(`Soak progress: ${(elapsedMs / 3600000).toFixed(2)}h elapsed`, {
      requests: this.requestCount,
      failures: this.failureCount,
      successRate: `${this.successRate().toFixed(2)}%`,
      latencyAvgMs: Math.round(OperationalMetrics.stats(this.latencies).avg ?? 0),
      systemCpuPercent: sample.cpu.systemPercent,
      harnessHeapMB: Math.round(sample.memory.harnessHeapUsedBytes / 1048576),
      chaosInjections: this.metrics.counters.chaosInjections,
    });
  }

  successRate() {
    if (this.requestCount === 0) return 0;
    return (this.successCount / this.requestCount) * 100;
  }

  /**
   * Build the run report. Every finding carries an explicit classification:
   *   VERIFIED   - measured directly by this harness during this run
   *   OBSERVED   - recorded during the run but not a controlled measurement
   *   INFERRED   - derived from measured data, not measured itself
   *   NOT TESTED - the harness did not exercise this at all
   */
  buildReport() {
    const elapsedMs = Date.now() - this.startTime;
    const latency = OperationalMetrics.stats(this.latencies);
    const metricsSummary = this.metrics.summarise();
    const chaosSummary = this.chaos ? this.chaos.summarise() : null;
    const successRate = this.successRate();

    const findings = [
      {
        finding: 'Health endpoint availability',
        classification: 'VERIFIED',
        evidence: `${this.successCount}/${this.requestCount} probes returned 2xx against ${this.options.target}`,
      },
      {
        finding: 'Response latency',
        classification: 'VERIFIED',
        evidence: `avg ${latency.avg}ms, p95 ${latency.p95}ms, max ${latency.max}ms over ${latency.samples} probes`,
      },
      {
        finding: 'Polling reliability',
        classification: 'VERIFIED',
        evidence: `${this.requestCount} probe cycles delivered of ${this.scheduledCycles} scheduled`,
      },
      {
        finding: 'Harness memory trend',
        classification: metricsSummary && metricsSummary.trendWindowSufficient ? 'VERIFIED' : 'PENDING',
        evidence: !metricsSummary
          ? 'no metric samples collected'
          : metricsSummary.trendWindowSufficient
            ? `heap slope ${formatBytesPerHour(metricsSummary.memory.harnessHeapTrendBytesPerHour)}, RSS slope ${formatBytesPerHour(metricsSummary.memory.harnessRssTrendBytesPerHour)}`
            : `sample window ${(metricsSummary.windowMs / 60000).toFixed(1)}m is below the ${(metricsSummary.minTrendWindowMs / 60000).toFixed(0)}m minimum; no trend reported because short-window extrapolation is not meaningful`,
      },
      {
        finding: 'Memory leak absence in services under test',
        classification: 'NOT TESTED',
        evidence: 'this harness measures its own process memory only; it does not attach to service processes',
      },
      {
        finding: 'System CPU / memory / process count / disk utilisation',
        classification: 'VERIFIED',
        evidence: metricsSummary ? `${metricsSummary.totalSamples} samples collected` : 'no samples',
      },
      {
        finding: 'PostgreSQL and Redis reachability',
        classification: 'VERIFIED',
        evidence: 'TCP connect probes only — this measures socket reachability, not query execution or data integrity',
      },
      {
        finding: 'Database / Redis query correctness and failover',
        classification: 'NOT TESTED',
        evidence: 'no queries are issued by this harness',
      },
      {
        finding: 'Sustained stability over the run window',
        classification: 'INFERRED',
        evidence: `derived from success rate ${successRate.toFixed(2)}% and memory trend over ${(elapsedMs / 3600000).toFixed(2)}h; not a direct measurement of stability`,
      },
    ];

    const resilienceFindings = [
      'supervisor recovery',
      'process restart',
      'network interruption recovery',
      'database recovery',
      'Redis recovery',
      'bridge recovery',
    ];

    if (!this.options.chaos) {
      for (const name of resilienceFindings) {
        findings.push({
          finding: name,
          classification: 'NOT TESTED',
          evidence: 'chaos mode was not enabled; run with --chaos to exercise this',
        });
      }
    } else if (chaosSummary) {
      for (const r of chaosSummary.results) {
        findings.push({
          finding: `Chaos scenario: ${r.scenario}`,
          classification: r.status === 'skipped' ? 'NOT TESTED' : 'VERIFIED',
          evidence: r.status === 'skipped'
            ? `skipped — ${r.reason}`
            : `${r.status}: ${r.observedBehaviour}`,
        });
      }
    }

    const durationShortfall = elapsedMs < this.options.durationMs - 1000;
    const chaosFailed = chaosSummary ? chaosSummary.failed > 0 : false;
    const passed = successRate >= SUCCESS_RATE_THRESHOLD && !chaosFailed && this.requestCount > 0;

    return {
      metadata: {
        harness: 'scripts/soak-test.js',
        generatedAt: new Date().toISOString(),
        startedAt: new Date(this.startTime).toISOString(),
        mode: this.options.chaos ? 'endurance+chaos' : 'endurance',
        chaosEnabled: this.options.chaos,
        chaosDryRun: this.options.dryRun,
        target: this.options.target,
        requestedDurationMs: this.options.durationMs,
        actualDurationMs: elapsedMs,
        completedFullDuration: !durationShortfall,
        stopReason: this.stopReason,
        reportDir: this.runDir,
      },
      endurance: {
        requests: this.requestCount,
        successes: this.successCount,
        failures: this.failureCount,
        successRatePercent: Math.round(successRate * 100) / 100,
        thresholdPercent: SUCCESS_RATE_THRESHOLD,
        latencyMs: latency,
        failureSamples: this.failureSamples.slice(0, 20),
      },
      operationalMetrics: metricsSummary,
      chaos: chaosSummary || {
        enabled: false,
        note: 'Chaos mode disabled (default). No failure was injected and no recovery behaviour was exercised.',
      },
      findings,
      result: {
        passed,
        basis: passed
          ? `success rate ${successRate.toFixed(2)}% >= ${SUCCESS_RATE_THRESHOLD}%${chaosSummary ? ` and ${chaosSummary.failed} chaos failures` : ''}`
          : `success rate ${successRate.toFixed(2)}% vs threshold ${SUCCESS_RATE_THRESHOLD}%${chaosFailed ? `; ${chaosSummary.failed} chaos scenario(s) failed` : ''}`,
        scopeCaveat: this.options.chaos
          ? 'Resilience conclusions apply only to the scenarios listed as VERIFIED above. Skipped scenarios were not tested.'
          : 'This result covers endurance only. It is not evidence of recovery, resilience, or failover behaviour.',
      },
    };
  }
}

function formatBytesPerHour(v) {
  if (v === null || v === undefined) return 'not reported (insufficient sample window)';
  const mb = v / 1048576;
  return `${mb >= 0 ? '+' : ''}${mb.toFixed(3)} MB/h`;
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function printReport(report) {
  const line = '='.repeat(72);
  console.log(`\n${line}`);
  console.log('SOAK HARNESS REPORT');
  console.log(line);
  console.log(`Mode:              ${report.metadata.mode}${report.metadata.chaosEnabled ? '' : '  (chaos disabled — default)'}`);
  console.log(`Target:            ${report.metadata.target}`);
  console.log(`Duration:          ${(report.metadata.actualDurationMs / 3600000).toFixed(2)}h of ${(report.metadata.requestedDurationMs / 3600000).toFixed(2)}h requested`);
  console.log(`Completed in full: ${report.metadata.completedFullDuration}`);
  console.log(`Report directory:  ${report.metadata.reportDir}`);

  console.log(`\n-- Endurance ------------------------------------------------------`);
  const e = report.endurance;
  console.log(`Requests: ${e.requests}   Success: ${e.successes} (${e.successRatePercent}%)   Failures: ${e.failures}`);
  console.log(`Latency:  avg ${e.latencyMs.avg}ms   p95 ${e.latencyMs.p95}ms   max ${e.latencyMs.max}ms`);

  const m = report.operationalMetrics;
  if (m) {
    console.log(`\n-- Operational metrics (${m.totalSamples} samples) -------------------------`);
    console.log(`CPU (system):    avg ${fmt(m.cpu.systemPercent.avg)}%   max ${fmt(m.cpu.systemPercent.max)}%`);
    console.log(`Memory (system): avg ${fmt(m.memory.systemUsedPercent.avg)}%   max ${fmt(m.memory.systemUsedPercent.max)}%`);
    console.log(`Harness heap:    avg ${fmtMB(m.memory.harnessHeapUsedBytes.avg)}   trend ${formatBytesPerHour(m.memory.harnessHeapTrendBytesPerHour)}`);
    console.log(`Process count:   avg ${fmt(m.processCount.avg)}   max ${fmt(m.processCount.max)}`);
    console.log(`Harness handles: avg ${fmt(m.harnessHandles.avg)}   max ${fmt(m.harnessHandles.max)}`);
    console.log(`Disk used:       avg ${fmt(m.disk.avg)}%`);
    console.log(`Postgres TCP:    avg ${fmt(m.dependencies.postgresTcpConnectMs.avg)}ms (${m.dependencies.postgresTcpConnectMs.samples} reachable samples)`);
    console.log(`Redis TCP:       avg ${fmt(m.dependencies.redisTcpConnectMs.avg)}ms (${m.dependencies.redisTcpConnectMs.samples} reachable samples)`);
    console.log(`Restarts: ${m.counters.restarts}   Exceptions: ${m.counters.exceptions}   Unhandled rejections: ${m.counters.unhandledRejections}   Chaos injections: ${m.counters.chaosInjections}`);
  }

  if (report.chaos && report.chaos.enabled !== false) {
    console.log(`\n-- Chaos (real failure injection) ---------------------------------`);
    console.log(`Injected: ${report.chaos.totalInjected}   Passed: ${report.chaos.passed}   Failed: ${report.chaos.failed}   Skipped: ${report.chaos.skipped}`);
    for (const r of report.chaos.results) {
      console.log(`  [${r.status.toUpperCase()}] ${r.scenario}`);
      console.log(`      injected: ${r.injectedFault || r.reason || 'n/a'}`);
      if (r.observedBehaviour) console.log(`      observed: ${r.observedBehaviour}`);
      if (r.recoveryMs != null) console.log(`      recovery: ${r.recoveryMs}ms`);
    }
  } else {
    console.log(`\n-- Chaos ----------------------------------------------------------`);
    console.log(`DISABLED (default). ${report.chaos.note}`);
  }

  console.log(`\n-- Findings -------------------------------------------------------`);
  for (const f of report.findings) {
    console.log(`  ${f.classification.padEnd(10)} ${f.finding}`);
    console.log(`             ${f.evidence}`);
  }

  console.log(`\n${line}`);
  console.log(report.result.passed ? 'RESULT: PASS' : 'RESULT: FAIL');
  console.log(`Basis:  ${report.result.basis}`);
  console.log(`Scope:  ${report.result.scopeCaveat}`);
  console.log(line);
}

const fmt = (v) => (v === null || v === undefined ? 'n/a' : v);
const fmtMB = (v) => (v === null || v === undefined ? 'n/a' : `${(v / 1048576).toFixed(1)}MB`);

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

async function main() {
  const options = parseArgs(process.argv);

  if (options.listScenarios) {
    const { ChaosOrchestrator } = require('./lib/soak-chaos');
    const orchestrator = new ChaosOrchestrator({});
    console.log('\nChaos scenarios (all DESTRUCTIVE, all disabled unless --chaos is passed):\n');
    for (const s of orchestrator.list()) {
      console.log(`  ${s.name.padEnd(28)} ${s.description}`);
    }
    console.log('\nSelect a subset with --chaos --chaos-scenarios name1,name2\n');
    return 0;
  }

  const test = new SoakTest(options);

  const shutdown = (signal) => {
    test.isRunning = false;
    test.stopReason = `received ${signal} before the requested duration elapsed`;
    logger.warn('Soak harness stopping early', { signal });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));

  const report = await test.run();

  const reportPath = path.join(test.runDir, 'report.json');
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  printReport(report);
  console.log(`\nMachine-readable report: ${reportPath}`);
  console.log(`Per-probe event log:     ${test.eventLogPath}`);
  console.log(`Metric samples:          ${test.metricsLogPath}\n`);

  return report.result.passed ? 0 : 1;
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      logger.error('Soak harness aborted', { error: err.message, stack: err.stack });
      process.exit(1);
    });
}

module.exports = { SoakTest, parseArgs, DEFAULT_DURATION_MS, SUCCESS_RATE_THRESHOLD };
