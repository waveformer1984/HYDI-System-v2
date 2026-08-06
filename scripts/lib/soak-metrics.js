'use strict';

/**
 * Operational metrics sampling for the endurance soak harness.
 *
 * Measurement honesty rules enforced here:
 *  - Any metric that cannot be measured on this platform/configuration is
 *    reported as `null`, never as `0`. A zero is a measurement; a null is an
 *    absence of measurement, and the reporter classifies them differently.
 *  - CPU is sampled as a *delta* between consecutive samples. A cumulative
 *    since-boot figure (the common os.cpus() mistake) is near-constant and
 *    makes trend analysis meaningless, so it is not used.
 *  - Latency probes state exactly what they measured. A TCP connect probe is
 *    reported as `tcpConnectMs`, never as "query latency".
 */

const os = require('os');
const net = require('net');
const fs = require('fs');
const { execFile } = require('child_process');

function execFileAsync(cmd, args, timeoutMs = 5000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { timeout: timeoutMs, windowsHide: true }, (err, stdout) => {
      resolve(err ? null : stdout);
    });
  });
}

/** Aggregate busy/idle jiffies across all cores. */
function cpuTotals() {
  let idle = 0;
  let total = 0;
  for (const cpu of os.cpus()) {
    for (const type of Object.keys(cpu.times)) total += cpu.times[type];
    idle += cpu.times.idle;
  }
  return { idle, total };
}

/**
 * TCP connect latency probe. Measures time to complete a TCP handshake only.
 * Returns null when the endpoint is not configured or unreachable.
 */
function tcpProbe(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    if (!host || !port) return resolve({ tcpConnectMs: null, reachable: null });

    const started = process.hrtime.bigint();
    const socket = new net.Socket();
    let settled = false;

    const finish = (reachable) => {
      if (settled) return;
      settled = true;
      const ms = Number(process.hrtime.bigint() - started) / 1e6;
      socket.destroy();
      resolve({ tcpConnectMs: reachable ? Math.round(ms * 100) / 100 : null, reachable });
    };

    socket.setTimeout(timeoutMs);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
    socket.connect(port, host);
  });
}

class OperationalMetrics {
  constructor(options = {}) {
    this.samples = [];
    this.maxSamples = options.maxSamples || 5000;
    this.probes = options.probes || {};

    this.prevCpu = cpuTotals();
    this.prevProcCpu = process.cpuUsage();
    this.prevSampleAt = Date.now();

    // Event counters, incremented by the harness process hooks.
    this.counters = {
      restarts: 0,
      exceptions: 0,
      unhandledRejections: 0,
      chaosInjections: 0,
    };
  }

  increment(counter, by = 1) {
    if (counter in this.counters) this.counters[counter] += by;
  }

  /**
   * System-wide CPU utilisation over the interval since the previous sample.
   * The first sample after construction covers the harness start-up window.
   */
  sampleSystemCpu() {
    const now = cpuTotals();
    const idleDelta = now.idle - this.prevCpu.idle;
    const totalDelta = now.total - this.prevCpu.total;
    this.prevCpu = now;
    if (totalDelta <= 0) return null;
    return Math.round((100 - (100 * idleDelta) / totalDelta) * 100) / 100;
  }

  /** Harness-process CPU utilisation over the interval, normalised to one core. */
  sampleProcessCpu(elapsedMs) {
    const usage = process.cpuUsage(this.prevProcCpu);
    this.prevProcCpu = process.cpuUsage();
    if (elapsedMs <= 0) return null;
    const usedMs = (usage.user + usage.system) / 1000;
    return Math.round((usedMs / elapsedMs) * 100 * 100) / 100;
  }

  /**
   * Live OS process count. Uses the platform process table; returns null when
   * that is unavailable rather than substituting an approximation.
   */
  async sampleProcessCount() {
    if (process.platform === 'win32') {
      const out = await execFileAsync('tasklist', ['/fo', 'csv', '/nh']);
      if (!out) return null;
      return out.split('\n').filter((l) => l.trim().length > 0).length;
    }
    const out = await execFileAsync('ps', ['-e', '--no-headers']);
    if (!out) return null;
    return out.split('\n').filter((l) => l.trim().length > 0).length;
  }

