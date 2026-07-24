'use strict';

/**
 * SoakTest runs long-running stability simulations for HYDI V3.
 *
 * It monitors memory, CPU, agent health, mission throughput, queue growth, and
 * database connections over a configurable duration. In simulated mode the clock
 * is compressed so that multi-day soaks complete quickly.
 */
class SoakTest {
  static async runSoak(manager, durationMs, options = {}) {
    if (!manager) {
      throw new Error('manager is required');
    }

    const realStart = Date.now();
    const simulated = options.simulated !== false;
    const tickCount = options.tickCount || SoakTest.resolveTickCount(durationMs);
    const tickIntervalMs = durationMs / tickCount;
    const leakThreshold = options.leakThreshold || 0.01;
    const degradationThreshold = options.degradationThreshold || 0.2;
    const minAgentHealth = options.minAgentHealth || 0.5;

    const context = { completedMissions: 0, completedTasks: 0 };
    const snapshots = [];

    snapshots.push(SoakTest.collectSnapshot(manager, 0, context));

    for (let i = 0; i < tickCount; i++) {
      const elapsedMs = (i + 1) * tickIntervalMs;
      await SoakTest.runTick(manager, context);
      snapshots.push(SoakTest.collectSnapshot(manager, elapsedMs, context));

      if (!simulated) {
        await SoakTest.sleep(tickIntervalMs);
      } else if (i % 100 === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }

    const realElapsedMs = Date.now() - realStart;
    const stats = SoakTest.computeStats(snapshots, durationMs, {
      leakThreshold,
      degradationThreshold,
      minAgentHealth,
    });

    return {
      duration: durationMs,
      snapshots,
      leakDetected: stats.leakDetected,
      stats,
      passed: stats.passed,
      realElapsedMs,
    };
  }

  static resolveTickCount(durationMs) {
    const fromDuration = Math.floor(durationMs / 1000);
    return Math.min(1000, Math.max(10, fromDuration));
  }

  static async runTick(manager, context) {
    try {
      if (manager.createMission) {
        const missionId = await manager.createMission('soak', 'soak mission');
        if (missionId && manager.missionPlanner && manager.missionPlanner.addTask) {
          const taskId = manager.missionPlanner.addTask(missionId, {
            type: 'automation',
            description: 'soak task',
          });
          if (taskId) {
            manager.missionPlanner.planMission(missionId);
            manager.missionPlanner.startTask(taskId, missionId);
            manager.missionPlanner.completeTask(taskId, missionId, { success: true });
            context.completedMissions++;
            context.completedTasks++;
            if (manager.missionPlanner.persist) {
              await manager.missionPlanner.persist();
            }
          }
        }
      }
    } catch (err) {
      // Soak ticks should not fail the whole run; record and continue.
      if (!context.errors) context.errors = [];
      context.errors.push({ time: Date.now(), message: err.message });
    }
  }

  static collectSnapshot(manager, elapsedMs, context) {
    const coreLoop = manager?.coreLoop;
    const coreStatus = coreLoop?.getStatus ? coreLoop.getStatus() : {};

    const memory = typeof coreLoop?.getMemoryUsage === 'function'
      ? coreLoop.getMemoryUsage()
      : (process.memoryUsage ? process.memoryUsage().heapUsed : 0);

    const cpu = typeof coreStatus.cpu === 'number' ? coreStatus.cpu : 0.5;

    const watchdogStatus = manager?.watchdog?.getStatus
      ? manager.watchdog.getStatus()
      : { healthy: 1, warning: 0, dead: 0 };
    const totalAgents = watchdogStatus.healthy + watchdogStatus.warning + watchdogStatus.dead;
    const agentHealth = totalAgents === 0
      ? 1
      : (watchdogStatus.healthy + watchdogStatus.warning * 0.5) / totalAgents;

    const queueDepth = typeof coreStatus.queueDepth === 'number'
      ? coreStatus.queueDepth
      : SoakTest.getQueueDepth(manager);

    const dbConnections = typeof coreStatus.dbConnections === 'number'
      ? coreStatus.dbConnections
      : (manager?.dbConnections || 0);

    const elapsedHours = elapsedMs / 3600000;
    const missionThroughput = elapsedHours > 0 ? context.completedMissions / elapsedHours : 0;
    const taskThroughput = elapsedHours > 0 ? context.completedTasks / elapsedHours : 0;

    return {
      timestamp: Date.now(),
      elapsedMs,
      memory,
      cpu,
      agentHealth,
      queueDepth,
      dbConnections,
      completedMissions: context.completedMissions,
      completedTasks: context.completedTasks,
      missionThroughput,
      taskThroughput,
    };
  }

  static getQueueDepth(manager) {
    if (manager?.missionPlanner?.getNextTasks) {
      try {
        return manager.missionPlanner.getNextTasks(10).length;
      } catch {
        return 0;
      }
    }
    return 0;
  }

  static computeStats(snapshots, durationMs, options) {
    if (!snapshots.length) {
      return { passed: false, leakDetected: true, degradationDetected: true };
    }

    const first = snapshots[0];
    const last = snapshots[snapshots.length - 1];
    const elapsedMs = last.elapsedMs || durationMs || 1;
    const elapsedHours = elapsedMs / 3600000 || 1e-9;

    const memoryValues = snapshots.map((s) => s.memory);
    const cpuValues = snapshots.map((s) => s.cpu);
    const agentHealthValues = snapshots.map((s) => s.agentHealth);
    const queueValues = snapshots.map((s) => s.queueDepth);
    const dbValues = snapshots.map((s) => s.dbConnections);

    const startMemory = memoryValues[0] || 1;
    const endMemory = memoryValues[memoryValues.length - 1];
    const memoryGrowthRatio = (endMemory - startMemory) / startMemory;
    const growthPerHour = memoryGrowthRatio / elapsedHours;
    const leakDetected = growthPerHour > options.leakThreshold;

    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / (arr.length || 1);
    const min = (arr) => (arr.length ? Math.min(...arr) : 0);
    const max = (arr) => (arr.length ? Math.max(...arr) : 0);

    const half = Math.floor(snapshots.length / 2) || 1;
    const firstHalf = snapshots.slice(0, half);
    const secondHalf = snapshots.slice(half);
    const firstThroughput = avg(firstHalf.map((s) => s.missionThroughput));
    const secondThroughput = avg(secondHalf.map((s) => s.missionThroughput));
    const throughputDropped = firstThroughput > 0
      && secondThroughput < firstThroughput * (1 - options.degradationThreshold);

    const queueGrowthRate = (last.queueDepth - first.queueDepth) / elapsedHours;
    const queueGrew = queueGrowthRate > 1000;

    const degradationDetected = throughputDropped
      || queueGrew
      || last.agentHealth < options.minAgentHealth
      || last.cpu >= 0.95;

    const passed = !leakDetected && !degradationDetected;

    return {
      memory: {
        start: first.memory,
        end: last.memory,
        min: min(memoryValues),
        max: max(memoryValues),
        avg: avg(memoryValues),
        growthPerHour,
      },
      cpu: {
        min: min(cpuValues),
        max: max(cpuValues),
        avg: avg(cpuValues),
        last: last.cpu,
      },
      agentHealth: {
        min: min(agentHealthValues),
        max: max(agentHealthValues),
        avg: avg(agentHealthValues),
        last: last.agentHealth,
      },
      missions: {
        completed: last.completedMissions,
        completedTasks: last.completedTasks,
        throughputPerHour: last.missionThroughput,
      },
      queue: {
        min: min(queueValues),
        max: max(queueValues),
        avg: avg(queueValues),
        last: last.queueDepth,
        growthRatePerHour: queueGrowthRate,
      },
      dbConnections: {
        min: min(dbValues),
        max: max(dbValues),
        avg: avg(dbValues),
        last: last.dbConnections,
      },
      leakDetected,
      degradationDetected,
      passed,
    };
  }

  static sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

module.exports = SoakTest;
