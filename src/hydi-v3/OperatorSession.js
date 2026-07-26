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

    this.memory = null;
    this.executiveOS = null;
    this.taskEngine = null;
    this.workflowEngine = null;
    this.executionGateway = null;
    this.cockpit = null;

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

    this.memory = new BusinessMemory({ ...shared });
    await this.memory.start();

    this.executiveOS = new ExecutiveOperatingSystem({
      ...shared,
      businessMemory: this.memory,
      ownerPriority: this.config.ownerPriority,
    });
    await this.executiveOS.start();

    this.taskEngine = new TaskEngine({ dataPath, logger, intervalMs: this.config.taskIntervalMs });
    await this.taskEngine.start();

    this.workflowEngine = new BusinessWorkflowEngine({
      ...shared,
      businessMemory: this.memory,
      executiveOS: this.executiveOS,
      taskEngine: this.taskEngine,
    });
    await this.workflowEngine.start();

    this.executionGateway = new ExecutionGateway({ ...shared, businessMemory: this.memory });
    await this.executionGateway.start();

    this.cockpit = new ExecutiveCockpit({
      ...shared,
      businessMemory: this.memory,
      executiveOS: this.executiveOS,
      workflowEngine: this.workflowEngine,
      executionGateway: this.executionGateway,
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
      timeline: this.timeline ? this.timeline.healthCheck().ok : false,
      agentWorkspace: this.agentWorkspace ? this.agentWorkspace.healthCheck().ok : false,
      approvalCenter: this.approvalCenter ? this.approvalCenter.healthCheck().ok : false,
      sessionMemory: this.sessionMemory ? this.sessionMemory.healthCheck().ok : false,
      conversationEngine: this.conversationEngine ? this.conversationEngine.healthCheck().ok : false,
      consoleAPI: this.consoleAPI ? this.consoleAPI.healthCheck().ok : false,
    };
    return { ok: Object.values(parts).every(Boolean), checks: parts };
  }

  /**
   * Components in teardown order: dependants before their dependencies, so a
   * store is never destroyed while something upstream may still write to it.
   */
  _components() {
    return [
      this.timeline, this.sessionMemory,
      this.cockpit, this.executionGateway, this.workflowEngine,
      this.taskEngine, this.executiveOS, this.memory,
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
  }

  _assertReady() {
    if (this._destroyed) throw new Error('OperatorSession has been destroyed');
    if (!this._started) throw new Error('OperatorSession not started; call start() first');
  }
}

module.exports = OperatorSession;
