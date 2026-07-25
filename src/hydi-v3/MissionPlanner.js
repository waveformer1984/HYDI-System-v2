'use strict';

const { EventEmitter } = require('events');
const { randomUUID } = require('crypto');
const fs = require('fs').promises;
const path = require('path');

/**
 * MissionPlanner replaces isolated task execution with mission planning.
 *
 * A mission is a hierarchy: mission -> objectives -> tasks. Tasks support
 * dependencies, priority, deadlines, parallel execution, and automatic replanning.
 */
class MissionPlanner extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      storagePath: config.storagePath || path.resolve(__dirname, '../../data/missions'),
      maxConcurrent: config.maxConcurrent || 5,
      defaultTaskPriority: config.defaultTaskPriority || 'medium',
      autoReplan: config.autoReplan !== false,
      persistDebounceMs: config.persistDebounceMs ?? 50,
      ...config,
    };

    this.missions = new Map();
    this.activeTasks = new Map();
    this.maxConcurrent = this.config.maxConcurrent;
    this._loaded = false;
    this._destroyed = false;
    this._persistTimer = null;
    this._persistPromise = null;
    this._persistResolve = null;
    this._persistInFlight = false;
  }

  async initialize() {
    if (this._destroyed) return;
    if (this._loaded) return;
    try {
      await fs.mkdir(this.config.storagePath, { recursive: true });
      await this.loadMissions();
    } catch (err) {
      console.error('[MISSION PLANNER] Initialization failed:', err.message);
    }
    this._loaded = true;
  }

  async destroy() {
    const hadPendingTimer = Boolean(this._persistTimer);
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this._destroyed = true;
    // If a flush or debounced persist is in flight, wait for it before
    // clearing in-memory state so we don't serialize an empty map.
    if (this._persistInFlight && this._persistPromise) {
      await this._persistPromise;
    }
    if (hadPendingTimer) {
      await this._doPersist();
    }
    if (this._persistResolve) {
      this._persistResolve();
      this._persistResolve = null;
      this._persistPromise = null;
    }
    this._persistInFlight = false;
    this.missions.clear();
    this.activeTasks.clear();
  }

  /**
   * Create a new mission.
   */
  createMission(name, objective, options = {}) {
    if (this._destroyed) return null;
    const missionId = options.id || `mission_${randomUUID()}`;
    const mission = {
      id: missionId,
      name,
      objective,
      status: options.status || 'active',
      priority: options.priority || 'medium',
      deadline: options.deadline || null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      archivedAt: null,
      objectives: options.objectives || [],
      tasks: new Map(),
      revenue: options.revenue || 0,
      failureCount: 0,
      replanCount: 0,
    };
    this.missions.set(missionId, mission);
    this.emit('mission_created', { missionId, name });
    this.persist();
    return missionId;
  }

  /**
   * Add a top-level objective to a mission.
   */
  addObjective(missionId, objective) {
    const mission = this.missions.get(missionId);
    if (!mission) return false;
    const obj = {
      id: objective.id || `objective_${randomUUID()}`,
      description: objective.description,
      status: 'pending',
      priority: objective.priority || 'medium',
      tasks: [],
      completedAt: null,
    };
    mission.objectives.push(obj);
    mission.updatedAt = new Date().toISOString();
    this.emit('objective_added', { missionId, objectiveId: obj.id });
    this.persist();
    return obj.id;
  }

  /**
   * Add a task to a mission/objective.
   */
  addTask(missionId, task, options = {}) {
    const mission = this.missions.get(missionId);
    if (!mission) return false;
    const taskId = task.id || `task_${randomUUID()}`;
    const taskRecord = {
      id: taskId,
      missionId,
      objectiveId: options.objectiveId || null,
      type: task.type || 'general',
      subtype: task.subtype || null,
      description: task.description || '',
      params: task.params || {},
      priority: task.priority || this.config.defaultTaskPriority,
      deadline: task.deadline || null,
      dependencies: task.dependencies || [],
      status: 'pending',
      assignedAgent: task.assignedAgent || null,
      createdAt: new Date().toISOString(),
      startedAt: null,
      completedAt: null,
      failedAt: null,
      retryCount: 0,
      result: null,
      error: null,
    };
    mission.tasks.set(taskId, taskRecord);
    mission.updatedAt = new Date().toISOString();
    this.emit('task_added', { missionId, taskId });
    this.persist();
    return taskId;
  }

  /**
   * Assign an agent to a task.
   */
  assignTask(taskId, agentId, missionId) {
    const mission = this.missions.get(missionId);
    if (!mission) return false;
    const task = mission.tasks.get(taskId);
    if (!task) return false;
    task.assignedAgent = agentId;
    mission.updatedAt = new Date().toISOString();
    this.emit('task_assigned', { missionId, taskId, agentId });
    this.persist();
    return true;
  }

  /**
   * Plan a mission: topologically sort tasks and set ready status.
   */
  planMission(missionId) {
    const mission = this.missions.get(missionId);
    if (!mission) return false;

    const ordered = this.topologicalSort(mission);
    for (const taskId of ordered) {
      const task = mission.tasks.get(taskId);
      if (task.status === 'pending') {
        task.ready = this.isTaskReady(mission, task);
      }
    }

    mission.updatedAt = new Date().toISOString();
    this.emit('mission_planned', { missionId, taskCount: ordered.length });
    this.persist();
    return true;
  }

  /**
   * Get the next batch of tasks that are ready for execution.
   */
  getNextTasks(capacity = this.maxConcurrent) {
    if (this._destroyed) return [];
    const readyTasks = [];
    for (const mission of this.missions.values()) {
      if (mission.status !== 'active') continue;
      for (const task of mission.tasks.values()) {
        if (task.status === 'pending' && this.isTaskReady(mission, task)) {
          readyTasks.push({ ...task, missionId: mission.id });
        }
      }
    }

    // Sort by priority, deadline, then created time
    readyTasks.sort((a, b) => {
      const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
      const pDiff = (priorityOrder[a.priority] || 99) - (priorityOrder[b.priority] || 99);
      if (pDiff !== 0) return pDiff;
      if (a.deadline && b.deadline) return new Date(a.deadline) - new Date(b.deadline);
      if (a.deadline) return -1;
      if (b.deadline) return 1;
      return new Date(a.createdAt) - new Date(b.createdAt);
    });

    return readyTasks.slice(0, capacity);
  }

  /**
   * Mark a task as started.
   */
  startTask(taskId, missionId) {
    const mission = this.missions.get(missionId);
    if (!mission) return false;
    const task = mission.tasks.get(taskId);
    if (!task) return false;
    task.status = 'running';
    task.startedAt = new Date().toISOString();
    task.ready = false;
    this.activeTasks.set(taskId, task);
    mission.updatedAt = new Date().toISOString();
    this.emit('task_started', { missionId, taskId });
    this.persist();
    return true;
  }

  /**
   * Mark a task as completed and update mission progress.
   */
  completeTask(taskId, missionId, result) {
    const mission = this.missions.get(missionId);
    if (!mission) return false;
    const task = mission.tasks.get(taskId);
    if (!task) return false;
    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.result = result || null;
    this.activeTasks.delete(taskId);
    mission.updatedAt = new Date().toISOString();
    this.emit('task_completed', { missionId, taskId, result });
    this.updateMissionProgress(mission);
    this.persist();
    return true;
  }

  /**
   * Mark a task as failed. Triggers automatic replanning if enabled.
   */
  failTask(taskId, missionId, error) {
    const mission = this.missions.get(missionId);
    if (!mission) return false;
    const task = mission.tasks.get(taskId);
    if (!task) return false;
    task.status = 'failed';
    task.failedAt = new Date().toISOString();
    task.error = error || 'unknown';
    task.retryCount++;
    this.activeTasks.delete(taskId);
    mission.failureCount++;
    mission.updatedAt = new Date().toISOString();
    this.emit('task_failed', { missionId, taskId, error });

    if (this.config.autoReplan) {
      this.replanMission(missionId);
    }
    this.updateMissionProgress(mission);
    this.persist();
    return true;
  }

  /**
   * Replan a mission after failures or changes.
   */
  replanMission(missionId) {
    const mission = this.missions.get(missionId);
    if (!mission) return false;

    mission.replanCount++;
    mission.status = 'replanning';

    for (const task of mission.tasks.values()) {
      if (task.status === 'failed') {
        if (task.retryCount < 3) {
          task.status = 'pending';
          task.error = null;
          task.ready = true;
        } else {
          task.status = 'permanently_failed';
        }
      }
    }

    this.planMission(missionId);
    mission.status = 'active';
    mission.updatedAt = new Date().toISOString();
    this.emit('mission_replanned', { missionId, replanCount: mission.replanCount });
    this.persist();
    return true;
  }

  pauseMission(missionId) {
    const mission = this.missions.get(missionId);
    if (!mission) return false;
    mission.status = 'paused';
    mission.updatedAt = new Date().toISOString();
    this.emit('mission_paused', { missionId });
    this.persist();
    return true;
  }

  resumeMission(missionId) {
    const mission = this.missions.get(missionId);
    if (!mission) return false;
    mission.status = 'active';
    mission.updatedAt = new Date().toISOString();
    this.emit('mission_resumed', { missionId });
    this.persist();
    return true;
  }

  cancelMission(missionId) {
    const mission = this.missions.get(missionId);
    if (!mission) return false;
    mission.status = 'cancelled';
    mission.updatedAt = new Date().toISOString();
    this.emit('mission_cancelled', { missionId });
    this.persist();
    return true;
  }

  archiveMission(missionId) {
    const mission = this.missions.get(missionId);
    if (!mission) return false;
    mission.status = 'archived';
    mission.archivedAt = new Date().toISOString();
    mission.updatedAt = new Date().toISOString();
    this.emit('mission_archived', { missionId });
    this.persist();
    return true;
  }

  getMission(missionId) {
    const mission = this.missions.get(missionId);
    if (!mission) return null;
    return this.serializeMission(mission);
  }

  getMissions(filters = {}) {
    let missions = Array.from(this.missions.values()).map((m) => this.serializeMission(m));
    if (filters.status) missions = missions.filter((m) => m.status === filters.status);
    return missions;
  }

  getStatus() {
    const missions = Array.from(this.missions.values()).map((m) => this.serializeMission(m));
    return {
      total: missions.length,
      active: missions.filter((m) => m.status === 'active').length,
      completed: missions.filter((m) => m.status === 'completed').length,
      failed: missions.filter((m) => m.status === 'failed').length,
      paused: missions.filter((m) => m.status === 'paused').length,
      runningTasks: this.activeTasks.size,
      missions,
    };
  }

  // ───────────────────────────────────────────────────────────────────────────

  isTaskReady(mission, task) {
    if (task.status !== 'pending') return false;
    if (!task.dependencies || task.dependencies.length === 0) return true;
    return task.dependencies.every((depId) => {
      const dep = mission.tasks.get(depId);
      return dep && dep.status === 'completed';
    });
  }

  topologicalSort(mission) {
    const tasks = Array.from(mission.tasks.values());
    const inDegree = new Map(tasks.map((t) => [t.id, 0]));
    const graph = new Map(tasks.map((t) => [t.id, []]));

    for (const task of tasks) {
      for (const dep of task.dependencies || []) {
        if (graph.has(dep)) {
          graph.get(dep).push(task.id);
          inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1);
        }
      }
    }

    const queue = tasks.filter((t) => inDegree.get(t.id) === 0).map((t) => t.id);
    const result = [];
    while (queue.length) {
      const id = queue.shift();
      result.push(id);
      for (const next of graph.get(id) || []) {
        inDegree.set(next, inDegree.get(next) - 1);
        if (inDegree.get(next) === 0) queue.push(next);
      }
    }

    if (result.length !== tasks.length) {
      // Circular dependency detected: fallback to insertion order
      return tasks.map((t) => t.id);
    }
    return result;
  }

  updateMissionProgress(mission) {
    const tasks = Array.from(mission.tasks.values());
    const completed = tasks.filter((t) => t.status === 'completed').length;
    const total = tasks.length;
    const progress = total === 0 ? 0 : completed / total;

    mission.progress = progress;

    if (progress === 1 && total > 0) {
      mission.status = 'completed';
      mission.completedAt = new Date().toISOString();
      this.emit('mission_completed', { missionId: mission.id, mission });
    } else if (tasks.some((t) => t.status === 'permanently_failed') && completed === 0) {
      mission.status = 'failed';
      this.emit('mission_failed', { missionId: mission.id, mission });
    }

    mission.updatedAt = new Date().toISOString();
  }

  serializeMission(mission) {
    return {
      ...mission,
      tasks: Array.from(mission.tasks.values()).map((t) => ({ ...t })),
      progress: mission.progress || 0,
    };
  }

  async persist() {
    if (this._destroyed) return;
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    const previousResolve = this._persistResolve;
    this._persistPromise = new Promise((resolve) => {
      this._persistResolve = resolve;
    });
    if (previousResolve) previousResolve();
    this._persistTimer = setTimeout(() => {
      this._persistTimer = null;
      this._persistInFlight = true;
      this._doPersist().finally(() => {
        this._persistInFlight = false;
        if (this._persistResolve) {
          this._persistResolve();
          this._persistResolve = null;
          this._persistPromise = null;
        }
      });
    }, this.config.persistDebounceMs).unref();
    return this._persistPromise;
  }

  async flush() {
    if (this._destroyed) return;
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    if (this._persistInFlight && this._persistPromise) {
      await this._persistPromise;
    }
    this._persistInFlight = true;
    this._persistPromise = new Promise((resolve) => {
      this._persistResolve = resolve;
    });
    try {
      await this._doPersist();
    } finally {
      this._persistInFlight = false;
      if (this._persistResolve) {
        this._persistResolve();
        this._persistResolve = null;
        this._persistPromise = null;
      }
    }
  }

  async _doPersist() {
    try {
      await fs.mkdir(this.config.storagePath, { recursive: true });
      const payload = {};
      for (const [id, mission] of this.missions) {
        payload[id] = this.serializeMission(mission);
      }
      const file = path.join(this.config.storagePath, 'missions.json');
      await fs.writeFile(file, JSON.stringify(payload, this._mapReplacer, 2));
    } catch (err) {
      if (!this._destroyed) {
        console.error('[MISSION PLANNER] Persist failed:', err.message);
      }
    }
  }

  _mapReplacer(key, value) {
    if (value instanceof Map) {
      return Object.fromEntries(value);
    }
    return value;
  }

  async loadMissions() {
    const file = path.join(this.config.storagePath, 'missions.json');
    try {
      const data = await fs.readFile(file, 'utf8');
      const parsed = JSON.parse(data);
      this.missions.clear();
      for (const [id, mission] of Object.entries(parsed)) {
        mission.tasks = new Map(Object.entries(mission.tasks || {}));
        this.missions.set(id, mission);
      }
    } catch (err) {
      if (err.code !== 'ENOENT') {
        this.missions.clear();
      }
    }
  }
}

module.exports = MissionPlanner;
