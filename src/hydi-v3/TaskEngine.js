'use strict';

const path = require('path');
const fs = require('fs').promises;

const PRIORITY = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

const VALID_STATUS = new Set([
  'pending', 'ready', 'running', 'completed', 'failed', 'blocked', 'rolledback',
]);

function isTerminal(status) {
  return status === 'completed' || status === 'failed' || status === 'rolledback';
}

/**
 * Persistent, dependency-aware task engine for HYDI V3.
 *
 * Supports priority queues, directed-acyclic-graph (DAG) dependency execution,
 * long-running/resumable tasks, rollback compensation, and lifecycle-safe
 * start/stop/destroy with asynchronous atomic persistence.
 */
class TaskEngine {
  constructor(options = {}) {
    this.dataPath = options.dataPath || path.resolve(__dirname, '../../data');
    this.intervalMs = options.intervalMs || 1000;
    this.maxConcurrency = options.maxConcurrency || 1;
    this.logger = options.logger || console;

    this.tasks = [];
    this.running = new Map();
    this._timer = null;
    this._persistTimer = null;
    this._persistPending = false;
    this._destroyed = false;
    this._started = false;

    this.storePath = path.join(this.dataPath, 'task-engine.json');
  }

  /**
   * Start the engine: load persisted state and begin processing ticks.
   * Idempotent and safe to call multiple times.
   */
  async start() {
    if (this._destroyed) {
      throw new Error('TaskEngine has been destroyed');
    }
    if (this._started) return;

    await this._ensureDataDir();
    await this._load();
    this._started = true;
    this._timer = setInterval(() => this._tick(), this.intervalMs);
    if (this._timer.unref) this._timer.unref();
    this.logger.log('[TaskEngine] started');
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
      createdAt: Date.now(),
      startedAt: undefined,
      completedAt: undefined,
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
   * Return a snapshot of queue and execution state.
   */
  getStatus() {
    const counts = {
      pending: 0, ready: 0, running: 0, completed: 0, failed: 0, blocked: 0, rolledback: 0,
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
        this.logger.error('[TaskEngine] compensation failed', { taskId, error: e.message });
      }
    }

    task.status = 'rolledback';
    task.completedAt = Date.now();
    this._blockDependents(task.id);
    this._persist();
  }

  /**
   * Execute all ready tasks until none remain (useful in tests and benchmarks).
   * Respects maxConcurrency for parallel execution.
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
  // Internal tick
  // -------------------------------------------------------------------------

  async _tick() {
    if (this._destroyed) return;
    try {
      await this.processReadyTasks();
    } catch (e) {
      this.logger.error('[TaskEngine] tick error', { error: e.message });
    }
  }

  async _runTask(task) {
    if (this.running.has(task.id)) return;
    this.running.set(task.id, task);
    task.status = 'running';
    task.startedAt = Date.now();
    this._persist();

    try {
      const result = await task.handler(task, this);
      task.result = result;
      task.status = 'completed';
      task.completedAt = Date.now();
    } catch (e) {
      task.error = e instanceof Error ? e.message : String(e);
      task.status = 'failed';
      task.completedAt = Date.now();
      this._blockDependents(task.id);
    } finally {
      this.running.delete(task.id);
      this._updateReadiness();
      this._persist();
    }
  }

  _getReadyTasks() {
    return this.tasks
      .filter((t) => t.status === 'ready')
      .sort((a, b) => PRIORITY[b.priority] - PRIORITY[a.priority] || a.createdAt - b.createdAt);
  }

  _updateReadiness() {
    for (const task of this.tasks) {
      if (task.status !== 'pending' && task.status !== 'blocked') continue;
      const allDepsDone = task.dependencies.every((depId) => {
        const dep = this.getTask(depId);
        return dep && dep.status === 'completed';
      });
      const anyDepFailed = task.dependencies.some((depId) => {
        const dep = this.getTask(depId);
        return dep && (dep.status === 'failed' || dep.status === 'rolledback');
      });

      if (anyDepFailed) {
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

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  async _ensureDataDir() {
    try {
      await fs.mkdir(this.dataPath, { recursive: true });
    } catch (e) {
      this.logger.error('[TaskEngine] data dir error', { error: e.message });
    }
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.tasks)) {
        this.tasks = parsed.tasks.map((t) => this._hydrate(t));
        this._updateReadiness();
      }
    } catch (e) {
      if (e.code !== 'ENOENT') {
        this.logger.error('[TaskEngine] load error', { error: e.message });
      }
    }
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
      createdAt: stored.createdAt,
      startedAt: stored.startedAt,
      completedAt: stored.completedAt,
      handler: undefined,
      compensation: undefined,
    };
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
      tasks: this.tasks.map((t) => this._serialize(t)),
      updatedAt: Date.now(),
    };
    const temp = `${this.storePath}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2));
      await fs.rename(temp, this.storePath);
    } catch (e) {
      this.logger.error('[TaskEngine] persist error', { error: e.message });
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
