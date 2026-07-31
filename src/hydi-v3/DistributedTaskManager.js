'use strict';

const { EventEmitter } = require('events');

/**
 * DistributedTaskManager handles the full lifecycle of tasks across the
 * federation: advertisement, assignment, execution, acknowledgement,
 * cancellation, retry, timeout and rollback. No remote code is executed;
 * only pre-registered local handlers are invoked for known task types.
 */
class DistributedTaskManager extends EventEmitter {
  constructor(config = {}) {
    super();
    this.mesh = config.mesh || null;
    this.policy = config.policy || null;
    this.lifecycleRegistry = config.lifecycleRegistry || null;
    this.logger = config.logger || console;
    this.localNodeId = config.localNodeId || (this.mesh && this.mesh.identity ? this.mesh.identity.nodeId : 'local');
    this.tasks = new Map();
    this.handlers = new Map();
    this.retries = new Map();
    this.defaultTimeoutMs = config.defaultTimeoutMs || 30000;
    this.maxRetries = config.maxRetries || 3;
    this._onAdvert = (msg) => this._handleRemoteTask(msg);
    this._onResult = (msg) => this._handleResult(msg);
    this._onCancel = (msg) => this._handleCancel(msg);
  }

  start() {
    if (this.mesh && this.mesh.transport) {
      this.mesh.on('task_advert', this._onAdvert);
      this.mesh.on('task_result', this._onResult);
      this.mesh.on('task_cancel', this._onCancel);
    }
    this.emit('started');
    return this;
  }

  stop() {
    if (this.mesh) {
      this.mesh.off('task_advert', this._onAdvert);
      this.mesh.off('task_result', this._onResult);
      this.mesh.off('task_cancel', this._onCancel);
    }
    for (const [taskId, timer] of this.retries) clearTimeout(timer);
    this.retries.clear();
    this.emit('stopped');
    return this;
  }

  registerHandler(type, handler) {
    this.handlers.set(type, handler);
    return this;
  }

  advertise(task, options = {}) {
    const taskId = task.id || `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const record = {
      id: taskId,
      type: task.type,
      payload: task.payload,
      requestedBy: options.requestedBy || this.localNodeId,
      assignedTo: null,
      status: 'advertised',
      createdAt: Date.now(),
      timeoutMs: options.timeoutMs || this.defaultTimeoutMs,
      retries: 0,
    };
    this.tasks.set(taskId, record);
    this._audit('advertise', record);
    this.emit('advertised', record);
    if (this.mesh) this.mesh.broadcast('task_advert', { taskId, type: record.type, payload: record.payload, requestedBy: record.requestedBy });
    return record;
  }

  assign(taskId, nodeId) {
    const task = this.tasks.get(taskId);
    if (!task) return { success: false, error: 'task_not_found' };
    task.assignedTo = nodeId;
    task.status = 'assigned';
    this._audit('assign', task);
    this.emit('assigned', task);
    return { success: true, task };
  }

  async execute(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return { success: false, error: 'task_not_found' };
    if (this.policy) {
      const allowed = this.policy.validateAction('execute', { task, nodeId: task.requestedBy || this.localNodeId });
      if (!allowed.allowed) {
        task.status = 'failed';
        task.error = allowed.reason;
        task.failedAt = Date.now();
        this._audit('execute_denied', task);
        this.emit('failed', task);
        return { success: false, error: allowed.reason };
      }
    }
    task.status = 'executing';
    task.startedAt = Date.now();
    this._audit('execute', task);
    this.emit('executing', task);

    const handler = this.handlers.get(task.type);
    if (!handler) {
      return this._fail(task, 'no_handler');
    }

    const timeout = setTimeout(() => this._timeout(task.id), task.timeoutMs);
    try {
      const result = await handler(task.payload, task);
      clearTimeout(timeout);
      return this._complete(task, result);
    } catch (err) {
      clearTimeout(timeout);
      return this._fail(task, err instanceof Error ? err.message : String(err));
    }
  }

  _handleRemoteTask(msg) {
    if (!msg || !msg.payload || msg.payload.requestedBy === this.localNodeId) return;
    const { taskId, type, payload, requestedBy } = msg.payload;
    if (this.tasks.has(taskId)) return;
    const record = {
      id: taskId,
      type,
      payload,
      requestedBy,
      assignedTo: this.localNodeId,
      status: 'received',
      createdAt: Date.now(),
    };
    this.tasks.set(taskId, record);
    this.execute(taskId).then((result) => {
      if (this.mesh) {
        this.mesh.send(requestedBy, 'task_result', { taskId, ...result });
      }
    });
  }

  _handleResult(msg) {
    const { taskId, success, result, error } = msg.payload || {};
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (success) {
      task.status = 'completed';
      task.result = result;
      task.completedAt = Date.now();
      this._audit('complete', task);
      this.emit('completed', task);
    } else {
      this._fail(task, error || 'remote_failure');
    }
  }

  _handleCancel(msg) {
    const { taskId } = (msg && msg.payload) || {};
    this.cancel(taskId);
  }

  _complete(task, result) {
    task.status = 'completed';
    task.result = result;
    task.completedAt = Date.now();
    this._audit('complete', task);
    this.emit('completed', task);
    return { success: true, taskId: task.id, result };
  }

  _fail(task, error) {
    task.status = 'failed';
    task.error = error;
    task.failedAt = Date.now();
    this._audit('fail', task);
    this.emit('failed', task);
    if (task.retries < this.maxRetries) {
      task.retries += 1;
      const timer = setTimeout(() => this._retry(task.id), 1000 * task.retries);
      this.retries.set(task.id, timer);
      return { success: false, taskId: task.id, error, retryScheduled: true };
    }
    this._rollback(task);
    return { success: false, taskId: task.id, error };
  }

  _timeout(taskId) {
    const task = this.tasks.get(taskId);
    if (!task || task.status === 'completed') return;
    this._fail(task, 'timeout');
  }

  _retry(taskId) {
    this.retries.delete(taskId);
    const task = this.tasks.get(taskId);
    if (!task) return;
    task.status = 'retrying';
    this.execute(taskId);
  }

  _rollback(task) {
    task.rollback = { rolledBackAt: Date.now() };
    this._audit('rollback', task);
    this.emit('rollback', task);
    const rollbackHandler = this.handlers.get(`${task.type}:rollback`);
    if (rollbackHandler) rollbackHandler(task);
  }

  cancel(taskId) {
    const task = this.tasks.get(taskId);
    if (!task) return { success: false, error: 'task_not_found' };
    if (task.status === 'completed') return { success: false, error: 'already_completed' };
    task.status = 'cancelled';
    this._audit('cancel', task);
    this.emit('cancelled', task);
    if (this.mesh) this.mesh.broadcast('task_cancel', { taskId });
    return { success: true, task };
  }

  getStatus(taskId) {
    return this.tasks.get(taskId) || null;
  }

  list() {
    return Array.from(this.tasks.values());
  }

  _audit(action, task) {
    const entry = { at: Date.now(), action, taskId: task.id, status: task.status, nodeId: this.localNodeId };
    if (this.lifecycleRegistry) this.lifecycleRegistry.recordProposal(entry);
    this.emit('audit', entry);
  }
}

module.exports = DistributedTaskManager;
