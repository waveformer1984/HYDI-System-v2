'use strict';

const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');

const PERSISTENCE_VERSION = 1;
const MAX_ENTRIES = 2000;

function generateId() {
  return `tl_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * ExecutiveTimeline is a single, append-only, timestamped record of everything
 * the owner would want to see in an activity feed: completed work, new
 * recommendations, workflow progress, agent activity, approvals, system
 * events, and backup events.
 *
 * It never invents events. It only records what other components already
 * emitted (ExecutionGateway, BusinessWorkflowEngine, ExecutiveOperatingSystem,
 * ExecutiveCockpit) or what a caller explicitly logs (e.g. a conversation turn
 * or a backup run). This keeps the timeline consistent with the rest of the
 * executive stack instead of becoming a second source of truth.
 */
class ExecutiveTimeline extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      dataPath: config.dataPath || path.resolve(__dirname, '../../data'),
      persistDebounceMs: config.persistDebounceMs ?? 50,
      logger: config.logger || console,
      maxEntries: config.maxEntries || MAX_ENTRIES,
      ...config,
    };

    this.entries = [];
    this._unsubscribers = [];
    this._seq = 0;

    this._persistTimer = null;
    this._persistPending = false;
    this._started = false;
    this._destroyed = false;

    this.storePath = path.join(this.config.dataPath, 'executive-timeline.json');
  }

  async initialize() {
    return this.start();
  }

  async start() {
    if (this._destroyed) throw new Error('ExecutiveTimeline has been destroyed');
    if (this._started) return;

    await this._ensureDataDir();
    await this._load();
    this._subscribe(this.config.executionGateway, this._executionGatewayHandlers());
    this._subscribe(this.config.workflowEngine, this._workflowEngineHandlers());
    this._subscribe(this.config.executiveOS, this._executiveOSHandlers());
    this._subscribe(this.config.cockpit, this._cockpitHandlers());
    this._started = true;
    this.config.logger.log('[ExecutiveTimeline] started');
  }

  async flush() {
    return this._flush();
  }

  stop() {
    for (const off of this._unsubscribers) {
      try { off(); } catch (e) { /* ignore */ }
    }
    this._unsubscribers = [];
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this._started = false;
    this.config.logger.log('[ExecutiveTimeline] stopped');
  }

  async destroy() {
    if (this._destroyed) return;
    this.stop();
    await this._flush();
    this.entries = [];
    this.removeAllListeners();
    this._destroyed = true;
  }

  healthCheck() {
    const checks = {
      initialized: !this._destroyed,
      chronological: this._isChronological(),
    };
    const ok = Object.values(checks).every(Boolean);
    return { ok, checks, entries: this.entries.length };
  }

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  /**
   * Record one timeline event. category is one of: execution, workflow,
   * approval, briefing, conversation, system, backup.
   */
  record(category, summary, detail = {}) {
    this._seq += 1;
    const entry = {
      id: generateId(),
      at: Date.now(),
      seq: this._seq,
      category,
      summary,
      detail,
    };
    this.entries.push(entry);
    if (this.entries.length > this.config.maxEntries) {
      this.entries = this.entries.slice(-this.config.maxEntries);
    }
    this._persist();
    this.emit('event', entry);
    return entry;
  }

  /**
   * Query the timeline. Supports category, since (ms timestamp), and limit.
   * Always returns newest first.
   */
  list(query = {}) {
    let out = [...this.entries];
    if (query.category) out = out.filter((e) => e.category === query.category);
    if (query.since) out = out.filter((e) => e.at >= query.since);
    out.sort((a, b) => b.at - a.at || (b.seq || 0) - (a.seq || 0));
    if (query.limit) out = out.slice(0, query.limit);
    return out;
  }

  /**
   * Events recorded since a given timestamp, grouped by category — the data
   * behind "what changed overnight?".
   */
  since(timestamp) {
    const items = this.list({ since: timestamp });
    const byCategory = {};
    for (const item of items) {
      byCategory[item.category] = byCategory[item.category] || [];
      byCategory[item.category].push(item);
    }
    return { since: timestamp, count: items.length, items, byCategory };
  }

  // -------------------------------------------------------------------------
  // Event source wiring
  // -------------------------------------------------------------------------

  _subscribe(emitter, handlers) {
    if (!emitter || typeof emitter.on !== 'function') return;
    for (const [event, handler] of Object.entries(handlers)) {
      emitter.on(event, handler);
      this._unsubscribers.push(() => emitter.removeListener(event, handler));
    }
  }

  _executionGatewayHandlers() {
    return {
      'action-completed': (data) => this.record('execution', `Completed ${data.type}`, data),
      'action-failed': (data) => this.record('execution', `Failed ${data.type || ''}: ${data.reason}`, data),
      'action-rejected': (data) => this.record('approval', `Rejected action ${data.id}: ${data.reason}`, data),
      'approval-required': (data) => this.record('approval', `Approval required for ${data.type} (requested by ${data.requestingAgent})`, data),
      'modification-requested': (data) => this.record('approval', `Modification requested on ${data.id}`, data),
    };
  }

  _workflowEngineHandlers() {
    return {
      'workflow-created': (data) => this.record('workflow', `New workflow: ${data.title} (${data.type})`, data),
      'workflow-approved': (data) => this.record('approval', `Workflow ${data.id} approved`, data),
      'workflow-started': (data) => this.record('workflow', `Workflow ${data.id} started`, data),
      'step-completed': (data) => this.record('workflow', `Step "${data.step}" completed on ${data.workflowId}`, data),
      'workflow-completed': (data) => this.record('workflow', `Workflow completed: ${data.title}`, data),
      'workflow-failed': (data) => this.record('workflow', `Workflow ${data.id} failed: ${data.error}`, data),
      'outcome-recorded': (data) => this.record('workflow', `Outcome recorded for ${data.title}`, data),
    };
  }

  _executiveOSHandlers() {
    return {
      briefing: (data) => this.record('briefing', `Executive briefing generated (${(data.priorityActions || []).length} actions, ${(data.risks || []).length} risks)`, {
        generatedAt: data.generatedAt,
      }),
    };
  }

  _cockpitHandlers() {
    return {
      interaction: (data) => this.record('conversation', `Command: "${data.text}"`, { command: data.command }),
    };
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  _isChronological() {
    for (let i = 1; i < this.entries.length; i++) {
      if (this.entries[i].at < this.entries[i - 1].at) return false;
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  async _ensureDataDir() {
    try {
      await fs.mkdir(this.config.dataPath, { recursive: true });
    } catch (e) {
      this.config.logger.error('[ExecutiveTimeline] data dir error', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.entries)) {
        this.entries = parsed.entries;
      } else {
        throw new Error('invalid snapshot');
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        this.entries = [];
      } else {
        this.config.logger.error('[ExecutiveTimeline] load error, archiving corrupt store', { error: e instanceof Error ? e.message : String(e) });
        await this._archiveCorruptStore();
        this.entries = [];
      }
    }
  }

  async _archiveCorruptStore() {
    try {
      const corruptPath = `${this.storePath}.corrupt.${Date.now()}`;
      await fs.rename(this.storePath, corruptPath);
    } catch (archiveError) {
      this.config.logger.error('[ExecutiveTimeline] failed to archive corrupt store', { error: archiveError instanceof Error ? archiveError.message : String(archiveError) });
    }
  }

  _persist() {
    if (this._destroyed) return;
    this._persistPending = true;
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => this._flush(), this.config.persistDebounceMs);
    if (this._persistTimer.unref) this._persistTimer.unref();
  }

  async _flush() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    if (!this._persistPending) return;
    this._persistPending = false;

    const snapshot = {
      version: PERSISTENCE_VERSION,
      updatedAt: Date.now(),
      entries: this.entries.slice(-this.config.maxEntries),
    };
    const temp = `${this.storePath}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2));
      await fs.rename(temp, this.storePath);
    } catch (e) {
      this.config.logger.error('[ExecutiveTimeline] persist error', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

module.exports = ExecutiveTimeline;