  /**
   * Active libuv handles/requests held by the harness process. This is
   * harness-local only — it says nothing about the services under test.
   */
  sampleHandles() {
    const handles = typeof process._getActiveHandles === 'function'
      ? process._getActiveHandles().length
      : null;
    const requests = typeof process._getActiveRequests === 'function'
      ? process._getActiveRequests().length
      : null;
    return { harnessHandles: handles, harnessRequests: requests };
  }

  /** Free/total bytes for the filesystem holding `path`, or null if unsupported. */
  sampleDisk(path) {
    if (typeof fs.statfsSync !== 'function') return null;
    try {
      const st = fs.statfsSync(path);
      const totalBytes = st.blocks * st.bsize;
      const freeBytes = st.bavail * st.bsize;
      return {
        totalBytes,
        freeBytes,
        usedBytes: totalBytes - freeBytes,
        usedPercent: totalBytes > 0
          ? Math.round(((totalBytes - freeBytes) / totalBytes) * 10000) / 100
          : null,
      };
    } catch {
      return null;
    }
  }

  async sampleDependencies() {
    const { postgres, redis } = this.probes;
    const [pg, rd] = await Promise.all([
      postgres ? tcpProbe(postgres.host, postgres.port) : Promise.resolve({ tcpConnectMs: null, reachable: null }),
      redis ? tcpProbe(redis.host, redis.port) : Promise.resolve({ tcpConnectMs: null, reachable: null }),
    ]);
    return { postgres: pg, redis: rd };
  }

  /** Collect one full sample. */
  async sample() {
    const now = Date.now();
    const elapsedMs = now - this.prevSampleAt;
    this.prevSampleAt = now;

    // Force a full GC before reading heap figures when the process was started
    // with --expose-gc. Without this, harnessHeapUsedBytes measures V8's GC
    // *laziness*, not retention: a small-heap process under no memory pressure
    // lets heapUsed drift upward for the whole sample window, and the
    // least-squares slope then reports a "leak" (e.g. the 9.7 MB/hr FAIL on a
    // process whose heap never exceeded 18 MB). Post-GC sampling makes the
    // trend measure actual retained memory. When --expose-gc is absent the raw
    // (noisier) figure is used, as before.
    if (typeof global.gc === 'function') {
      try { global.gc(); } catch (_) { /* non-fatal */ }
    }

    const mem = process.memoryUsage();
    const [processCount, dependencies] = await Promise.all([
      this.sampleProcessCount(),
      this.sampleDependencies(),
    ]);

    const sample = {
      timestamp: new Date(now).toISOString(),
      epochMs: now,
      uptimeSeconds: process.uptime(),
      cpu: {
        systemPercent: this.sampleSystemCpu(),
        harnessPercent: this.sampleProcessCpu(elapsedMs),
        cores: os.cpus().length,
        loadAvg1m: process.platform === 'win32' ? null : os.loadavg()[0],
      },
      memory: {
        harnessHeapUsedBytes: mem.heapUsed,
        harnessHeapTotalBytes: mem.heapTotal,
        harnessRssBytes: mem.rss,
        harnessExternalBytes: mem.external,
        systemTotalBytes: os.totalmem(),
        systemFreeBytes: os.freemem(),
        systemUsedPercent: Math.round(((os.totalmem() - os.freemem()) / os.totalmem()) * 10000) / 100,
      },
      processCount,
      ...this.sampleHandles(),
      disk: this.sampleDisk(process.cwd()),
      dependencies,
      counters: { ...this.counters },
    };

    this.samples.push(sample);
    if (this.samples.length > this.maxSamples) this.samples.shift();
    return sample;
  }

