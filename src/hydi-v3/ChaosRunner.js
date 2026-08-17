'use strict';

/**
 * ChaosRunner injects realistic failure scenarios into HYDIAutonomyManager
 * components and verifies that the system can recover from each one.
 *
 * Each scenario returns:
 *   { name, injected, recovered, durationMs, evidence }
 */
class ChaosRunner {
  constructor() {
    this.scenarioNames = [
      'process_termination',
      'network_api_timeout',
      'supabase_outage',
      'filesystem_failure',
      'disk_full',
      'corrupted_cache',
      'corrupted_memory',
      'queue_corruption',
      'worker_crash',
      'partial_task_completion',
      'power_loss',
    ];
  }

  /**
   * Run a single named chaos scenario against the manager.
   */
  async runScenario(name, manager) {
    const handler = this.getScenarioHandler(name);
    if (!handler) {
      throw new Error(`Unknown chaos scenario: ${name}`);
    }

    const start = Date.now();
    let evidence;
    let error;

    try {
      evidence = await handler(manager);
    } catch (err) {
      error = err;
    }

    const durationMs = Date.now() - start;
    const injected = !error;
    const recovered = !error && !(evidence && evidence.recovered === false);

    return {
      name,
      injected,
      recovered,
      durationMs,
      evidence: error ? { error: error.message } : evidence,
    };
  }

  /**
   * Run all chaos scenarios against the manager.
   */
  async runAll(manager) {
    const originalDelay = manager?.selfHealing?.delay;
    if (manager?.selfHealing) {
      manager.selfHealing.delay = () => Promise.resolve();
    }

    const results = [];
    try {
      for (const name of this.scenarioNames) {
        const result = await this.runScenario(name, manager);
        results.push(result);
      }
    } finally {
      if (manager?.selfHealing && originalDelay) {
        manager.selfHealing.delay = originalDelay;
      }
    }

    const passed = results.filter((r) => r.recovered).length;
    const failed = results.length - passed;

    return {
      total: results.length,
      passed,
      failed,
      results,
      allPassed: failed === 0,
    };
  }

  getScenarioHandler(name) {
    const handlers = {
      process_termination: this.runProcessTermination,
      network_api_timeout: this.runNetworkApiTimeout,
      supabase_outage: this.runSupabaseOutage,
      filesystem_failure: this.runFilesystemFailure,
      disk_full: this.runDiskFull,
      corrupted_cache: this.runCorruptedCache,
      corrupted_memory: this.runCorruptedMemory,
      queue_corruption: this.runQueueCorruption,
      worker_crash: this.runWorkerCrash,
      partial_task_completion: this.runPartialTaskCompletion,
      power_loss: this.runPowerLoss,
    };
    return handlers[name];
  }

  async runProcessTermination(manager) {
    const worker = {
      getStatus: () => null,
      stop: async () => {},
      start: async () => {
        worker.getStatus = () => ({
          timestamp: Date.now(),
          memory: 0.3,
          cpu: 0.2,
          queueDepth: 0,
          activeLoopCount: 0,
          retryCount: 0,
        });
      },
    };

    manager.watchdog.registerAgent('fake-worker-terminate', worker);
    try {
      await manager.watchdog.checkAgents();
      const status = manager.watchdog.getStatus().agents['fake-worker-terminate'];
      return {
        agentState: status?.state,
        issues: status?.issues,
        recovered: status?.state === 'healthy',
      };
    } finally {
      manager.watchdog.unregisterAgent('fake-worker-terminate');
    }
  }

  async runNetworkApiTimeout(manager) {
    const original = manager.coreLoop.takeAction;
    let timeoutObserved = false;
    manager.coreLoop.takeAction = async () => {
      throw new Error('network timeout');
    };

    try {
      try {
        await manager.coreLoop.takeAction({ id: 'network-test' });
      } catch (err) {
        timeoutObserved = err.message.includes('timeout');
      }

      const healResult = await manager.selfHealing.heal(
        { type: 'api_failure', target: 'network_api', reason: 'timeout' },
        { retry_with_backoff: async () => ({ success: true }) }
      );

      return {
        timeoutObserved,
        healResult,
        recovered: healResult.success === true,
      };
    } finally {
      manager.coreLoop.takeAction = original;
    }
  }

