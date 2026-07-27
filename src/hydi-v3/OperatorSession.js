'use strict';

const path = require('path');
const BusinessMemory = require('./BusinessMemory');
const ExecutiveOperatingSystem = require('./ExecutiveOperatingSystem');
const TaskEngine = require('./TaskEngine');
const StrategicObjectives = require('./StrategicObjectives');
const BriefingRenderer = require('./BriefingRenderer');
const { BusinessWorkflowEngine } = require('./BusinessWorkflowEngine');
const { ExecutionGateway } = require('./ExecutionGateway');
const ExecutiveCockpit = require('./ExecutiveCockpit');
const ExecutiveTimeline = require('./ExecutiveTimeline');
const AgentWorkspace = require('./AgentWorkspace');
const ApprovalCenter = require('./ApprovalCenter');
const SessionMemory = require('./SessionMemory');
const ConversationEngine = require('./ConversationEngine');
const ConsoleAPI = require('./ConsoleAPI');
const BusinessEventBus = require('./BusinessEventBus');
const BusinessSignalInterpreter = require('./BusinessSignalInterpreter');
const ManufacturingSignalInterpreter = require('./ManufacturingSignalInterpreter');
const EquipmentRegistry = require('./EquipmentRegistry');
const PrinterSensor = require('./PrinterSensor');
const SignalCoverage = require('./SignalCoverage');
const GitSensor = require('./GitSensor');
const DecisionOutcomeStore = require('./DecisionOutcomeStore');
const RecommendationTracker = require('./RecommendationTracker');
const ConfidenceCalibration = require('./ConfidenceCalibration');
const BusinessOutcomeEngine = require('./BusinessOutcomeEngine');
const LearningMetrics = require('./LearningMetrics');
const BusinessEvidenceEngine = require('./BusinessEvidenceEngine');

const SILENT_LOGGER = { log: () => {}, error: () => {}, warn: () => {} };

/**
 * OperatorSession wires the full executive stack into one lifecycle object.
 *
 * Both operator surfaces — the readline CLI (`npm run cockpit`) and the local
 * dashboard route (`/api/cockpit`) — construct one of these. Neither surface
 * builds components itself, so they always share the same StrategicObjectives
 * instance, the same scoring, and the same persistence directory.
 *
 * This is an interface layer only. Every action still routes through
 * ExecutionGateway and its approval rules; the session grants no new authority.
 *
 * Phase 15 (Local Operations Console) adds five components on top of the
 * Phase 14 stack above, none of which change existing behavior:
 * ExecutiveTimeline (activity feed), AgentWorkspace (per-agent views),
 * ApprovalCenter (enriched approvals), SessionMemory (persisted
 * focus/priority/history), and ConversationEngine (contextual follow-ups,
 * layered on top of — never replacing — ExecutiveCockpit). ConsoleAPI is the
 * single facade both the CLI and the local web console call, so there is one
 * implementation of every console operation.
 */
class OperatorSession {
  constructor(config = {}) {
    this.config = {
      dataPath: config.dataPath || path.resolve(__dirname, '../../data'),
      ownerPriority: config.ownerPriority || 'default',
      logger: config.logger || SILENT_LOGGER,
      taskIntervalMs: config.taskIntervalMs ?? 1000,
    };

    this.strategicObjectives = config.strategicObjectives
      || new StrategicObjectives({ ownerPriority: this.config.ownerPriority });

    /** Optional OperatorMode enforcing --dry-run / --offline. */
    this.mode = config.mode || null;

    /**
     * Sensing layer (Phase 18A/18B/18C). The bus is always constructed so the
     * Executive OS has something to subscribe to; individual sensors are
     * opt-in, because a sensor is an observation of the outside world and
     * should never start watching without being asked.
     */
    this.eventBus = config.eventBus || new BusinessEventBus({ logger: this.config.logger });
    this.signalInterpreter = null;
    this.manufacturingSignalInterpreter = null;
    this.gitSensor = null;
    this.printerSensor = null;
    this.sensors = [];
    this._gitConfig = config.git || null;
    this._printerConfig = config.printer || null;
    this._simulateManufacturing = config.simulateManufacturing === true;

    this.memory = null;
    this.executiveOS = null;
    this.taskEngine = null;
    this.workflowEngine = null;
    this.executionGateway = null;
    this.cockpit = null;

    this.decisionOutcomeStore = null;
    this.recommendationTracker = null;
    this.confidenceCalibration = null;
    this.businessOutcomeEngine = null;
    this.evidenceEngine = null;
    this.learningMetrics = null;

    this.timeline = null;
    this.agentWorkspace = null;
    this.approvalCenter = null;
    this.sessionMemory = null;
    this.conversationEngine = null;
    this.consoleAPI = null;

    this._started = false;
    this._destroyed = false;
  }