  /**
   * Least-squares slope per hour; null when there is insufficient data.
   *
   * A slope is only reported once the sample window is at least
   * MIN_TREND_WINDOW_MS. Extrapolating a short warm-up window to an hourly
   * rate produces large, meaningless figures (a 12s window trivially yields
   * "+700 MB/h"), so a short window reports null rather than a false trend.
   */
  static trendPerHour(points, windowMs = Infinity) {
    if (windowMs < OperationalMetrics.MIN_TREND_WINDOW_MS) return null;
    const valid = points.filter((p) => typeof p.y === 'number' && Number.isFinite(p.y));
    if (valid.length < 3) return null;
    const n = valid.length;
    const meanX = valid.reduce((s, p) => s + p.x, 0) / n;
    const meanY = valid.reduce((s, p) => s + p.y, 0) / n;
    let num = 0;
    let den = 0;
    for (const p of valid) {
      num += (p.x - meanX) * (p.y - meanY);
      den += (p.x - meanX) ** 2;
    }
    if (den === 0) return null;
    return (num / den) * 3600000;
  }

  static stats(values) {
    const valid = values.filter((v) => typeof v === 'number' && Number.isFinite(v));
    if (valid.length === 0) return { samples: 0, min: null, max: null, avg: null, p95: null };
    const sorted = [...valid].sort((a, b) => a - b);
    const round = (v) => Math.round(v * 100) / 100;
    return {
      samples: valid.length,
      min: round(sorted[0]),
      max: round(sorted[sorted.length - 1]),
      avg: round(valid.reduce((a, b) => a + b, 0) / valid.length),
      p95: round(sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))]),
    };
  }

  summarise() {
    if (this.samples.length === 0) return null;
    const first = this.samples[0];
    const windowMs = this.samples[this.samples.length - 1].epochMs - first.epochMs;
    const pick = (fn) => this.samples.map(fn);
    const trendPoints = (fn) => this.samples.map((s) => ({ x: s.epochMs - first.epochMs, y: fn(s) }));

    return {
      totalSamples: this.samples.length,
      windowMs,
      trendWindowSufficient: windowMs >= OperationalMetrics.MIN_TREND_WINDOW_MS,
      minTrendWindowMs: OperationalMetrics.MIN_TREND_WINDOW_MS,
      cpu: {
        systemPercent: OperationalMetrics.stats(pick((s) => s.cpu.systemPercent)),
        harnessPercent: OperationalMetrics.stats(pick((s) => s.cpu.harnessPercent)),
      },
      memory: {
        harnessHeapUsedBytes: OperationalMetrics.stats(pick((s) => s.memory.harnessHeapUsedBytes)),
        harnessRssBytes: OperationalMetrics.stats(pick((s) => s.memory.harnessRssBytes)),
        systemUsedPercent: OperationalMetrics.stats(pick((s) => s.memory.systemUsedPercent)),
        harnessHeapTrendBytesPerHour: OperationalMetrics.trendPerHour(
          trendPoints((s) => s.memory.harnessHeapUsedBytes), windowMs
        ),
        harnessRssTrendBytesPerHour: OperationalMetrics.trendPerHour(
          trendPoints((s) => s.memory.harnessRssBytes), windowMs
        ),
      },
      processCount: OperationalMetrics.stats(pick((s) => s.processCount)),
      harnessHandles: OperationalMetrics.stats(pick((s) => s.harnessHandles)),
      disk: OperationalMetrics.stats(pick((s) => (s.disk ? s.disk.usedPercent : null))),
      dependencies: {
        postgresTcpConnectMs: OperationalMetrics.stats(pick((s) => s.dependencies.postgres.tcpConnectMs)),
        redisTcpConnectMs: OperationalMetrics.stats(pick((s) => s.dependencies.redis.tcpConnectMs)),
      },
      counters: { ...this.counters },
    };
  }
}

/**
 * Minimum sample window before a per-hour trend is reported. Below this, the
 * extrapolation error dominates the signal.
 */
OperationalMetrics.MIN_TREND_WINDOW_MS = 10 * 60 * 1000;

module.exports = { OperationalMetrics, tcpProbe };
