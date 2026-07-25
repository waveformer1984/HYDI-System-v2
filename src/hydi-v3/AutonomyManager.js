'use strict';

const path = require('path');
const { EventEmitter } = require('events');
const WatchdogSupervisor = require('./WatchdogSupervisor');
const HeartbeatSystem = require('./HeartbeatSystem');
const GracefulShutdown = require('./GracefulShutdown');
const DecisionIntelligence = require('./DecisionIntelligence');
const MissionPlanner = require('./MissionPlanner');
const ReflectionEngine = require('./ReflectionEngine');
const SelfHealingEngine = require('./SelfHealingEngine');
const DistributedCompute = require('./DistributedCompute');
const MemoryIntegrity = require('./MemoryIntegrity');
const ObservabilityDashboard = require('./ObservabilityDashboard');
const SecurityAuditor = require('./SecurityAuditor');
const TestingFramework = require('./TestingFramework');
const PerformanceBenchmark = require('./PerformanceBenchmark');
const CheckpointStore = require('./CheckpointStore');
const CudaPoolManager = require('./CudaPoolManager');

/**
 * HYDIAutonomyManager orchestrates the HYDI V3 reliability and autonomy layer.
 *
 * It integrates the core loop with watchdogs, heartbeat, graceful shutdown,
 * decision intelligence, mission planning, reflection, self-healing, distributed
 * compute, memory integrity, observability, security, testing, and performance.
 *
 * Usage:
 *   const manager = new HYDIAutonomyManager({ coreLoop, orchestrator, memorySystem, ... });
 *   await manager.start();
 *   await manager.stop();
 */
class HYDIAutonomyManager extends EventEmitter {
  constructor(components = {}) {
    super();

    this.config = {
      dataPath: components.config?.dataPath || path.resolve(__dirname, '../../data'),
      enableWatchdog: components.config?.enableWatchdog !== false,
      enableHeartbeat: components.config?.enableHeartbeat !== false,
      enableGracefulShutdown: components.config?.enableGracefulShutdown !== false,
      enableMissionPlanning: components.config?.enableMissionPlanning !== false,
      enableDecisionIntelligence: components.config?.enableDecisionIntelligence !== false,
      enableReflection: components.config?.enableReflection !== false,
      enableSelfHealing: components.config?.enableSelfHealing !== false,
      enableDistributedCompute: components.config?.enableDistributedCompute !== false,
      enableMemoryIntegrity: components.config?.enableMemoryIntegrity !== false,
      enableObservability: components.config?.enableObservability !== false,
      enableSecurity: components.config?.enableSecurity !== false,
      enableCudaPool: components.config?.enableCudaPool === true,
      ...components.config,
    };

    this.coreLoop = components.coreLoop || null;
    this.orchestrator = components.orchestrator || null;
    this.memorySystem = components.memorySystem || null;
    this.actionLayer = components.actionLayer || null;
    this.modelStack = components.modelStack || null;

    this.startTime = null;
    this._started = false;
    this._stopped = false;
    this._originalGetPendingTasks = null;
    this._originalTakeAction = null;
    this._heartbeatInterval = null;
    this._dashboardInterval = null;

    this.checkpointStore = new CheckpointStore({ storagePath: path.join(this.config.dataPath, 'checkpoints') });
    this.watchdog = new WatchdogSupervisor();
    this.heartbeat = new HeartbeatSystem();
    this.gracefulShutdown = new GracefulShutdown();
    this.decisionIntelligence = new DecisionIntelligence({ storagePath: path.join(this.config.dataPath, 'decisions') });
    this.missionPlanner = new MissionPlanner({ storagePath: path.join(this.config.dataPath, 'missions') });
    this.reflectionEngine = new ReflectionEngine({ storagePath: path.join(this.config.dataPath, 'reflections') });
    this.selfHealing = new SelfHealingEngine();
    this.distributedCompute = new DistributedCompute();
    this.memoryIntegrity = new MemoryIntegrity();
    this.observability = new ObservabilityDashboard();
    this.securityAuditor = new SecurityAuditor();
    this.testingFramework = new TestingFramework();
    this.performanceBenchmark = new PerformanceBenchmark();
    this.cudaPoolManager = this.config.enableCudaPool
      ? new CudaPoolManager({ dataPath: path.join(this.config.dataPath, 'cuda-pool') })
      : null;

    this.setupInternalListeners();
  }

