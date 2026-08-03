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
 *   - process uptime, restart count, and exception/unhandled-rejection counts
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
 *   node scripts/soak-test.js --duration 1h        # endurance, 1 hour
 *   node scripts/soak-test.js --duration=30m       # endurance, 30 minutes
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
const os = require('os');
const http = require('http');
const https = require('https');
const logger = require('../lib/structured-logger');
const { OperationalMetrics } = require('./lib/soak-metrics');

const REPO_ROOT = path.join(__dirname, '..');
const DEFAULT_DURATION_MS = 86400000; // 24h
const DEFAULT_PROBE_INTERVAL_MS = 30000;
const DEFAULT_METRICS_INTERVAL_MS = 60000;
const SUCCESS_RATE_THRESHOLD = 99.5;

const DURATION_UNITS = {
  ms: 1,
  s: 1000,
  m: 60 * 1000,
  h: 60 * 60 * 1000,
  d: 24 * 60 * 60 * 1000,
};

// ---------------------------------------------------------------------------
// Argument / duration parsing
// ---------------------------------------------------------------------------

function parseDuration(raw) {
  if (raw === undefined || raw === null) return DEFAULT_DURATION_MS;
  const s = String(raw).trim();

  // Plain integer milliseconds still accepted for backwards compatibility.
  const asNumber = Number(s);
  if (Number.isFinite(asNumber) && asNumber > 0) return Math.floor(asNumber);

  // Reject strings that do not begin with a digit/decimal, e.g. "-1h" or "banana".
  if (!/^\s*\d/.test(s)) return DEFAULT_DURATION_MS;

  let total = 0;
  let found = false;
  const re = /(\d+\.?\d*)\s*(ms|m|s|h|d)/gi;
  let match;
  while ((match = re.exec(s)) !== null) {
    found = true;
    const v = parseFloat(match[1]);
    const mult = DURATION_UNITS[match[2].toLowerCase()];
    total += v * mult;
  }
  if (found) return Math.floor(total);

  logger.warn('Unrecognised duration value; using default 24h', { value: s });
  return DEFAULT_DURATION_MS;
}

function normaliseArgs(argv) {
  const out = [];
  for (const arg of argv.slice(2)) {
    const eq = arg.match(/^--([a-zA-Z0-9_-]+)=(.*)$/);
    if (eq) {
      out.push(`--${eq[1]}`, eq[2]);
    } else {
      out.push(arg);
    }
  }
  return out;
}

