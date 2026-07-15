'use strict';

const { randomUUID } = require('crypto');

/**
 * PerformanceBenchmark measures startup time, mission planning, queue latency,
 * database, memory usage, reflection engine, and task dispatch.
 */
class PerformanceBenchmark {
  constructor(config = {}) {
    this.config = {
      iterations: config.iterations || 100,
      ...config,
    };
    this.results = [];
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
    await this.benchmarkStartup(components);
    await this.benchmarkMissionPlanning(components);
    await this.benchmarkQueueLatency(components);
    await this.benchmarkDatabase(components);
    await this.benchmarkMemoryUsage(components);
    await this.benchmarkReflectionEngine(components);
    await this.benchmarkTaskDispatch(components);

    return this.getReport();
  }

  getReport() {
    const report = {
      total: this.results.length,
      passed: this.results.filter((r) => r.passed).length,
      failed: this.results.filter((r) => !r.passed).length,
      results: this.results,
      targets: {
        startupUnderMs: 10000,
        missionPlanningUnderMs: 500,
        taskDispatchUnderMs: 100,
        recoveryUnderMs: 5000,
        memoryLeakGrowthPerDay: 0.01,
      },
      meetsTargets: this.meetsTargets(),
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
}

module.exports = PerformanceBenchmark;