  setupInternalListeners() {
    this.watchdog.on('agent_dead', (event) => this.handleAgentDead(event));
    this.heartbeat.on('heartbeat_missing', (missing) => this.handleMissingHeartbeat(missing));
    this.missionPlanner.on('mission_completed', (event) => this.handleMissionCompleted(event));
    this.missionPlanner.on('task_failed', (event) => this.handleTaskFailed(event));
    this.selfHealing.on('escalated', (event) => this.emit('escalated', event));
    this.gracefulShutdown.on('shutdown_started', (event) => this.emit('shutdown_started', event));
  }

  async start() {
    if (this._started) return;
    this._started = true;
    this._stopped = false;
    this.startTime = Date.now();

    await this.checkpointStore.initialize();
    await this.restoreCheckpoint();
    await this.missionPlanner.initialize();
    await this.decisionIntelligence.initialize();
    await this.reflectionEngine.initialize();

    if (this.config.enableGracefulShutdown) {
      this.gracefulShutdown.addHandler(async () => this.stop(), 100);
      this.gracefulShutdown.install();
    }

    if (this.config.enableSecurity) {
      this.securityAuditReport = await this.securityAuditor.runAudit();
      this.emit('security_audit_completed', this.securityAuditReport);
    }

    if (this.config.enableDistributedCompute) {
      this.distributedCompute.start();
      this.distributedCompute.registerNode(this.distributedCompute.getLocalNode());
    }

    if (this.config.enableCudaPool && this.cudaPoolManager) {
      await this.cudaPoolManager.initialize();
    }

    if (this.config.enableSelfHealing) {
      this.selfHealing.start();
    }

    if (this.config.enableMemoryIntegrity) {
      this.memoryIntegrity.start();
    }

    if (this.config.enableWatchdog && this.coreLoop) {
      this.registerCoreAgents();
      this.watchdog.start();
    }

    if (this.config.enableHeartbeat && this.coreLoop) {
      this.registerHeartbeatPublishers();
      this.heartbeat.start();
      this._heartbeatInterval = setInterval(() => this.heartbeat.publishAll(), 30000);
      if (this._heartbeatInterval.unref) this._heartbeatInterval.unref();
    }

    if (this.config.enableMissionPlanning && this.coreLoop) {
      this.patchCoreLoopPendingTasks();
    }

    if (this.config.enableDecisionIntelligence && this.coreLoop) {
      this.patchCoreLoopTakeAction();
      this.listenForDecisions();
    }

    if (this.config.enableObservability) {
      this._dashboardInterval = setInterval(
        () => this.recordObservabilitySnapshot(),
        30000
      );
      if (this._dashboardInterval.unref) this._dashboardInterval.unref();
    }

    const recoveryDuration = Date.now() - this.startTime;
    this.observability.recordRecovery(recoveryDuration);
    this.emit('started', { startTime: this.startTime, recoveryDuration });
  }

  async stop() {
    if (this._stopped) return;
    this._stopped = true;

    this.emit('stopping');
    const shutdownStart = Date.now();

    if (this._heartbeatInterval) clearInterval(this._heartbeatInterval);
    if (this._dashboardInterval) clearInterval(this._dashboardInterval);

    await this.checkpointStore.saveCheckpoint(this.getStateForCheckpoint());

    this.watchdog.stop();
    this.heartbeat.stop();
    this.selfHealing.stop();
    this.memoryIntegrity.stop();
    this.distributedCompute.stop();

    if (this.cudaPoolManager) {
      await this.cudaPoolManager.shutdown();
    }

    if (this._originalGetPendingTasks && this.coreLoop) {
      this.coreLoop.getPendingTasks = this._originalGetPendingTasks;
      this._originalGetPendingTasks = null;
    }
    if (this._originalTakeAction && this.coreLoop) {
      this.coreLoop.takeAction = this._originalTakeAction;
      this._originalTakeAction = null;
    }

    this.gracefulShutdown.uninstall();

    await this.persistAll();

    const shutdownDuration = Date.now() - shutdownStart;
    this.observability.recordShutdown(shutdownDuration);

    this.emit('stopped', { uptime: this.getUptime(), shutdownDuration });
  }