function parseArgs(argv) {
  const args = normaliseArgs(argv);
  const flag = (name) => args.includes(`--${name}`);
  const value = (name, fallback) => {
    const i = args.indexOf(`--${name}`);
    if (i !== -1 && i + 1 < args.length && !args[i + 1].startsWith('--')) return args[i + 1];
    return fallback;
  };

  const durationRaw = value('duration', process.env.SOAK_DURATION || String(DEFAULT_DURATION_MS));
  const durationMs = parseDuration(durationRaw);

  const scenariosRaw = value('chaos-scenarios', '');

  return {
    durationMs,
    durationText: `${(durationMs / 3600000).toFixed(2)}h`,
    probeIntervalMs: parseInt(value('interval', String(DEFAULT_PROBE_INTERVAL_MS)), 10) || DEFAULT_PROBE_INTERVAL_MS,
    metricsIntervalMs: parseInt(value('metrics-interval', String(DEFAULT_METRICS_INTERVAL_MS)), 10) || DEFAULT_METRICS_INTERVAL_MS,
    target: value('target', process.env.SOAK_TARGET || 'http://localhost:3000/api/health'),
    chaos: flag('chaos'),
    chaosScenarios: scenariosRaw ? scenariosRaw.split(',').map((s) => s.trim()).filter(Boolean) : [],
    chaosIntervalMs: parseInt(value('chaos-interval', String(3600000)), 10) || 3600000,
    dryRun: flag('dry-run'),
    supervised: flag('supervised'),
    listScenarios: flag('list-scenarios'),
    reportPath: value('report', path.join(REPO_ROOT, 'artifacts', 'soak')),
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ---------------------------------------------------------------------------
// Durable artifact writer
// ---------------------------------------------------------------------------

class SoakArtifactSet {
  constructor(runDir) {
    this.runDir = runDir;
    fs.mkdirSync(runDir, { recursive: true });

    this.paths = {
      log: path.join(runDir, 'soak.log'),
      metrics: path.join(runDir, 'metrics.json'),
      metricsJsonl: path.join(runDir, 'metrics.jsonl'),
      summary: path.join(runDir, 'summary.json'),
      report: path.join(runDir, 'report.md'),
      systemInfo: path.join(runDir, 'system-info.json'),
      configuration: path.join(runDir, 'configuration.json'),
    };

    this.metricsList = [];

    // Open the live log once and keep it open so we can fsync after every entry.
    this.logFd = fs.openSync(this.paths.log, 'a');
    fs.writeSync(this.logFd, ''); // touch
    fs.fsyncSync(this.logFd);

    fs.writeFileSync(this.paths.metricsJsonl, ''); // touch
    this._writeJson(this.paths.metrics, []);
  }

  _throwIfMissing(filePath) {
    if (!fs.existsSync(filePath)) {
      throw new Error(`required artifact could not be written: ${filePath}`);
    }
  }

  _writeJson(filePath, content) {
    fs.writeFileSync(filePath, JSON.stringify(content, null, 2));
    this._throwIfMissing(filePath);
  }

  appendLog(level, message, metadata = {}) {
    const line = JSON.stringify({
      timestamp: new Date().toISOString(),
      level,
      message,
      ...metadata,
    }) + '\n';
    try {
      fs.writeSync(this.logFd, line);
      fs.fsyncSync(this.logFd);
    } catch (err) {
      throw new Error(`soak.log write failed: ${err.message}`);
    }
  }

  appendMetricsSample(sample) {
    fs.appendFileSync(this.paths.metricsJsonl, JSON.stringify(sample) + '\n');
    this.metricsList.push(sample);
    this._writeJson(this.paths.metrics, this.metricsList);
  }

  writeInitial(systemInfo, configuration) {
    this._writeJson(this.paths.systemInfo, systemInfo);
    this._writeJson(this.paths.configuration, configuration);
  }

  finalise(systemInfo, configuration, summary, markdown) {
    this._writeJson(this.paths.systemInfo, systemInfo);
    this._writeJson(this.paths.configuration, configuration);
    this._writeJson(this.paths.summary, summary);
    fs.writeFileSync(this.paths.report, markdown);
    this._throwIfMissing(this.paths.report);

    fs.fsyncSync(this.logFd);
    fs.closeSync(this.logFd);
    this.logFd = null;

    this.verifyArtifacts();
  }

  verifyArtifacts() {
    const required = ['log', 'metrics', 'summary', 'report', 'systemInfo', 'configuration'];
    for (const k of required) {
      this._throwIfMissing(this.paths[k]);
    }
  }
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

    const ts = new Date(this.startTime).toISOString().replace(/[:.]/g, '-');
    this.runDir = path.join(options.reportPath, ts);

    this.artifacts = new SoakArtifactSet(this.runDir);
    this.artifacts.writeInitial(this.systemInfo(), this.sanitisedConfig());
    this.artifacts.appendLog('INFO', 'Soak harness initialised', this.sanitisedConfig());

    this.installProcessHooks();
  }

  systemInfo() {
    let pkgVersion = 'unknown';
    try {
      pkgVersion = require(path.join(REPO_ROOT, 'package.json')).version;
    } catch {}
    return {
      harness: 'scripts/soak-test.js',
      nodeVersion: process.version,
      platform: process.platform,
      arch: process.arch,
      cpuCount: os.cpus().length,
      totalMemoryBytes: os.totalmem(),
      packageVersion: pkgVersion,
      cwd: process.cwd(),
      startTimestamp: new Date(this.startTime).toISOString(),
    };
  }

  sanitisedConfig() {
    return {
      durationMs: this.options.durationMs,
      durationText: this.options.durationText,
      probeIntervalMs: this.options.probeIntervalMs,
      metricsIntervalMs: this.options.metricsIntervalMs,
      target: this.options.target,
      chaos: this.options.chaos,
      chaosScenarios: this.options.chaosScenarios,
      chaosIntervalMs: this.options.chaosIntervalMs,
      dryRun: this.options.dryRun,
      supervised: this.options.supervised,
      reportPath: this.options.reportPath,
    };
  }

  installProcessHooks() {
    process.on('uncaughtException', (err) => {
      this.metrics.increment('exceptions');
      this.artifacts.appendLog('ERROR', 'uncaughtException', { error: err.message });
      logger.error('Soak harness uncaught exception', { error: err.message });
    });
    process.on('unhandledRejection', (reason) => {
      this.metrics.increment('unhandledRejections');
      const msg = reason instanceof Error ? reason.message : String(reason);
      this.artifacts.appendLog('ERROR', 'unhandledRejection', { reason: msg });
    });
  }

  stop(reason) {
    this.isRunning = false;
    this.stopReason = reason;
    this.artifacts.appendLog('WARN', 'Soak harness stopping early', { reason });
    logger.warn('Soak harness stopping early', { reason });
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
    this.artifacts.appendLog('INFO', 'probe', result);
    return result;
  }

  async collectMetrics() {
    const sample = await this.metrics.sample();
    this.artifacts.appendMetricsSample(sample);
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
      this.artifacts.appendLog('WARN', 'Chaos mode enabled', {
        scenarios: this.chaos.selected.map((s) => s.name),
        dryRun: this.options.dryRun,
      });
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
        this.artifacts.appendLog('INFO', 'metrics sample collected', { timestamp: sample.timestamp });
        this.logProgress(sample);
      }

      if (this.chaos && Date.now() - lastChaosAt >= this.options.chaosIntervalMs) {
        const scenario = this.chaos.nextScenario(chaosIndex);
        if (scenario) {
          chaosIndex += 1;
          this.metrics.increment('chaosInjections');
          const result = await this.chaos.runScenario(scenario);
          this.artifacts.appendLog('INFO', 'chaos scenario', result);
          if (result.status === 'passed' && typeof result.recoveryMs === 'number') {
            this.metrics.increment('restarts');
          }
        }
        lastChaosAt = Date.now();
      }

      const remaining = durationMs - (Date.now() - this.startTime);
      if (remaining <= 0) break;
      await sleep(Math.min(probeIntervalMs, remaining));
    }

    await this.collectMetrics();
    return this.finalise();
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
      operational: {
        uptimeSeconds: process.uptime(),
        restartCount: this.metrics.counters.restarts,
        exceptionCount: this.metrics.counters.exceptions,
        unhandledRejectionCount: this.metrics.counters.unhandledRejections,
        metricsSummary,
      },
      findings,
      result: {
        passed,
        basis: passed
          ? `success rate ${successRate.toFixed(2)}% met the ${SUCCESS_RATE_THRESHOLD}% threshold over ${(elapsedMs / 3600000).toFixed(2)}h with no unrecovered chaos failures`
          : `success rate ${successRate.toFixed(2)}% did not meet the ${SUCCESS_RATE_THRESHOLD}% threshold, or a chaos scenario failed, or no probes were delivered`,
        scopeCaveat: 'This is an endurance harness. Resilience/recovery is only measured when --chaos is explicitly enabled.',
      },
    };
  }

  finalise() {
    this.artifacts.appendLog('INFO', 'Soak harness finalising', {
      elapsedMs: Date.now() - this.startTime,
    });
    this.report = this.buildReport();
    const markdown = generateMarkdownReport(this.report);
    this.artifacts.finalise(
      this.systemInfo(),
      this.sanitisedConfig(),
      this.report,
      markdown
    );
    return this.report;
  }
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

