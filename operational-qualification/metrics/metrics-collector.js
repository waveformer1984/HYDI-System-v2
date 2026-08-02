/**
 * Metrics Collector
 * Collects system metrics during qualification
 */

const os = require('os');
const fs = require('fs');
const path = require('path');

class MetricsCollector {
  constructor(config) {
    this.config = config;
    this.metrics = [];
    this.intervalId = null;
    this.startTime = null;
  }

  /**
   * Start metrics collection
   */
  start() {
    console.log('[MetricsCollector] Starting metrics collection...');
    this.startTime = Date.now();

    const interval = this.config.interval || 30000; // Default 30 seconds

    this.intervalId = setInterval(() => {
      this.collectMetrics();
    }, interval);

    // Collect initial metrics
    this.collectMetrics();
  }

  /**
   * Stop metrics collection
   */
  stop() {
    console.log('[MetricsCollector] Stopping metrics collection...');

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    return this.metrics;
  }

  /**
   * Collect current system metrics
   */
  collectMetrics() {
    const timestamp = Date.now();
    const uptime = this.startTime ? timestamp - this.startTime : 0;

    const metrics = {
      timestamp,
      uptimeMs: uptime,
      cpu: this.getCpuMetrics(),
      memory: this.getMemoryMetrics(),
      disk: this.getDiskMetrics(),
      processes: this.getProcessMetrics(),
      handles: this.getHandleMetrics()
    };

    this.metrics.push(metrics);
    console.log(`[MetricsCollector] Metrics collected: CPU ${metrics.cpu.usage.toFixed(1)}%, Memory ${metrics.memory.usage.toFixed(1)}%`);

    return metrics;
  }

  /**
   * Get CPU metrics
   */
  getCpuMetrics() {
    const cpus = os.cpus();
    const cpuInfo = os.cpus()[0];

    return {
      count: cpus.length,
      model: cpuInfo.model,
      speed: cpuInfo.speed,
      usage: this.getCpuUsage()
    };
  }

  /**
   * Get CPU usage percentage
   */
  getCpuUsage() {
    const cpus = os.cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach(cpu => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - (100 * idle / total);

    return usage;
  }

  /**
   * Get memory metrics
   */
  getMemoryMetrics() {
    const total = os.totalmem();
    const free = os.freemem();
    const used = total - free;

    return {
      totalBytes: total,
      usedBytes: used,
      freeBytes: free,
      usage: (used / total) * 100
    };
  }

  /**
   * Get disk metrics
   */
  getDiskMetrics() {
    const stats = fs.statSync(process.cwd());
    const size = this.getDirectorySize(process.cwd());

    return {
      path: process.cwd(),
      sizeBytes: size
    };
  }

  /**
   * Get directory size
   */
  getDirectorySize(dirPath) {
    let size = 0;

    try {
      const files = fs.readdirSync(dirPath);

      files.forEach(file => {
        const filePath = path.join(dirPath, file);
        const stats = fs.statSync(filePath);

        if (stats.isDirectory()) {
          size += this.getDirectorySize(filePath);
        } else {
          size += stats.size;
        }
      });
    } catch (error) {
      console.error('[MetricsCollector] Error getting directory size:', error);
    }

    return size;
  }

  /**
   * Get process metrics
   */
  getProcessMetrics() {
    return {
      count: this.getProcessCount(),
      pid: process.pid,
      uptime: process.uptime()
    };
  }

  /**
   * Get process count
   */
  getProcessCount() {
    // Note: This is a simplified implementation
    // In a real implementation, you'd use a proper process monitoring library
    return os.cpus().length; // Approximation
  }

  /**
   * Get handle metrics
   */
  getHandleMetrics() {
    // Note: This is a simplified implementation
    // In a real implementation, you'd use a proper handle monitoring library
    return {
      count: 0 // Placeholder
    };
  }

  /**
   * Get all collected metrics
   */
  getMetrics() {
    return this.metrics;
  }

  /**
   * Get metrics summary statistics
   */
  getSummary() {
    if (this.metrics.length === 0) {
      return null;
    }

    const cpuUsages = this.metrics.map(m => m.cpu.usage);
    const memoryUsages = this.metrics.map(m => m.memory.usage);

    return {
      totalSamples: this.metrics.length,
      durationMs: this.metrics[this.metrics.length - 1].timestamp - this.metrics[0].timestamp,
      cpu: {
        min: Math.min(...cpuUsages),
        max: Math.max(...cpuUsages),
        avg: cpuUsages.reduce((a, b) => a + b, 0) / cpuUsages.length,
        trend: this.calculateTrend(cpuUsages)
      },
      memory: {
        min: Math.min(...memoryUsages),
        max: Math.max(...memoryUsages),
        avg: memoryUsages.reduce((a, b) => a + b, 0) / memoryUsages.length,
        trend: this.calculateTrend(memoryUsages)
      }
    };
  }

  /**
   * Calculate trend (positive = increasing, negative = decreasing)
   */
  calculateTrend(values) {
    if (values.length < 2) return 0;

    const firstHalf = values.slice(0, Math.floor(values.length / 2));
    const secondHalf = values.slice(Math.floor(values.length / 2));

    const firstAvg = firstHalf.reduce((a, b) => a + b, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((a, b) => a + b, 0) / secondHalf.length;

    return secondAvg - firstAvg;
  }

  /**
   * Check for resource leaks
   */
  checkForResourceLeaks() {
    const summary = this.getSummary();

    if (!summary) {
      return { hasLeaks: false, details: null };
    }

    const cpuTrend = summary.cpu.trend;
    const memoryTrend = summary.memory.trend;

    const threshold = this.config.leakThreshold || 5; // 5% increase trend

    const cpuLeak = cpuTrend > threshold;
    const memoryLeak = memoryTrend > threshold;

    return {
      hasLeaks: cpuLeak || memoryLeak,
      details: {
        cpu: {
          hasLeak: cpuLeak,
          trend: cpuTrend,
          threshold
        },
        memory: {
          hasLeak: memoryLeak,
          trend: memoryTrend,
          threshold
        }
      }
    };
  }
}

module.exports = MetricsCollector;