  async persistAll() {
    const pendingWrites =
      (this.missionPlanner._persistTimer ? 1 : 0) +
      (this.decisionIntelligence._persistTimer ? 1 : 0) +
      (this.reflectionEngine._persistTimer ? 1 : 0);
    const flushStart = Date.now();
    try {
      await this.missionPlanner.flush();
      await this.decisionIntelligence.flush();
      await this.reflectionEngine.flush();
      this.observability.recordFlush(Date.now() - flushStart, pendingWrites, false);
    } catch (err) {
      this.emit('persist_error', err);
      this.observability.recordFlush(Date.now() - flushStart, pendingWrites, true);
    }
  }

  async restoreCheckpoint() {
    try {
      const checkpoint = await this.checkpointStore.loadCheckpoint();
      if (checkpoint) {
        this.emit('checkpoint_restored', checkpoint);
      }
    } catch (err) {
      this.emit('checkpoint_restore_error', err);
    }
  }

  getStateForCheckpoint() {
    return {
      startTime: this.startTime,
      uptime: this.getUptime(),
      missionCount: this.missionPlanner.getStatus().total,
      decisionCount: this.decisionIntelligence.getStatus().totalDecisions,
      reflectionCount: this.reflectionEngine.getStatus().totalReflections,
    };
  }

  registerCoreAgents() {
    const agents = [
      { id: 'coreLoop', agent: this.coreLoop },
      { id: 'orchestrator', agent: this.orchestrator },
      { id: 'memorySystem', agent: this.memorySystem },
      { id: 'actionLayer', agent: this.actionLayer },
      { id: 'modelStack', agent: this.modelStack },
    ];
    for (const { id, agent } of agents) {
      if (agent) this.watchdog.registerAgent(id, agent);
    }
  }

  registerHeartbeatPublishers() {
    const services = [
      { id: 'coreLoop', provider: this.coreLoop },
      { id: 'orchestrator', provider: this.orchestrator },
      { id: 'memorySystem', provider: this.memorySystem },
      { id: 'actionLayer', provider: this.actionLayer },
      { id: 'modelStack', provider: this.modelStack },
    ];
    for (const { id, provider } of services) {
      if (provider) this.heartbeat.registerPublisher(id, provider);
    }
  }

  patchCoreLoopPendingTasks() {
    if (!this.coreLoop || typeof this.coreLoop.getPendingTasks !== 'function') return;
    this._originalGetPendingTasks = this.coreLoop.getPendingTasks.bind(this.coreLoop);
    this.coreLoop.getPendingTasks = async () => {
      const capacity = this.coreLoop?.config?.maxConcurrentLoops || this.missionPlanner.maxConcurrent;
      const next = this.missionPlanner.getNextTasks(capacity);
      if (next.length) return next;
      return this._originalGetPendingTasks();
    };
  }

  patchCoreLoopTakeAction() {
    if (!this.coreLoop || typeof this.coreLoop.takeAction !== 'function') return;
    this._originalTakeAction = this.coreLoop.takeAction.bind(this.coreLoop);
    this.coreLoop.takeAction = async (task, decision, loopId) => {
      if (decision && decision.action !== 'reject') {
        const validation = await this.decisionIntelligence.validateDecision(
          decision,
          { task, resources: this.coreLoop.getAvailableResources ? await this.coreLoop.getAvailableResources(task) : {} }
        );
        if (!validation.valid) {
          return {
            status: 'rejected',
            reason: `validation_failed:${validation.reason}`,
            success: false,
          };
        }
      }
      return this._originalTakeAction(task, decision, loopId);
    };
  }

  listenForDecisions() {
    if (!this.coreLoop) return;
    this.coreLoop.on('loop_completed', (event) => {
      if (event.result && event.result.decision) {
        this.decisionIntelligence.recordDecision(
          event.task,
          event.result.decision,
          event.result.measurement
        );
      }
    });
  }

  handleAgentDead(event) {
    this.selfHealing.heal({ type: 'repeated_crash', target: event.agentId, reason: event.reason });
  }