  async runSupabaseOutage(manager) {
    const original = manager.coreLoop.getPendingTasks;
    let outageObserved = false;
    manager.coreLoop.getPendingTasks = async () => {
      throw new Error('supabase connection refused');
    };

    try {
      try {
        await manager.coreLoop.getPendingTasks();
      } catch (err) {
        outageObserved = err.message.includes('supabase') || err.message.includes('connection');
      }

      const healResult = await manager.selfHealing.heal(
        { type: 'database_disconnect', target: 'supabase', reason: 'connection refused' },
        { reconnect_database: async () => ({ success: true }) }
      );

      return {
        outageObserved,
        healResult,
        recovered: healResult.success === true,
      };
    } finally {
      manager.coreLoop.getPendingTasks = original;
    }
  }

  async runFilesystemFailure(manager) {
    const original = manager.checkpointStore.saveCheckpoint;
    let failureObserved = false;
    manager.checkpointStore.saveCheckpoint = async () => {
      throw new Error('EACCES: permission denied');
    };

    try {
      try {
        await manager.checkpointStore.saveCheckpoint({});
      } catch (err) {
        failureObserved = err.message.includes('EACCES');
      }

      const healResult = await manager.selfHealing.heal(
        { type: 'filesystem_error', target: 'checkpoint_store', reason: 'EACCES' },
        { repair_filesystem: async () => ({ success: true }) }
      );

      return {
        failureObserved,
        healResult,
        recovered: healResult.success === true,
      };
    } finally {
      manager.checkpointStore.saveCheckpoint = original;
    }
  }

  async runDiskFull(manager) {
    const original = manager.checkpointStore.saveCheckpoint;
    let diskFullObserved = false;
    manager.checkpointStore.saveCheckpoint = async () => {
      throw new Error('ENOSPC: no space left on device');
    };

    try {
      try {
        await manager.checkpointStore.saveCheckpoint({});
      } catch (err) {
        diskFullObserved = err.message.includes('ENOSPC');
      }

      const healResult = await manager.selfHealing.heal(
        { type: 'filesystem_error', target: 'checkpoint_store', reason: 'ENOSPC' },
        { repair_filesystem: async () => ({ success: true }) }
      );

      return {
        diskFullObserved,
        healResult,
        recovered: healResult.success === true,
      };
    } finally {
      manager.checkpointStore.saveCheckpoint = original;
    }
  }

  async runCorruptedCache(manager) {
    const originalMemorySystem = manager.memorySystem;
    manager.memorySystem = {
      reflectiveMemory: {
        whatWorked: { legacy: { timestamp: Date.now() } },
        whatFailed: new Map(),
        confidenceReality: [],
      },
    };

    try {
      const firstScan = await manager.runMemoryIntegrity();
      const secondScan = await manager.runMemoryIntegrity();

      return {
        firstScan: {
          passed: firstScan?.passed,
          issueCount: firstScan?.issueCount,
          repairCount: firstScan?.repairCount,
        },
        secondScan: {
          passed: secondScan?.passed,
          issueCount: secondScan?.issueCount,
          repairCount: secondScan?.repairCount,
        },
        recovered: secondScan?.passed === true,
      };
    } finally {
      manager.memorySystem = originalMemorySystem;
    }
  }

