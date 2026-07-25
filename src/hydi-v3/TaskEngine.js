'use strict';

const path = require('path');
const fs = require('fs').promises;

const PERSISTENCE_VERSION = 1;

const PRIORITY = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

const VALID_STATUS = new Set([
  'pending', 'ready', 'running', 'completed', 'failed', 'blocked', 'rolledback', 'cancelled',
]);

const TERMINAL_STATUS = new Set([
  'completed', 'failed', 'rolledback', 'cancelled',
]);

function isTerminal(status) {
  return TERMINAL_STATUS.has(status);
}

/**
 * Persistent, dependency-aware, crash-recoverable task engine for HYDI V3.
 *
 * Supports priority queues, directed-acyclic-graph (DAG) dependency execution,
 * configurable retry with exponential backoff, rollback compensation, and
 * lifecycle-safe start/stop/destroy with asynchronous atomic persistence.
 *
 * Crash recovery semantics:
 *   - A task persisted with status "running" cannot be valid after restart
 *     because the in-process execution no longer exists.
 *   - On startup every "running" task is recovered: it is marked pending,
 *     interruption metadata is recorded, and its dependents are re-evaluated.
 *   - The scheduler then re-executes the task when dependencies are satisfied.
 *   - A recovered task is never executed twice concurrently.
 */
