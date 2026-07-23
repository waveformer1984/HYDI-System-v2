'use strict';

const { randomUUID } = require('crypto');
const fs = require('fs').promises;
const path = require('path');

/**
 * PerformanceBenchmark measures startup time, mission planning, queue latency,
 * database, memory usage, reflection engine, and task dispatch. It persists
 * historical results, compares runs to a baseline, and reports trends.
 */
class PerformanceBenchmark {
  constructor(config = {}) {
    this.config = {
      iterations: config.iterations || 100,
      storagePath: config.storagePath || path.resolve(__dirname, '../../data/perf-benchmark'),
      ...config,
    };
    this.results = [];
    this.history = [];
    this.historyPath = path.join(this.config.storagePath, 'history.json');
    this._historyLoaded = false;
  }

  async loadHistory() {
    try {
      await fs.mkdir(this.config.storagePath, { recursive: true });
      const data = await fs.readFile(this.historyPath, 'utf8');
      const parsed = JSON.parse(data);
      this.history = Array.isArray(parsed) ? parsed : [];
    } catch (err) {
      if (err.code !== 'ENOENT') {
        console.error('[PERFORMANCE BENCHMARK] loadHistory failed:', err.message);
      }
      this.history = [];
    }
    this._historyLoaded = true;
  }

  async persistHistory(report) {
    try {
      await fs.mkdir(this.config.storagePath, { recursive: true });
      const all = [...this.history, report];
      await fs.writeFile(this.historyPath, JSON.stringify(all, null, 2));
    } catch (err) {
      console.error('[PERFORMANCE BENCHMARK] persistHistory failed:', err.message);
    }
  }

  async measure(name, fn) {
    const start = Date.now();
    const startMemory = process.memoryUsage ? process.memoryUsage().heapUsed : 0;
    try {
      const result = await fn();
      const elapsed = Date.now() - start;
      const endMemory = process.memoryUsage ? process.memoryUsage().heapUsed : 0;
      const record = {
        id: randomUUID(),
        name,
        elapsed,
        memoryDelta: Math.max(0, endMemory - startMemory),
        passed: true,
        result,
      };
      this.results.push(record);
      return record;
    } catch (err) {
      const elapsed = Date.now() - start;
      const record = { id: randomUUID(), name, elapsed, passed: false, error: err.message };
      this.results.push(record);
      return record;
    }
  }

  async benchmarkStartup(components = {}) {
    return this.measure('startup', async () => {
      const start = Date.now();
      if (components.missionPlanner) await components.missionPlanner.initialize();
      if (components.decisionIntelligence) await components.decisionIntelligence.initialize();
      if (components.reflectionEngine) await components.reflectionEngine.initialize();
      return { startupTime: Date.now() - start };
    });
  }

  async benchmarkMissionPlanning(components = {}) {
    return this.measure('mission_planning', async () => {
      if (!components.missionPlanner) return { skipped: true };
      const start = Date.now();
      const missionId = components.missionPlanner.createMission('benchmark', 'benchmark mission');
      for (let i = 0; i < 10; i++) {
        components.missionPlanner.addObjective(missionId, { description: `obj_${i}` });
      }
      for (let i = 0; i < 50; i++) {
        components.missionPlanner.addTask(missionId, { type: 'automation', description: `task_${i}` });
      }
      components.missionPlanner.planMission(missionId);
      return { elapsed: Date.now() - start, taskCount: 50 };
    });
  }

  async benchmarkQueueLatency(components = {}) {
    return this.measure('queue_latency', async () => {
      if (!components.heartbeat) return { skipped: true };
      const start = Date.now();
      for (let i = 0; i < this.config.iterations; i++) {
        components.heartbeat.publish(`bench_${i}`, { timestamp: Date.now(), healthScore: 1 });
      }
      return { elapsed: Date.now() - start, iterations: this.config.iterations };
    });
  }

  async benchmarkDatabase(components = {}) {
    return this.measure('database', async () => {
      if (!components.decisionIntelligence) return { skipped: true };
      const start = Date.now();
      for (let i = 0; i < this.config.iterations; i++) {
        components.decisionIntelligence.appendDecision({
          id: `bench_${i}`,
          confidence: 0.9,
          timestamp: new Date().toISOString(),
        });
      }
      return { elapsed: Date.now() - start, iterations: this.config.iterations };
    });
  }

  async benchmarkMemoryUsage() {
    return this.measure('memory_usage', async () => {
      const start = process.memoryUsage ? process.memoryUsage().heapUsed : 0;
      const arr = [];
      for (let i = 0; i < 1000; i++) {
        arr.push({ id: i, data: 'x'.repeat(100) });
      }
      const end = process.memoryUsage ? process.memoryUsage().heapUsed : 0;
      return { delta: end - start, objectCount: arr.length };
    });
  }