  async start() {
    if (this._destroyed) throw new Error('OperatorSession has been destroyed');
    if (this._started) return this;

    const { dataPath, logger } = this.config;
    const shared = { dataPath, logger, strategicObjectives: this.strategicObjectives };

    // --- Phase 19: continuous learning layer -----------------------------
    this.decisionOutcomeStore = new DecisionOutcomeStore({ dataPath, logger });
    await this.decisionOutcomeStore.start();
    this.recommendationTracker = new RecommendationTracker({
      decisionOutcomeStore: this.decisionOutcomeStore,
      dataPath,
      logger,
    });
    await this.recommendationTracker.start();
    this.confidenceCalibration = new ConfidenceCalibration({ policy: 'balanced' });
    this.businessOutcomeEngine = new BusinessOutcomeEngine({
      decisionOutcomeStore: this.decisionOutcomeStore,
      confidenceCalibration: this.confidenceCalibration,
      recommendationTracker: this.recommendationTracker,
      dataPath,
      logger,
    });
    await this.businessOutcomeEngine.start();

    this.evidenceEngine = new BusinessEvidenceEngine({
      eventBus: this.eventBus,
      recommendationTracker: this.recommendationTracker,
      businessOutcomeEngine: this.businessOutcomeEngine,
      logger,
    });
    await this.evidenceEngine.start();

    this.learningMetrics = new LearningMetrics({
      decisionOutcomeStore: this.decisionOutcomeStore,
      dataPath,
      logger,
    });
    await this.learningMetrics.start();
    // -----------------------------------------------------------------------

    this.memory = new BusinessMemory({ ...shared });
    await this.memory.start();

    this.executiveOS = new ExecutiveOperatingSystem({
      ...shared,
      businessMemory: this.memory,
      ownerPriority: this.config.ownerPriority,
      eventBus: this.eventBus,
      recommendationTracker: this.recommendationTracker,
      learningMetrics: this.learningMetrics,
      businessEvidenceEngine: this.evidenceEngine,
    });
    await this.executiveOS.start();

    this.taskEngine = new TaskEngine({ dataPath, logger, intervalMs: this.config.taskIntervalMs });
    await this.taskEngine.start();

    this.workflowEngine = new BusinessWorkflowEngine({
      ...shared,
      businessMemory: this.memory,
      executiveOS: this.executiveOS,
      taskEngine: this.taskEngine,
      outcomeEngine: this.businessOutcomeEngine,
    });
    await this.workflowEngine.start();

    this.executionGateway = new ExecutionGateway({
      ...shared,
      businessMemory: this.memory,
      outcomeEngine: this.businessOutcomeEngine,
    });
    await this.executionGateway.start();

    this.cockpit = new ExecutiveCockpit({
      ...shared,
      businessMemory: this.memory,
      executiveOS: this.executiveOS,
      workflowEngine: this.workflowEngine,
      executionGateway: this.executionGateway,
      learningMetrics: this.learningMetrics,
      recommendationTracker: this.recommendationTracker,
      businessEvidenceEngine: this.evidenceEngine,
    });
    await this.cockpit.start();

    if (this.config.ownerPriority && this.config.ownerPriority !== 'default') {
      this.cockpit.setOwnerPriority(this.config.ownerPriority);
    }

    // --- Phase 15: Local Operations Console -------------------------------
    this.agentWorkspace = new AgentWorkspace({
      executiveOS: this.executiveOS,
      executionGateway: this.executionGateway,
      workflowEngine: this.workflowEngine,
    });

    this.approvalCenter = new ApprovalCenter({
      executionGateway: this.executionGateway,
      workflowEngine: this.workflowEngine,
      strategicObjectives: this.strategicObjectives,
    });

    this.timeline = new ExecutiveTimeline({
      ...shared,
      executionGateway: this.executionGateway,
      workflowEngine: this.workflowEngine,
      executiveOS: this.executiveOS,
      cockpit: this.cockpit,
    });
    await this.timeline.start();

    this.sessionMemory = new SessionMemory({ ...shared });
    await this.sessionMemory.start();
    if (this.config.ownerPriority && this.config.ownerPriority !== 'default') {
      this.sessionMemory.setOwnerPriority(this.config.ownerPriority);
    }

    this.conversationEngine = new ConversationEngine({
      cockpit: this.cockpit,
      executiveOS: this.executiveOS,
      memory: this.memory,
      workflowEngine: this.workflowEngine,
      executionGateway: this.executionGateway,
      strategicObjectives: this.strategicObjectives,
      agentWorkspace: this.agentWorkspace,
      approvalCenter: this.approvalCenter,
      timeline: this.timeline,
      sessionMemory: this.sessionMemory,
      logger,
    });

    this.consoleAPI = new ConsoleAPI({
      conversationEngine: this.conversationEngine,
      approvalCenter: this.approvalCenter,
      timeline: this.timeline,
      agentWorkspace: this.agentWorkspace,
      sessionMemory: this.sessionMemory,
      executiveOS: this.executiveOS,
      dataPath,
      logger,
    });
    // -----------------------------------------------------------------------

    // --- Phase 18C: sensing layer ------------------------------------------
    // The interpreter turns raw sensor events into BusinessSignals, which is
    // the only event type the Executive OS subscribes to. Sensors are attached
    // after it, so nothing is published before there is a consumer.
    this.signalInterpreter = new BusinessSignalInterpreter({ eventBus: this.eventBus });
    this.manufacturingSignalInterpreter = new ManufacturingSignalInterpreter({ eventBus: this.eventBus });
    this.interpreters = [this.signalInterpreter, this.manufacturingSignalInterpreter];

    // With more than one interpreter on the bus, an event type handled by none
    // vanishes silently and one handled by two is counted twice. Neither shows
    // up as an error, so the coverage is checked at startup rather than trusted.
    this.signalCoverage = SignalCoverage.audit({ interpreters: this.interpreters });
    if (!this.signalCoverage.ok) {
      logger.error('[OperatorSession] signal coverage problem', {
        dropped: this.signalCoverage.dropped,
        double: this.signalCoverage.double,
      });
    }

    if (this._gitConfig) {
      this.gitSensor = new GitSensor({
        dataPath,
        logger,
        eventBus: this.eventBus,
        ...this._gitConfig,
      });
      await this.gitSensor.start();
      this.sensors.push(this.gitSensor);
    }

    if (this._simulateManufacturing || this._printerConfig) {
      const registry = this._printerConfig && this._printerConfig.registry
        ? this._printerConfig.registry
        : new EquipmentRegistry();
      this.printerSensor = new PrinterSensor({
        registry,
        eventBus: this.eventBus,
        logger,
        simulate: this._simulateManufacturing,
        ...this._printerConfig,
      });
      await this.printerSensor.start();
      this.sensors.push(this.printerSensor);
    }
    // -----------------------------------------------------------------------

    // Phase 16: run-mode enforcement is installed last, so it wraps the fully
    // constructed mutation authorities. Installing it here rather than in the
    // CLI means every surface built on an OperatorSession inherits the same
    // guarantees — a dry run cannot be bypassed by using a different frontend.
    if (this.mode) this.mode.install(this);

    this._started = true;
    return this;
  }

