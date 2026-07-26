'use strict';

const fs = require('fs').promises;
const path = require('path');
const { EventEmitter } = require('events');

const {
  DocumentationAdapter, FileOperationsAdapter, DevelopmentAdapter, CommunicationPrepAdapter,
} = require('./CapabilityAdapters');

const PERSISTENCE_VERSION = 1;

const ACTION_CLASSES = {
  'create-report': 'autonomous',
  'generate-summary': 'autonomous',
  'maintain-log': 'autonomous',
  'run-tests': 'autonomous',
  'run-benchmarks': 'autonomous',
  'collect-diagnostics': 'autonomous',
  'create-engineering-report': 'autonomous',
  'create-directory': 'autonomous',

  'update-markdown': 'review-required',
  'organize-files': 'review-required',
  'archive-artifacts': 'review-required',
  'draft-email': 'review-required',
  'prepare-customer-response': 'review-required',
  'generate-proposal': 'review-required',

  'delete-file': 'forbidden',
  'send-email': 'forbidden',
  'commit-code': 'forbidden',
  'purchase': 'forbidden',
  'transfer-funds': 'forbidden',
  'security-change': 'forbidden',
  'direct-external-api': 'forbidden',
};

function generateId() {
  return `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

class ExecutionGateway extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      dataPath: config.dataPath || path.resolve(__dirname, '../../data'),
      persistDebounceMs: config.persistDebounceMs ?? 50,
      logger: config.logger || console,
      simulate: config.simulate || false,
      ...config,
    };

    this.memory = config.businessMemory || null;
    this.adapters = new Map();
    this.pending = new Map();
    this.log = [];
    this._nextLogIndex = 1;

    this._persistTimer = null;
    this._persistPending = false;
    this._started = false;
    this._destroyed = false;

    this.storePath = path.join(this.config.dataPath, 'execution-gateway.json');

    if (config.adapters) {
      for (const adapter of config.adapters) this.addAdapter(adapter);
    } else {
      this._registerDefaultAdapters();
    }
  }

  _registerDefaultAdapters() {
    this.addAdapter(new DocumentationAdapter({ basePath: this.config.dataPath }));
    this.addAdapter(new FileOperationsAdapter({ basePath: this.config.dataPath }));
    this.addAdapter(new DevelopmentAdapter({ basePath: this.config.dataPath }));
    this.addAdapter(new CommunicationPrepAdapter());
  }

  addAdapter(adapter) {
    if (this._destroyed) throw new Error('ExecutionGateway has been destroyed');
    this.adapters.set(adapter.name, adapter);
  }

  getAdapter(name) {
    return this.adapters.get(name);
  }

  getCapabilities() {
    const list = [];
    for (const adapter of this.adapters.values()) {
      for (const action of adapter.allowedActions) {
        list.push({ adapter: adapter.name, action, actionClass: this._classify(action) });
      }
    }
    return list;
  }

  async initialize() {
    return this.start();
  }

  async start() {
    if (this._destroyed) throw new Error('ExecutionGateway has been destroyed');
    if (this._started) return;

    await this._ensureDataDir();
    await this._load();
    this._started = true;
    this.config.logger.log('[ExecutionGateway] started');
  }

  async flush() {
    return this._flush();
  }

  stop() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this._started = false;
    this.config.logger.log('[ExecutionGateway] stopped');
  }

  async destroy() {
    if (this._destroyed) return;
    this.stop();
    await this._flush();
    this.adapters.clear();
    this.pending.clear();
    this.log = [];
    this.removeAllListeners();
    this._destroyed = true;
  }

  healthCheck() {
    const checks = {
      initialized: !this._destroyed,
      hasAdapters: this.adapters.size > 0,
      noOrphanPending: true,
    };
    for (const entry of this.pending.values()) {
      if (!entry || !entry.id) checks.noOrphanPending = false;
    }
    const ok = Object.values(checks).every(Boolean);
    return { ok, checks, adapters: this.adapters.size, pending: this.pending.size, logEntries: this.log.length };
  }

  // -------------------------------------------------------------------------
  // Execution
  // -------------------------------------------------------------------------

  /**
   * Execute an action through the gateway. This is the only supported path.
   *
   * Action shape: { type, adapter?, params, requestingAgent?, workflowId? }
   */
  async execute(action, options = {}) {
    if (this._destroyed) throw new Error('ExecutionGateway has been destroyed');

    const id = action.id || generateId();
    const now = Date.now();
    const actionClass = this._classify(action.type);
    const entry = {
      id,
      timestamp: now,
      type: action.type,
      adapter: action.adapter || this._resolveAdapter(action.type),
      params: action.params || {},
      requestingAgent: action.requestingAgent || 'unknown',
      workflowId: action.workflowId,
      actionClass,
      approvalState: 'pending',
      status: 'pending',
      result: undefined,
      failureReason: undefined,
    };

    if (actionClass === 'forbidden') {
      entry.approvalState = 'rejected';
      entry.status = 'rejected';
      entry.failureReason = 'Action class is forbidden';
      this._record(entry);
      this.emit('action-rejected', { id, reason: entry.failureReason });
      throw new Error(`Forbidden action: ${action.type}`);
    }

    const adapter = this.adapters.get(entry.adapter);
    if (!adapter) {
      entry.status = 'failed';
      entry.failureReason = `No adapter registered for ${entry.adapter}`;
      this._record(entry);
      throw new Error(entry.failureReason);
    }

    if (!adapter.supports(action.type)) {
      entry.status = 'failed';
      entry.failureReason = `Adapter ${adapter.name} does not support ${action.type}`;
      this._record(entry);
      throw new Error(entry.failureReason);
    }

    if (actionClass === 'review-required' && !action.approved) {
      entry.approvalState = 'awaiting';
      entry.status = 'awaiting-approval';
      this.pending.set(id, entry);
      this._record(entry);
      this._persist();
      this.emit('approval-required', { id, type: action.type, requestingAgent: entry.requestingAgent });
      return { id, approved: false, status: 'awaiting-approval' };
    }

    return this._runEntry(entry, adapter, options.simulate || this.config.simulate);
  }

  async approve(actionId) {
    const entry = this.pending.get(actionId);
    if (!entry) throw new Error(`No pending action ${actionId}`);
    entry.approved = true;
    entry.approvalState = 'approved';
    this.pending.delete(actionId);
    const adapter = this.adapters.get(entry.adapter);
    return this._runEntry(entry, adapter, false);
  }

  reject(actionId) {
    const entry = this.pending.get(actionId);
    if (!entry) throw new Error(`No pending action ${actionId}`);
    entry.approvalState = 'rejected';
    entry.status = 'rejected';
    entry.failureReason = 'Rejected by operator';
    this.pending.delete(actionId);
    this._record(entry);
    this._persist();
    this.emit('action-rejected', { id: actionId, reason: entry.failureReason });
    return { id: actionId, approved: false, status: 'rejected' };
  }

  /**
   * Dry-run a pending action's adapter without approving, executing, or
   * mutating pending/log state. Used by the Approval Center's "simulate"
   * action so an operator can preview an outcome before deciding.
   */
  async simulatePending(actionId) {
    const entry = this.pending.get(actionId);
    if (!entry) throw new Error(`No pending action ${actionId}`);
    const adapter = this.adapters.get(entry.adapter);
    if (!adapter) throw new Error(`No adapter registered for ${entry.adapter}`);
    const result = await adapter.simulate({ type: entry.type, params: entry.params });
    return { id: actionId, simulated: true, type: entry.type, adapter: entry.adapter, result };
  }

  /**
   * Attach an operator note to a pending action without approving or
   * rejecting it, so the requesting agent can revise before resubmitting.
   */
  requestModification(actionId, notes) {
    const entry = this.pending.get(actionId);
    if (!entry) throw new Error(`No pending action ${actionId}`);
    entry.modificationRequested = true;
    entry.modificationNotes = notes || '';
    entry.modificationRequestedAt = Date.now();
    this._record(entry);
    this._persist();
    this.emit('modification-requested', { id: actionId, notes: entry.modificationNotes });
    return { id: actionId, status: 'awaiting-approval', modificationRequested: true, notes: entry.modificationNotes };
  }

  async _runEntry(entry, adapter, simulate) {
    entry.approvalState = 'approved';
    entry.status = 'running';
    this._record(entry);

    try {
      const result = simulate
        ? await adapter.simulate({ type: entry.type, params: entry.params })
        : await adapter.execute({ type: entry.type, params: entry.params });
      entry.status = 'completed';
      entry.result = result;
      entry.completedAt = Date.now();
      this._record(entry);
      this._updateMemory(entry);
      this.emit('action-completed', { id: entry.id, type: entry.type, result });
      return { id: entry.id, approved: true, status: 'completed', result };
    } catch (error) {
      entry.status = 'failed';
      entry.failureReason = error instanceof Error ? error.message : String(error);
      entry.completedAt = Date.now();
      this._record(entry);
      this.emit('action-failed', { id: entry.id, reason: entry.failureReason });
      throw error;
    }
  }

  _classify(actionType) {
    return ACTION_CLASSES[actionType] || 'review-required';
  }

  _resolveAdapter(actionType) {
    for (const [name, adapter] of this.adapters.entries()) {
      if (adapter.supports(actionType)) return name;
    }
    return 'unknown';
  }

  _record(entry) {
    if (entry._logIndex) {
      this.log[entry._logIndex - 1] = entry;
    } else {
      entry._logIndex = this._nextLogIndex++;
      this.log.push(entry);
    }
    this._persist();
  }

  _updateMemory(entry) {
    if (!this.memory) return;
    this.memory.put({
      type: 'task',
      name: `Executed ${entry.type}`,
      payload: { actionId: entry.id, result: entry.result, workflowId: entry.workflowId },
      tags: ['execution', entry.status, entry.adapter],
    });
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  getExecutionHistory(query = {}) {
    let entries = [...this.log];
    if (query.status) entries = entries.filter((e) => e.status === query.status);
    if (query.workflowId) entries = entries.filter((e) => e.workflowId === query.workflowId);
    if (query.requestingAgent) entries = entries.filter((e) => e.requestingAgent === query.requestingAgent);
    if (query.type) entries = entries.filter((e) => e.type === query.type);
    return entries.sort((a, b) => b.timestamp - a.timestamp);
  }

  getPendingApprovals() {
    return Array.from(this.pending.values()).sort((a, b) => a.timestamp - b.timestamp);
  }

  getDashboardData() {
    const counts = { completed: 0, failed: 0, rejected: 0, 'awaiting-approval': 0, pending: 0 };
    for (const e of this.log) {
      if (counts[e.status] !== undefined) counts[e.status] += 1;
    }
    const agentActivity = {};
    for (const e of this.log) {
      agentActivity[e.requestingAgent] = (agentActivity[e.requestingAgent] || 0) + 1;
    }
    return { counts, pendingApprovals: this.pending.size, agentActivity, recent: this.log.slice(-20) };
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  async _ensureDataDir() {
    try {
      await fs.mkdir(this.config.dataPath, { recursive: true });
    } catch (e) {
      this.config.logger.error('[ExecutionGateway] data dir error', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.log)) {
        this.log = parsed.log.map((e, i) => ({ ...e, _logIndex: i + 1 }));
        this._nextLogIndex = this.log.length + 1;
      } else {
        throw new Error('invalid snapshot');
      }
      if (parsed && Array.isArray(parsed.pending)) {
        this.pending = new Map(parsed.pending.map((e) => [e.id, e]));
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        this.log = [];
        this.pending = new Map();
      } else {
        this.config.logger.error('[ExecutionGateway] load error, archiving corrupt store', { error: e instanceof Error ? e.message : String(e) });
        await this._archiveCorruptStore();
        this.log = [];
        this.pending = new Map();
      }
    }
  }

  async _archiveCorruptStore() {
    try {
      const corruptPath = `${this.storePath}.corrupt.${Date.now()}`;
      await fs.rename(this.storePath, corruptPath);
    } catch (archiveError) {
      this.config.logger.error('[ExecutionGateway] failed to archive corrupt store', { error: archiveError instanceof Error ? archiveError.message : String(archiveError) });
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
      log: this.log.map((e) => {
        const rest = { ...e };
        delete rest._logIndex;
        return rest;
      }),
      pending: Array.from(this.pending.values()).map((e) => {
        const rest = { ...e };
        delete rest._logIndex;
        return rest;
      }),
    };
    const temp = `${this.storePath}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2));
      await fs.rename(temp, this.storePath);
    } catch (e) {
      this.config.logger.error('[ExecutionGateway] persist error', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

module.exports = { ExecutionGateway, ACTION_CLASSES };