  async benchmarkReflectionEngine(components = {}) {
    return this.measure('reflection_engine', async () => {
      if (!components.reflectionEngine || !components.missionPlanner) return { skipped: true };
      const missionId = components.missionPlanner.createMission('reflection-benchmark', 'benchmark');
      const task = components.missionPlanner.addTask(missionId, { type: 'revenue', description: 'task' });
      components.missionPlanner.startTask(task, missionId);
      components.missionPlanner.completeTask(task, missionId, { success: true, strategy: 'outreach' });
      const mission = components.missionPlanner.getMission(missionId);
      const start = Date.now();
      const reflection = await components.reflectionEngine.reflectOnMission(mission);
      return { elapsed: Date.now() - start, reflectionId: reflection?.id };
    });
  }

  async benchmarkTaskDispatch(components = {}) {
    return this.measure('task_dispatch', async () => {
      if (!components.missionPlanner) return { skipped: true };
      const missionId = components.missionPlanner.createMission('dispatch-benchmark', 'benchmark');
      for (let i = 0; i < 20; i++) {
        components.missionPlanner.addTask(missionId, { type: 'automation', description: `task_${i}` });
      }
      const start = Date.now();
      const tasks = components.missionPlanner.getNextTasks(5);
      return { elapsed: Date.now() - start, tasksDispatched: tasks.length };
    });
  }

  async runAll(components = {}) {
    await this.loadHistory();
    this.results = [];

    await this.benchmarkStartup(components);
    await this.benchmarkMissionPlanning(components);
    await this.benchmarkQueueLatency(components);
    await this.benchmarkDatabase(components);
    await this.benchmarkMemoryUsage(components);
    await this.benchmarkReflectionEngine(components);
    await this.benchmarkTaskDispatch(components);

    const report = this.getReport();
    await this.persistHistory(report);
    return report;
  }

  getTargets() {
    return {
      startupUnderMs: 10000,
      missionPlanningUnderMs: 500,
      taskDispatchUnderMs: 100,
      queueLatencyUnderMs: 10000,
      databaseUnderMs: 10000,
      reflectionEngineUnderMs: 10000,
      memoryUsageDeltaUnderBytes: 104857600,
      recoveryUnderMs: 5000,
      memoryLeakGrowthPerDay: 0.01,
    };
  }

  getReport() {
    const report = {
      total: this.results.length,
      passed: this.results.filter((r) => r.passed).length,
      failed: this.results.filter((r) => !r.passed).length,
      results: this.results,
      targets: this.getTargets(),
      meetsTargets: this.meetsTargets(),
      baselineComparison: this.compareToBaseline(),
      trends: this.getTrend(),
      runAt: Date.now(),
    };
    return report;
  }

  meetsTargets() {
    const byName = (name) => this.results.find((r) => r.name === name);
    const elapsed = (name) => {
      const e = byName(name)?.elapsed;
      return typeof e === 'number' ? e : Infinity;
    };
    const checks = {
      startup: elapsed('startup') < 10000,
      missionPlanning: elapsed('mission_planning') < 500,
      taskDispatch: elapsed('task_dispatch') < 100,
    };
    return checks;
  }

  getMetricRecord(name, source) {
    const results = source ? source.results : this.results;
    return results.find((r) => r.name === name);
  }

  getMetricValue(name, source) {
    const record = this.getMetricRecord(name, source);
    if (!record || record.result?.skipped) return null;
    if (name === 'memory_usage') {
      return typeof record.memoryDelta === 'number' ? record.memoryDelta : (record.result?.delta || 0);
    }
    return typeof record.elapsed === 'number' ? record.elapsed : null;
  }

  getTarget(name) {
    const targetMap = {
      startup: 'startupUnderMs',
      mission_planning: 'missionPlanningUnderMs',
      task_dispatch: 'taskDispatchUnderMs',
      queue_latency: 'queueLatencyUnderMs',
      database: 'databaseUnderMs',
      reflection_engine: 'reflectionEngineUnderMs',
      memory_usage: 'memoryUsageDeltaUnderBytes',
    };
    const targets = this.getTargets();
    return targets[targetMap[name]];
  }

  getBaseline(name) {
    for (let i = this.history.length - 1; i >= 0; i--) {
      const value = this.getMetricValue(name, this.history[i]);
      if (value !== null) return value;
    }
    return null;
  }

  compareToBaseline() {
    const metrics = [
      'startup',
      'mission_planning',
      'task_dispatch',
      'reflection_engine',
      'queue_latency',
      'database',
      'memory_usage',
    ];

    const comparison = {};
    for (const metric of metrics) {
      comparison[metric] = this.compareMetric(metric);
    }
    return comparison;
  }