  /**
   * Route a natural-language operator command through the Conversation
   * Engine (Phase 15), which adds context-aware follow-ups and the extended
   * command palette on top of ExecutiveCockpit, and falls back to
   * `cockpit.handleCommand` verbatim for anything it does not specially
   * handle. Existing callers keep receiving the same `{ text, ... }` shape.
   */
  async ask(text) {
    this._assertReady();
    return this.conversationEngine.ask(text);
  }

  /** Structured briefing object from the ExecutiveOperatingSystem. */
  briefing() {
    this._assertReady();
    return this.executiveOS.morningBriefing();
  }

  /** Full briefing rendered for a terminal. */
  briefingText(options = {}) {
    return options.colour === false
      ? BriefingRenderer.toText(this.briefing())
      : BriefingRenderer.toAnsi(this.briefing(), options);
  }

  /** Full briefing rendered as a standalone HTML page. */
  briefingHtml(options = {}) {
    return BriefingRenderer.toHtml(this.briefing(), options);
  }

  healthCheck() {
    if (!this._started) return { ok: false, checks: { started: false } };
    const parts = {
      memory: !!this.memory,
      executiveOS: this.executiveOS.healthCheck().ok,
      cockpit: this.cockpit.healthCheck().ok,
      workflowEngine: !!this.workflowEngine,
      executionGateway: !!this.executionGateway,
      decisionOutcomeStore: this.decisionOutcomeStore ? this.decisionOutcomeStore.healthCheck().ok : false,
      recommendationTracker: this.recommendationTracker ? this.recommendationTracker.healthCheck().ok : false,
      businessOutcomeEngine: !!this.businessOutcomeEngine,
      learningMetrics: !!this.learningMetrics,
      timeline: this.timeline ? this.timeline.healthCheck().ok : false,
      agentWorkspace: this.agentWorkspace ? this.agentWorkspace.healthCheck().ok : false,
      approvalCenter: this.approvalCenter ? this.approvalCenter.healthCheck().ok : false,
      sessionMemory: this.sessionMemory ? this.sessionMemory.healthCheck().ok : false,
      conversationEngine: this.conversationEngine ? this.conversationEngine.healthCheck().ok : false,
      consoleAPI: this.consoleAPI ? this.consoleAPI.healthCheck().ok : false,
      eventBus: !!this.eventBus,
      signalCoverage: !this.signalCoverage || this.signalCoverage.ok,
    };
    // Sensors are reported but never gate overall health: a repository that is
    // absent or unreadable is a missing observation, not a broken system.
    const sensors = this.sensors.map((sensor) => sensor.healthCheck());
    return { ok: Object.values(parts).every(Boolean), checks: parts, sensors };
  }