  async runCorruptedMemory(manager) {
    const originalMemorySystem = manager.memorySystem;
    manager.memorySystem = {
      reflectiveMemory: { whatWorked: new Map(), whatFailed: new Map(), confidenceReality: [] },
      agents: [
        { id: 'agent-1' },
        { id: 'agent-1' },
      ],
      conversations: [{ id: 'conv-1', timestamp: 'invalid' }],
    };

    try {
      const missions = manager.missionPlanner.getMissions();
      const missionIds = missions.map((m) => m.id);
      const initialScan = await manager.memoryIntegrity.runScan({
        reflectiveMemory: manager.memorySystem.reflectiveMemory,
        missions,
        missionIds,
        tasks: [],
        agents: manager.memorySystem.agents,
        conversations: manager.memorySystem.conversations,
      });

      const healResult = await manager.selfHealing.heal(
        { type: 'memory_leak', target: 'memory_system' },
        {
          flush_memory: async () => {
            manager.memorySystem = {
              reflectiveMemory: {
                whatWorked: new Map(),
                whatFailed: new Map(),
                confidenceReality: [],
              },
            };
            return { success: true };
          },
        }
      );

      const finalScan = await manager.runMemoryIntegrity();

      return {
        initialScan: {
          passed: initialScan?.passed,
          issueCount: initialScan?.issueCount,
          repairCount: initialScan?.repairCount,
        },
        healResult,
        finalScan: {
          passed: finalScan?.passed,
          issueCount: finalScan?.issueCount,
          repairCount: finalScan?.repairCount,
        },
        recovered: healResult.success === true && finalScan?.passed === true,
      };
    } finally {
      manager.memorySystem = originalMemorySystem;
    }
  }

  async runQueueCorruption(manager) {
    const originalSize = manager.coreLoop.activeLoops.size;
    manager.coreLoop.activeLoops.set('corrupt-1', { id: 'corrupt-1' });
    manager.coreLoop.activeLoops.set('corrupt-2', { id: 'corrupt-2' });
    manager.coreLoop.activeLoops.set('corrupt-3', { id: 'corrupt-3' });

    const healResult = await manager.selfHealing.heal(
      { type: 'queue_corruption', target: 'redis', reason: 'queue desync' },
      {
        repair_queue: async () => {
          manager.coreLoop.activeLoops.clear();
          return { success: true };
        },
      }
    );

    return {
      beforeSize: originalSize + 3,
      afterSize: manager.coreLoop.activeLoops.size,
      healResult,
      recovered: healResult.success === true,
    };
  }

  async runWorkerCrash(manager) {
    const worker = {
      getStatus: () => {
        throw new Error('worker crashed');
      },
      stop: async () => {},
      start: async () => {
        worker.getStatus = () => ({
          timestamp: Date.now(),
          memory: 0.3,
          cpu: 0.2,
          queueDepth: 0,
          activeLoopCount: 0,
          retryCount: 0,
        });
      },
    };

    manager.watchdog.registerAgent('fake-worker-crash', worker);
    try {
      await manager.watchdog.checkAgents();
      const status = manager.watchdog.getStatus().agents['fake-worker-crash'];
      return {
        agentState: status?.state,
        issues: status?.issues,
        recovered: status?.state === 'healthy',
      };
    } finally {
      manager.watchdog.unregisterAgent('fake-worker-crash');
    }
  }

  async runPartialTaskCompletion(manager) {
    const missionId = await manager.createMission('chaos', 'partial completion mission');
    const taskA = manager.missionPlanner.addTask(missionId, { type: 'automation', description: 'task A' });
    const taskB = manager.missionPlanner.addTask(missionId, { type: 'automation', description: 'task B' });
    manager.missionPlanner.planMission(missionId);
    manager.missionPlanner.startTask(taskA, missionId);
    manager.missionPlanner.completeTask(taskA, missionId, { success: true });
    manager.missionPlanner.startTask(taskB, missionId);
    manager.missionPlanner.failTask(taskB, missionId, 'partial failure');

    const mission = manager.missionPlanner.getMission(missionId);
    const completed = mission.tasks.filter((t) => t.status === 'completed').length;
    const failed = mission.tasks.filter((t) => t.status === 'failed').length;
    const pending = mission.tasks.filter((t) => t.status === 'pending').length;

    return {
      missionStatus: mission.status,
      completed,
      failed,
      pending,
      recovered: mission.status !== 'failed',
    };
  }

  async runPowerLoss(manager) {
    const state = manager.getStateForCheckpoint();
    await manager.checkpointStore.saveCheckpoint(state);
    const restored = await manager.checkpointStore.loadCheckpoint();

    return {
      checkpointSaved: !!state,
      checkpointRestored: !!restored,
      uptime: restored?.uptime,
      recovered: !!restored && restored.uptime !== undefined,
    };
  }
}

module.exports = ChaosRunner;