  handleMissingHeartbeat(missing) {
    for (const m of missing) {
      this.selfHealing.heal({ type: 'api_failure', target: m.serviceId, reason: 'heartbeat_missing' });
    }
  }

  async handleMissionCompleted(event) {
    const mission = this.missionPlanner.getMission(event.missionId);
    if (mission && this.config.enableReflection) {
      const reflection = await this.reflectionEngine.reflectOnMission(mission);
      this.emit('mission_reflected', { missionId: mission.id, reflection });
    }
  }

  handleTaskFailed(event) {
    this.selfHealing.heal({ type: 'api_failure', target: event.taskId, reason: event.error });
  }

  recordObservabilitySnapshot() {
    this.observability.recordSnapshot({
      coreLoop: this.coreLoop,
      watchdog: this.watchdog,
      missionPlanner: this.missionPlanner,
      decisionIntelligence: this.decisionIntelligence,
      heartbeat: this.heartbeat,
      memorySystem: this.memorySystem,
      reflectionEngine: this.reflectionEngine,
    });
  }

  async createMission(name, objective, options = {}) {
    await this.missionPlanner.initialize();
    return this.missionPlanner.createMission(name, objective, options);
  }

  async executeMission(missionId) {
    return this.missionPlanner.planMission(missionId);
  }

  async runSecurityAudit() {
    this.securityAuditReport = await this.securityAuditor.runAudit();
    return this.securityAuditReport;
  }

  async runMemoryIntegrity() {
    return this.memoryIntegrity.runScan({
      reflectiveMemory: this.memorySystem?.reflectiveMemory,
      missions: this.missionPlanner.getMissions(),
      missionIds: this.missionPlanner.getMissions().map((m) => m.id),
      tasks: this.missionPlanner.getMissions().flatMap((m) => m.tasks || []),
    });
  }

  async runPerformanceBenchmarks() {
    return this.performanceBenchmark.runAll({
      missionPlanner: this.missionPlanner,
      decisionIntelligence: this.decisionIntelligence,
      reflectionEngine: this.reflectionEngine,
      heartbeat: this.heartbeat,
    });
  }

  async runTestSuite() {
    return this.testingFramework.runAll({
      missionPlanner: this.missionPlanner,
      decisionIntelligence: this.decisionIntelligence,
      reflectionEngine: this.reflectionEngine,
      heartbeat: this.heartbeat,
      watchdog: this.watchdog,
      selfHealing: this.selfHealing,
      distributedCompute: this.distributedCompute,
      checkpointStore: this.checkpointStore,
    });
  }

  getUptime() {
    return this.startTime ? Date.now() - this.startTime : 0;
  }

  getStatus() {
    return {
      started: this._started,
      stopped: this._stopped,
      uptime: this.getUptime(),
      watchdog: this.watchdog.getStatus(),
      heartbeat: this.heartbeat.getStatus(),
      missions: this.missionPlanner.getStatus(),
      decisions: this.decisionIntelligence.getStatus(),
      reflections: this.reflectionEngine.getStatus(),
      selfHealing: this.selfHealing.getStatus(),
      distributed: this.distributedCompute.getStatus(),
      observability: this.observability.getStatus(),
      security: this.securityAuditReport || null,
    };
  }

  getDashboard() {
    return this.observability.getDashboard({
      coreLoop: this.coreLoop,
      watchdog: this.watchdog,
      missionPlanner: this.missionPlanner,
      decisionIntelligence: this.decisionIntelligence,
      heartbeat: this.heartbeat,
      memorySystem: this.memorySystem,
      reflectionEngine: this.reflectionEngine,
    });
  }

  async destroy() {
    if (!this._stopped) {
      await this.stop();
    }
    await Promise.allSettled([
      this.watchdog.destroy?.(),
      this.heartbeat.destroy?.(),
      this.gracefulShutdown.destroy?.(),
      this.decisionIntelligence.destroy?.(),
      this.missionPlanner.destroy?.(),
      this.reflectionEngine.destroy?.(),
      this.selfHealing.destroy?.(),
      this.distributedCompute.destroy?.(),
      this.memoryIntegrity.destroy?.(),
    ]);
    this.removeAllListeners();
  }
}

module.exports = HYDIAutonomyManager;