  compareMetric(metric) {
    const record = this.getMetricRecord(metric);
    const current = this.getMetricValue(metric);
    const baseline = this.getBaseline(metric);
    const target = this.getTarget(metric);

    if (!record) {
      return { current: null, baseline, target, status: 'no-run', delta: null, deltaPercent: null, withinTarget: false };
    }

    if (record.result?.skipped) {
      return { current: null, baseline, target, status: 'skipped', delta: null, deltaPercent: null, withinTarget: true };
    }

    if (!record.passed) {
      return { current, baseline, target, status: 'failed', delta: null, deltaPercent: null, withinTarget: false };
    }

    if (baseline === null) {
      return { current, baseline: null, target, status: 'no-baseline', delta: null, deltaPercent: null, withinTarget: target !== undefined ? current <= target : true };
    }

    const delta = current - baseline;
    const deltaPercent = baseline > 0 ? (delta / baseline) * 100 : 0;
    const threshold = 0.1;
    let status = 'stable';
    if (delta < -baseline * threshold) status = 'better';
    else if (delta > baseline * threshold) status = 'worse';

    const withinTarget = target !== undefined ? current <= target : true;
    return { current, baseline, target, status, delta, deltaPercent, withinTarget };
  }

  getTrend() {
    const metrics = [
      'startup',
      'mission_planning',
      'task_dispatch',
      'reflection_engine',
      'queue_latency',
      'database',
      'memory_usage',
    ];

    const trends = {};
    for (const metric of metrics) {
      const values = this.history
        .map((h) => this.getMetricValue(metric, h))
        .filter((v) => typeof v === 'number');

      const currentValue = this.getMetricValue(metric);
      if (currentValue !== null) values.push(currentValue);

      const count = values.length;
      const current = count > 0 ? values[count - 1] : null;
      const first = count > 0 ? values[0] : null;
      const average = count > 0 ? values.reduce((a, b) => a + b, 0) / count : null;
      const min = count > 0 ? Math.min(...values) : null;
      const max = count > 0 ? Math.max(...values) : null;
      const delta = count > 1 ? current - first : 0;
      const slope = count > 1 ? delta / (count - 1) : 0;

      trends[metric] = {
        count,
        current,
        first,
        average,
        min,
        max,
        delta,
        slope,
      };
    }
    return trends;
  }

  async generateReport(format = 'json') {
    if (!this._historyLoaded) {
      await this.loadHistory();
    }
    const report = this.getReport();
    if (format === 'markdown') {
      return this.toMarkdown(report);
    }
    return report;
  }

  toMarkdown(report) {
    const lines = [];
    lines.push('# HYDI V3 Performance Report');
    lines.push(`Generated: ${new Date(report.runAt).toISOString()}`);
    lines.push(`Total: ${report.total} | Passed: ${report.passed} | Failed: ${report.failed}`);
    lines.push('');

    lines.push('## Results');
    lines.push('| Benchmark | Elapsed (ms) | Memory Delta (bytes) | Passed |');
    lines.push('| --- | --- | --- | --- |');
    for (const r of report.results) {
      const memory = r.name === 'memory_usage' ? (r.memoryDelta || r.result?.delta || 0) : '';
      lines.push(`| ${r.name} | ${r.elapsed} | ${memory} | ${r.passed} |`);
    }
    lines.push('');

    lines.push('## Targets');
    lines.push('| Target | Value |');
    lines.push('| --- | --- |');
    for (const [key, value] of Object.entries(report.targets)) {
      lines.push(`| ${key} | ${value} |`);
    }
    lines.push('');

    lines.push('## Baseline Comparison');
    lines.push('| Benchmark | Current | Baseline | Delta | Delta % | Status | Within Target |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const [key, value] of Object.entries(report.baselineComparison)) {
      const current = value.current !== null ? value.current : 'N/A';
      const baseline = value.baseline !== null ? value.baseline : 'N/A';
      const delta = value.delta !== null ? value.delta : 'N/A';
      const deltaPercent = value.deltaPercent !== null ? value.deltaPercent.toFixed(2) : 'N/A';
      const within = value.withinTarget ? 'yes' : 'no';
      lines.push(`| ${key} | ${current} | ${baseline} | ${delta} | ${deltaPercent} | ${value.status} | ${within} |`);
    }
    lines.push('');

    lines.push('## Trends');
    lines.push('| Benchmark | Count | Current | Average | Min | Max | Slope |');
    lines.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const [key, value] of Object.entries(report.trends)) {
      const current = value.current !== null ? value.current : 'N/A';
      const average = value.average !== null ? value.average.toFixed(2) : 'N/A';
      const min = value.min !== null ? value.min : 'N/A';
      const max = value.max !== null ? value.max : 'N/A';
      const slope = value.slope !== null ? value.slope.toFixed(4) : 'N/A';
      lines.push(`| ${key} | ${value.count} | ${current} | ${average} | ${min} | ${max} | ${slope} |`);
    }
    lines.push('');

    return lines.join('\n');
  }
}

module.exports = PerformanceBenchmark;