function formatBytesPerHour(v) {
  if (v === null || v === undefined) return 'n/a';
  const abs = Math.abs(v);
  if (abs > 1024 * 1024 * 1024) return `${(v / (1024 * 1024 * 1024)).toFixed(2)}GB/h`;
  if (abs > 1024 * 1024) return `${(v / (1024 * 1024)).toFixed(2)}MB/h`;
  if (abs > 1024) return `${(v / 1024).toFixed(2)}KB/h`;
  return `${v.toFixed(2)}B/h`;
}

function fmt(v) { return v === null || v === undefined ? 'n/a' : v; }
function fmtMB(v) { return v === null || v === undefined ? 'n/a' : `${(v / 1048576).toFixed(1)}MB`; }

function generateMarkdownReport(report) {
  const md = [];
  const { metadata, endurance, operational, findings, result } = report;

  md.push('# HYDI Soak Qualification Report');
  md.push('');
  md.push(`- **Harness:** ${metadata.harness}`);
  md.push(`- **Mode:** ${metadata.mode}`);
  md.push(`- **Target:** ${metadata.target}`);
  md.push(`- **Started:** ${metadata.startedAt}`);
  md.push(`- **Generated:** ${metadata.generatedAt}`);
  md.push(`- **Requested duration:** ${(metadata.requestedDurationMs / 3600000).toFixed(2)}h`);
  md.push(`- **Actual duration:** ${(metadata.actualDurationMs / 3600000).toFixed(2)}h`);
  md.push(`- **Completed full duration:** ${metadata.completedFullDuration ? 'yes' : 'no'}`);
  if (metadata.stopReason) md.push(`- **Stop reason:** ${metadata.stopReason}`);
  md.push('');

  md.push('## Result');
  md.push('');
  md.push(`**${result.passed ? 'PASS' : 'FAIL'}**`);
  md.push('');
  md.push(`**Basis:** ${result.basis}`);
  md.push('');
  md.push(`*Scope caveat:* ${result.scopeCaveat}`);
  md.push('');

  md.push('## Endurance');
  md.push('');
  md.push(`| Metric | Value |`);
  md.push(`| --- | --- |`);
  md.push(`| Requests | ${endurance.requests} |`);
  md.push(`| Successes | ${endurance.successes} |`);
  md.push(`| Failures | ${endurance.failures} |`);
  md.push(`| Success rate | ${endurance.successRatePercent}% (threshold ${endurance.thresholdPercent}%) |`);
  md.push(`| Latency avg | ${fmt(endurance.latencyMs.avg)} ms |`);
  md.push(`| Latency min | ${fmt(endurance.latencyMs.min)} ms |`);
  md.push(`| Latency max | ${fmt(endurance.latencyMs.max)} ms |`);
  md.push(`| Latency p95 | ${fmt(endurance.latencyMs.p95)} ms |`);
  md.push('');

  if (endurance.failureSamples.length > 0) {
    md.push('### First failure samples');
    md.push('');
    for (const f of endurance.failureSamples) {
      md.push(`- ${f.timestamp}: ${f.error || `HTTP ${f.statusCode}`} (${f.latencyMs}ms)`);
    }
    md.push('');
  }

  md.push('## Operational Metrics');
  md.push('');
  md.push(`| Metric | Value |`);
  md.push(`| --- | --- |`);
  md.push(`| Uptime | ${fmt(operational.uptimeSeconds)} s |`);
  md.push(`| Restart count | ${fmt(operational.restartCount)} |`);
  md.push(`| Exception count | ${fmt(operational.exceptionCount)} |`);
  md.push(`| Unhandled rejection count | ${fmt(operational.unhandledRejectionCount)} |`);

  const m = operational.metricsSummary;
  if (m) {
    md.push(`| Metric samples | ${m.totalSamples} |`);
    md.push(`| Sample window | ${(m.windowMs / 60000).toFixed(1)} m |`);
    md.push(`| Avg system CPU | ${fmt(m.cpu.systemPercent.avg)}% |`);
    md.push(`| Avg harness CPU | ${fmt(m.cpu.harnessPercent.avg)}% |`);
    md.push(`| Avg heap used | ${fmtMB(m.memory.harnessHeapUsedBytes.avg)} |`);
    md.push(`| Avg RSS | ${fmtMB(m.memory.harnessRssBytes.avg)} |`);
    md.push(`| Heap trend | ${formatBytesPerHour(m.memory.harnessHeapTrendBytesPerHour)} |`);
    md.push(`| RSS trend | ${formatBytesPerHour(m.memory.harnessRssTrendBytesPerHour)} |`);
    md.push(`| Avg process count | ${fmt(m.processCount.avg)} |`);
    md.push(`| Avg disk used | ${fmt(m.disk.avg)}% |`);
    md.push(`| PostgreSQL TCP connect | ${fmt(m.dependencies.postgresTcpConnectMs.avg)} ms |`);
    md.push(`| Redis TCP connect | ${fmt(m.dependencies.redisTcpConnectMs.avg)} ms |`);
  }
  md.push('');

  md.push('## Findings');
  md.push('');
  md.push(`| Classification | Finding | Evidence |`);
  md.push(`| --- | --- | --- |`);
  for (const f of findings) {
    md.push(`| ${f.classification} | ${f.finding} | ${f.evidence} |`);
  }
  md.push('');

  md.push('---');
  md.push(`*Report generated by ${metadata.harness} from ${metadata.reportDir}*\n`);

  return md.join('\n');
}