  /**
   * Components in teardown order: dependants before their dependencies, so a
   * store is never destroyed while something upstream may still write to it.
   */
  _components() {
    return [
      // Sensors first: stop observing before anything downstream is torn down,
      // so a poll in flight cannot publish into a half-destroyed stack.
      ...this.sensors,
      this.timeline, this.sessionMemory,
      this.cockpit, this.executionGateway, this.workflowEngine,
      this.taskEngine, this.executiveOS, this.memory,
      this.evidenceEngine, this.learningMetrics, this.businessOutcomeEngine,
      this.recommendationTracker, this.decisionOutcomeStore,
    ];
  }

  /**
   * Persist every store without tearing anything down. Called before destroy
   * during a graceful shutdown so a failure in one component's destroy()
   * cannot cost the operator data another component had already buffered.
   */
  async flushAll() {
    const failures = [];
    for (const component of this._components()) {
      if (component && typeof component.flush === 'function') {
        try {
          await component.flush();
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          failures.push({ component: component.constructor.name, error: message });
          this.config.logger.error('[OperatorSession] flush error', { error: message });
        }
      }
    }
    return { ok: failures.length === 0, failures };
  }

  /**
   * Graceful shutdown: flush everything first, then destroy. Never throws —
   * returns a result the caller can turn into an exit code.
   */
  async shutdown() {
    if (this._destroyed) return { ok: true, alreadyShutDown: true, failures: [] };
    const flushed = await this.flushAll();
    await this.destroy();
    return { ok: flushed.ok, failures: flushed.failures };
  }

  async destroy() {
    if (this._destroyed) return;
    this._destroyed = true;
    this._started = false;
    const components = this._components();
    for (const component of components) {
      if (component && typeof component.destroy === 'function') {
        try {
          await component.destroy();
        } catch (error) {
          this.config.logger.error('[OperatorSession] shutdown error', {
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }

    // The interpreters hold '*' subscriptions; detach before tearing the bus
    // down so a late event cannot reach a destroyed consumer.
    for (const interpreter of (this.interpreters || [])) {
      if (interpreter && typeof interpreter.detach === 'function') interpreter.detach();
    }
    if (this.manufacturingSignalInterpreter) this.manufacturingSignalInterpreter.detach();
    if (this.eventBus) this.eventBus.destroy();
  }

  _assertReady() {
    if (this._destroyed) throw new Error('OperatorSession has been destroyed');
    if (!this._started) throw new Error('OperatorSession not started; call start() first');
  }
}

module.exports = OperatorSession;
