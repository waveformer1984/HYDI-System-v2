/**
 * Metrics Collector
 * =================
 *
 * Collects system metrics during qualification.
 *
 * This is a thin adapter over scripts/lib/soak-metrics.js so that the
 * qualification harness and the soak harness report identical, comparable
 * numbers from one implementation.
 *
 * Defects in the previous standalone implementation, corrected by delegating:
 *   - CPU usage was computed from cumulative since-boot os.cpus() totals, so
 *     every sample was nearly identical and the derived "trend" was noise.
 *     It is now an interval delta.
 *   - Process count returned os.cpus().length (a CPU core count) labelled as a
 *     process count. It now reads the real OS process table, or null.
 *   - Handle count was a hardcoded 0 placeholder presented as a measurement.
 *     It now reports the harness's libuv handle count, or null.
 *   - Disk metrics recursively walked process.cwd() (including node_modules)
 *     on every sample, which is slow and measures repo size rather than disk
 *     utilisation. It now reports filesystem utilisation via statfs.
 */

const { OperationalMetrics } = require('../../scripts/lib/soak-metrics');

class MetricsCollector {
  /** @param {object} config the `metrics` section of qualification-config.json */
  constructor(config) {
    this.config = config || {};
    this.intervalId = null;
    this.startTime = null;
    this.metrics = [];
    this.operational = new OperationalMetrics({
      probes: {
        postgres: { host: process.env.PGHOST || '127.0.0.1', port: Number(process.env.PGPORT || 5432) },
        redis: { host: process.env.REDIS_HOST || '127.0.0.1', port: Number(process.env.REDIS_PORT || 6379) },
      },
    });
  }

  start() {
    console.log('[MetricsCollector] Starting metrics collection...');
    this.startTime = Date.now();

    const interval = this.config.interval || 30000;

    this.intervalId = setInterval(() => {
      this.collectMetrics().catch((err) => {
        console.error('[MetricsCollector] Sample failed:', err.message);
      });
    }, interval);
    // Do not hold the event loop open purely for sampling.
    if (typeof this.intervalId.unref === 'function') this.intervalId.unref();

    this.collectMetrics().catch(() => {});
  }

  stop() {
    console.log('[MetricsCollector] Stopping metrics collection...');

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    return this.metrics;
  }

  async collectMetrics() {
    const sample = await this.operational.sample();
    this.metrics.push(sample);

    const cpu = sample.cpu.systemPercent;
    const mem = sample.memory.systemUsedPercent;
    console.log(
      `[MetricsCollector] CPU ${cpu === null ? 'n/a' : `${cpu.toFixed(1)}%`}, ` +
      `Memory ${mem === null ? 'n/a' : `${mem.toFixed(1)}%`}, ` +
      `Processes ${sample.processCount ?? 'n/a'}`
    );

    return sample;
  }

  getMetrics() {
    return this.metrics;
  }

  getSummary() {
    return this.operational.summarise();
  }

  /**
   * Resource leak check based on the memory trend of the harness process.
   *
   * Returns `hasLeaks: null` when the sample window is too short to support a
   * trend, so an inconclusive run is never reported as "no leaks detected".
   */
  checkForResourceLeaks() {
    const summary = this.getSummary();
    if (!summary) return { hasLeaks: null, reason: 'no samples collected', details: null };

    if (!summary.trendWindowSufficient) {
      return {
        hasLeaks: null,
        reason: `sample window ${(summary.windowMs / 60000).toFixed(1)}m is below the ` +
          `${(summary.minTrendWindowMs / 60000).toFixed(0)}m minimum required for a trend`,
        details: null,
      };
    }

    // Threshold in bytes/hour of harness heap growth.
    const threshold = this.config.leakThresholdBytesPerHour || 5 * 1024 * 1024;
    const heapTrend = summary.memory.harnessHeapTrendBytesPerHour;
    const rssTrend = summary.memory.harnessRssTrendBytesPerHour;

    const heapLeak = typeof heapTrend === 'number' && heapTrend > threshold;
    const rssLeak = typeof rssTrend === 'number' && rssTrend > threshold;

    return {
      hasLeaks: heapLeak || rssLeak,
      scope: 'harness process only — service processes are not instrumented',
      details: {
        heap: { trendBytesPerHour: heapTrend, hasLeak: heapLeak, threshold },
        rss: { trendBytesPerHour: rssTrend, hasLeak: rssLeak, threshold },
      },
    };
  }
}

module.exports = MetricsCollector;