function printSummary(report) {
  const line = '─'.repeat(70);
  console.log(line);
  console.log('HYDI Soak Qualification Summary');
  console.log(line);
  console.log(`Mode:    ${report.metadata.mode}`);
  console.log(`Target:  ${report.metadata.target}`);
  console.log(`Duration: ${(report.metadata.actualDurationMs / 3600000).toFixed(2)}h of ${(report.metadata.requestedDurationMs / 3600000).toFixed(2)}h`);
  console.log(`Requests: ${report.endurance.requests} (${report.endurance.successes} ok / ${report.endurance.failures} fail)`);
  console.log(`Success:  ${report.endurance.successRatePercent}% (threshold ${report.endurance.thresholdPercent}%)`);
  console.log(`Latency:  avg ${fmt(report.endurance.latencyMs.avg)}ms / max ${fmt(report.endurance.latencyMs.max)}ms`);
  console.log(`CPU:      ${fmt(report.operational.metricsSummary?.cpu.systemPercent.avg)}% avg`);
  console.log(`Heap:     ${fmtMB(report.operational.metricsSummary?.memory.harnessHeapUsedBytes.avg)} avg`);
  console.log(`Uptime:   ${fmt(report.operational.uptimeSeconds)}s`);
  console.log(line);
  console.log(report.result.passed ? 'RESULT: PASS' : 'RESULT: FAIL');
  console.log(`Basis:  ${report.result.basis}`);
  console.log(`Scope:  ${report.result.scopeCaveat}`);
  console.log(`Artifacts: ${report.metadata.reportDir}`);
  console.log(line);
}

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

  process.on('SIGINT', () => test.stop('SIGINT'));
  process.on('SIGTERM', () => test.stop('SIGTERM'));

  try {
    const report = await test.run();
    printSummary(report);

    if (report.result.passed && report.metadata.completedFullDuration) {
      console.log(`\nAll artifacts written to: ${report.metadata.reportDir}`);
      return 0;
    }
    if (!report.metadata.completedFullDuration) {
      console.error('\nSoak qualification stopped before the requested duration.');
    }
    console.error(`\nSoak qualification failed: ${report.result.basis}`);
    return 1;
  } catch (err) {
    test.artifacts.appendLog('FATAL', 'Soak harness fatal error', { error: err.message });
    logger.error('Soak harness fatal error', { error: err.message });
    console.error(`\nFATAL: ${err.message}`);
    return 1;
  }
}

if (require.main === module) {
  main()
    .then((code) => process.exit(code))
    .catch((err) => {
      logger.error('Soak harness aborted', { error: err.message, stack: err.stack });
      process.exit(1);
    });
}

module.exports = { SoakTest, SoakArtifactSet, parseArgs, parseDuration, DEFAULT_DURATION_MS, SUCCESS_RATE_THRESHOLD };