class TaskEngine {
  constructor(options = {}) {
    this.dataPath = options.dataPath || path.resolve(__dirname, '../../data');
    this.intervalMs = options.intervalMs || 1000;
    this.maxConcurrency = options.maxConcurrency || 1;
    this.retryDelay = options.retryDelay ?? 1000;
    this.backoffMultiplier = options.backoffMultiplier ?? 2;
    this.maxRetries = options.maxRetries ?? 3;
    this.logger = options.logger || console;

    this.engineSessionId = `engine_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    this.tasks = [];
    this.running = new Map();
    this._timer = null;
    this._persistTimer = null;
    this._persistPending = false;
    this._destroyed = false;
    this._started = false;
    this._recoveredCount = 0;
    this._interruptedTasks = [];
    this._recoveryDurationMs = 0;
    this._recoveryStartTime = null;

    this.storePath = path.join(this.dataPath, 'task-engine.json');
  }

  /**
   * Start the engine: load persisted state, recover interrupted executions,
   * rebuild the scheduler, and begin processing ticks.
   * Idempotent and safe to call multiple times.
   */
  async start() {
    if (this._destroyed) {
      throw new Error('TaskEngine has been destroyed');
    }
    if (this._started) return;

    await this._ensureDataDir();
    this._recoveryStartTime = Date.now();
    await this._load();
    this._recoveryDurationMs = Date.now() - this._recoveryStartTime;
    this._started = true;
    this._timer = setInterval(() => this._tick(), this.intervalMs);
    if (this._timer.unref) this._timer.unref();
    this.logger.log('[TaskEngine] started', { engineSessionId: this.engineSessionId, recovered: this._recoveredCount });
  }

  /**
   * Stop processing new ticks. Persisted state is kept intact.
   */
  stop() {
    if (this._timer) {
      clearInterval(this._timer);
      this._timer = null;
    }
    this._started = false;
    this.logger.log('[TaskEngine] stopped');
  }

  /**
   * Stop the engine and flush any pending persistence immediately.
   */
  async destroy() {
    if (this._destroyed) return;
    this.stop();
    await this._flush();
    this._destroyed = true;
  }

  /**
   * Add a new task to the queue. Returns the generated task id.
   */
  enqueue(taskDef) {
    if (this._destroyed) throw new Error('TaskEngine has been destroyed');

    const now = Date.now();
    const task = {
      id: taskDef.id || this._generateId(),
      name: taskDef.name || 'unnamed',
      handler: taskDef.handler,
      compensation: taskDef.compensation,
      dependencies: Array.isArray(taskDef.dependencies) ? [...taskDef.dependencies] : [],
      priority: typeof taskDef.priority === 'string' ? taskDef.priority : 'normal',
      payload: taskDef.payload || {},
      status: 'pending',
      result: undefined,
      error: undefined,
      createdAt: now,
      startedAt: undefined,
      completedAt: undefined,
      interruptedAt: undefined,
      resumedAt: undefined,
      lastHeartbeat: undefined,
      attemptCount: 0,
      retryCount: 0,
      interruptionCount: 0,
      retryDelay: taskDef.retryDelay ?? this.retryDelay,
      maxRetries: taskDef.maxRetries ?? this.maxRetries,
      backoffMultiplier: taskDef.backoffMultiplier ?? this.backoffMultiplier,
      nextRetryAt: undefined,
      retryHistory: [],
      resumePolicy: taskDef.resumePolicy || 'retry',
      workerId: undefined,
      engineSessionId: undefined,
      failureReason: undefined,
    };

    if (!PRIORITY[task.priority]) {
      task.priority = 'normal';
    }

    this.tasks.push(task);
    this._updateReadiness();
    this._persist();
    return task.id;
  }

  /**
   * Cancel a queued or running task. Completed/failed tasks cannot be cancelled.
   */
  cancel(taskId) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);
    if (isTerminal(task.status)) return false;

    if (task.status === 'running' && this.running.has(task.id)) {
      this.running.delete(task.id);
    }
    task.status = 'cancelled';
    task.completedAt = Date.now();
    task.failureReason = task.failureReason || 'cancelled';
    this._blockDependents(task.id);
    this._updateReadiness();
    this._persist();
    return true;
  }

  /**
   * Return a snapshot of queue and execution state.
   */
  getStatus() {
    const counts = {
      pending: 0, ready: 0, running: 0, completed: 0, failed: 0, blocked: 0, rolledback: 0, cancelled: 0,
    };
    for (const task of this.tasks) {
      if (counts[task.status] !== undefined) counts[task.status] += 1;
    }
    return {
      ...counts,
      total: this.tasks.length,
      activeRunning: this.running.size,
    };
  }

  /**
   * Return diagnostic information for the operator dashboard.
   */
  getHealthReport() {
    const now = Date.now();
    const retryQueue = this.tasks
      .filter((t) => (t.status === 'ready' || t.status === 'pending') && t.nextRetryAt && t.nextRetryAt > now)
      .map((t) => ({ id: t.id, name: t.name, retryCount: t.retryCount, nextRetryAt: t.nextRetryAt }));
    return {
      engineSessionId: this.engineSessionId,
      interruptedTasks: this._interruptedTasks.slice(),
      recoveredCount: this._recoveredCount,
      recoveryDurationMs: this._recoveryDurationMs,
      activeWorkers: [...this.running.entries()].map(([id, t]) => ({ id, name: t.name, startedAt: t.startedAt })),
      retryQueue,
      queuedTasks: this.tasks.filter((t) => t.status === 'ready' && (!t.nextRetryAt || t.nextRetryAt <= now)).length,
      blockedTasks: this.tasks.filter((t) => t.status === 'blocked').length,
      failedTasks: this.tasks.filter((t) => t.status === 'failed').length,
      totalTasks: this.tasks.length,
    };
  }

  getTask(id) {
    return this.tasks.find((t) => t.id === id);
  }

  /**
   * Roll back a completed or failed task, running its compensation handler
   * if provided. Any dependent tasks that have not completed are blocked.
   */
  async rollback(taskId) {
    const task = this.getTask(taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    if (task.compensation) {
      try {
        await task.compensation(task, this);
      } catch (e) {
        this.logger.error('[TaskEngine] compensation failed', { taskId, error: e instanceof Error ? e.message : String(e) });
      }
    }

    task.status = 'rolledback';
    task.completedAt = Date.now();
    task.failureReason = task.failureReason || 'rolledback';
    this._blockDependents(task.id);
    this._updateReadiness();
    this._persist();
  }

  /**
   * Execute all ready tasks until none remain (useful in tests and benchmarks).
   * Respects maxConcurrency for parallel execution and retry delays.
   */
  async processReadyTasks() {
    const active = new Map();
    while (true) {
      while (active.size < this.maxConcurrency) {
        const ready = this._getReadyTasks().filter((t) => !active.has(t.id));
        if (ready.length === 0) break;
        const task = ready[0];
        const promise = this._runTask(task).finally(() => active.delete(task.id));
        active.set(task.id, promise);
      }
      if (active.size === 0) break;
      await Promise.race(active.values());
    }
  }

  // -------------------------------------------------------------------------
  // Internal tick and execution
  // -------------------------------------------------------------------------

  async _tick() {
    if (this._destroyed) return;
    try {
      await this.processReadyTasks();
    } catch (e) {
      this.logger.error('[TaskEngine] tick error', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  async _runTask(task) {
    if (this.running.has(task.id)) return;
    if (isTerminal(task.status) || task.status === 'cancelled') return;

    const now = Date.now();
    if (task.nextRetryAt && task.nextRetryAt > now) return;

    this.running.set(task.id, task);
    task.status = 'running';
    task.startedAt = now;
    task.lastHeartbeat = now;
    task.resumedAt = task.interruptedAt ? now : (task.resumedAt || now);
    task.attemptCount += 1;
    task.workerId = this.engineSessionId;
    task.engineSessionId = this.engineSessionId;
    this._persist();

    try {
      const result = await task.handler(task, this);
      task.result = result;
      task.status = 'completed';
      task.completedAt = Date.now();
      task.failureReason = undefined;
      task.nextRetryAt = undefined;
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      task.error = message;
      task.failureReason = message;
      task.lastHeartbeat = Date.now();

      const maxAttempts = Math.max(0, Number.isFinite(task.maxRetries) ? task.maxRetries : this.maxRetries);
      if (task.retryCount < maxAttempts) {
        task.retryCount += 1;
        task.retryHistory.push({ at: Date.now(), reason: message });
        const base = Number.isFinite(task.retryDelay) ? task.retryDelay : this.retryDelay;
        const mult = Number.isFinite(task.backoffMultiplier) ? task.backoffMultiplier : this.backoffMultiplier;
        task.nextRetryAt = Date.now() + base * (mult ** Math.max(0, task.retryCount - 1));
        task.status = 'pending';
        task.startedAt = undefined;
        task.engineSessionId = undefined;
      } else {
        task.status = 'failed';
        task.completedAt = Date.now();
        this._blockDependents(task.id);
      }
    } finally {
      this.running.delete(task.id);
      this._updateReadiness();
      this._persist();
    }
  }

  _getReadyTasks() {
    const now = Date.now();
    return this.tasks
      .filter((t) => t.status === 'ready' && (!t.nextRetryAt || t.nextRetryAt <= now))
      .sort((a, b) => PRIORITY[b.priority] - PRIORITY[a.priority] || a.createdAt - b.createdAt);
  }

  _updateReadiness() {
    for (const task of this.tasks) {
      if (task.status !== 'pending' && task.status !== 'blocked') continue;
      const allDepsDone = task.dependencies.every((depId) => {
        const dep = this.getTask(depId);
        return dep && dep.status === 'completed';
      });
      const anyDepTerminalFailed = task.dependencies.some((depId) => {
        const dep = this.getTask(depId);
        return dep && (dep.status === 'failed' || dep.status === 'rolledback' || dep.status === 'cancelled');
      });

      if (anyDepTerminalFailed) {
        task.status = 'blocked';
      } else if (allDepsDone) {
        task.status = 'ready';
      } else if (task.status === 'blocked') {
        task.status = 'pending';
      }
    }
  }

  _blockDependents(failedTaskId) {
    for (const task of this.tasks) {
      if (task.dependencies.includes(failedTaskId) && !isTerminal(task.status)) {
        task.status = 'blocked';
      }
    }
  }

  _recoverInterruptedTasks() {
    const now = Date.now();
    let recovered = 0;
    for (const task of this.tasks) {
      if (task.status !== 'running') continue;
      task.interruptedAt = now;
      task.resumedAt = undefined;
      task.interruptionCount += 1;
      task.failureReason = task.failureReason || 'interrupted';
      task.startedAt = undefined;
      task.engineSessionId = undefined;
      task.lastHeartbeat = undefined;
      task.workerId = undefined;
      task.status = 'pending';
      this._interruptedTasks.push(task.id);
      recovered += 1;
    }
    this._recoveredCount = recovered;
    if (recovered > 0) {
      this.logger.log('[TaskEngine] recovered interrupted tasks', { count: recovered, tasks: this._interruptedTasks });
    }
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  async _ensureDataDir() {
    try {
      await fs.mkdir(this.dataPath, { recursive: true });
    } catch (e) {
      this.logger.error('[TaskEngine] data dir error', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.tasks)) {
        const migrated = this._migrateTasks(parsed.tasks);
        this.tasks = migrated.map((t) => this._hydrate(t));
      } else {
        throw new Error('invalid snapshot: tasks array missing');
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        this.tasks = [];
      } else {
        this.logger.error('[TaskEngine] load error, archiving corrupt store', { error: e instanceof Error ? e.message : String(e) });
        await this._archiveCorruptStore();
        this.tasks = [];
      }
    }
    this._recoverInterruptedTasks();
    this._updateReadiness();
  }

  _migrateTasks(rawTasks) {
    return rawTasks.map((t) => {
      const migrated = { ...t };
      if (migrated.status === undefined) migrated.status = 'pending';
      if (migrated.interruptionCount === undefined) migrated.interruptionCount = 0;
      if (migrated.retryCount === undefined) migrated.retryCount = 0;
      if (migrated.attemptCount === undefined) migrated.attemptCount = 0;
      if (migrated.retryHistory === undefined) migrated.retryHistory = [];
      if (migrated.maxRetries === undefined) migrated.maxRetries = this.maxRetries;
      if (migrated.retryDelay === undefined) migrated.retryDelay = this.retryDelay;
      if (migrated.backoffMultiplier === undefined) migrated.backoffMultiplier = this.backoffMultiplier;
      return migrated;
    });
  }

  _hydrate(stored) {
    return {
      id: stored.id,
      name: stored.name,
      dependencies: stored.dependencies || [],
      priority: stored.priority || 'normal',
      payload: stored.payload || {},
      status: VALID_STATUS.has(stored.status) ? stored.status : 'pending',
      result: stored.result,
      error: stored.error,
      createdAt: stored.createdAt || Date.now(),
      startedAt: stored.startedAt,
      completedAt: stored.completedAt,
      interruptedAt: stored.interruptedAt,
      resumedAt: stored.resumedAt,
      lastHeartbeat: stored.lastHeartbeat,
      attemptCount: stored.attemptCount || 0,
      retryCount: stored.retryCount || 0,
      interruptionCount: stored.interruptionCount || 0,
      retryDelay: stored.retryDelay,
      maxRetries: stored.maxRetries,
      backoffMultiplier: stored.backoffMultiplier,
      nextRetryAt: stored.nextRetryAt,
      retryHistory: stored.retryHistory || [],
      resumePolicy: stored.resumePolicy || 'retry',
      workerId: stored.workerId,
      engineSessionId: stored.engineSessionId,
      failureReason: stored.failureReason,
      handler: undefined,
      compensation: undefined,
    };
  }

  async _archiveCorruptStore() {
    try {
      const corruptPath = `${this.storePath}.corrupt.${Date.now()}`;
      await fs.rename(this.storePath, corruptPath);
    } catch (archiveError) {
      this.logger.error('[TaskEngine] failed to archive corrupt store', { error: archiveError instanceof Error ? archiveError.message : String(archiveError) });
    }
  }

  _persist() {
    if (this._destroyed) return;
    this._persistPending = true;
    if (this._persistTimer) return;
    this._persistTimer = setTimeout(() => this._flush(), 50);
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
      engineSessionId: this.engineSessionId,
      updatedAt: Date.now(),
      tasks: this.tasks.map((t) => this._serialize(t)),
    };
    const temp = `${this.storePath}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2));
      await fs.rename(temp, this.storePath);
    } catch (e) {
      this.logger.error('[TaskEngine] persist error', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  _serialize(task) {
    const s = { ...task };
    delete s.handler;
    delete s.compensation;
    return s;
  }

  _generateId() {
    return `task_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  }
}

module.exports = TaskEngine;
