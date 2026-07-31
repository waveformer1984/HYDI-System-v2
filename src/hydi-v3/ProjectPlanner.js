'use strict';

const { EventEmitter } = require('events');
const fs = require('fs').promises;
const path = require('path');

const PERSISTENCE_VERSION = 1;

const STAGES = [
  'analyze', 'plan', 'implement', 'test', 'benchmark', 'document', 'commit', 'report',
];

const PRIORITY = {
  critical: 4,
  high: 3,
  normal: 2,
  low: 1,
};

function isValidStatus(status) {
  return ['pending', 'in_progress', 'completed', 'failed', 'cancelled'].includes(status);
}

function generateId() {
  return `proj_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function taskId(projectId, goalIndex, stageIndex) {
  return `${projectId}_g${goalIndex}_s${stageIndex}`;
}

/**
 * ProjectPlanner generates milestones, dependency graphs, and engineering backlogs
 * for autonomous projects. It integrates with the TaskEngine for execution and
 * persists plans to a local JSON file with lifecycle-safe start/stop/destroy.
 *
 * Every generated project follows the required engineering workflow:
 *   Analyze → Plan → Implement → Test → Benchmark → Document → Commit → Report
 */
class ProjectPlanner extends EventEmitter {
  constructor(config = {}) {
    super();
    this.config = {
      dataPath: config.dataPath || path.resolve(__dirname, '../../data'),
      persistDebounceMs: config.persistDebounceMs ?? 50,
      stages: config.stages || STAGES,
      logger: config.logger || console,
      ...config,
    };

    this.projects = new Map();
    this._persistTimer = null;
    this._persistPending = false;
    this._started = false;
    this._destroyed = false;

    this.storePath = path.join(this.config.dataPath, 'project-planner.json');
  }

  async initialize() {
    return this.start();
  }

  async start() {
    if (this._destroyed) throw new Error('ProjectPlanner has been destroyed');
    if (this._started) return;

    await this._ensureDataDir();
    await this._load();
    this._started = true;
    this.config.logger.log('[ProjectPlanner] started');
  }

  /**
   * Force an immediate persistence flush to disk.
   */
  async flush() {
    return this._flush();
  }

  /**
   * Verify internal consistency and report health diagnostics.
   */
  healthCheck() {
    const checks = {
      initialized: !this._destroyed,
      noOrphanTasks: true,
      dependencyTargetsExist: true,
      milestoneCoverage: true,
    };
    const allTaskIds = new Set();

    for (const project of this.projects.values()) {
      const projectTaskIds = new Set(project.tasks.map((t) => t.id));
      for (const t of project.tasks) {
        allTaskIds.add(t.id);
        if (!['pending', 'in_progress', 'completed', 'failed', 'cancelled'].includes(t.status)) {
          checks.noOrphanTasks = false;
        }
        for (const dep of t.dependencies) {
          if (!projectTaskIds.has(dep)) {
            checks.dependencyTargetsExist = false;
          }
        }
      }
      const coveredMilestones = new Set(project.tasks.map((t) => t.milestoneId));
      for (const m of project.milestones) {
        if (!coveredMilestones.has(m.id)) {
          checks.milestoneCoverage = false;
        }
      }
    }

    const ok = Object.values(checks).every(Boolean);
    return { ok, checks, projects: this.projects.size, totalTasks: allTaskIds.size };
  }

  stop() {
    if (this._persistTimer) {
      clearTimeout(this._persistTimer);
      this._persistTimer = null;
    }
    this._started = false;
    this.config.logger.log('[ProjectPlanner] stopped');
  }

  async destroy() {
    if (this._destroyed) return;
    this.stop();
    await this._flush();
    this.projects.clear();
    this.removeAllListeners();
    this._destroyed = true;
  }

  /**
   * Create a project from a set of engineering goals.
   * Returns the generated project id.
   */
  createProject(projectSpec) {
    if (this._destroyed) throw new Error('ProjectPlanner has been destroyed');

    const id = projectSpec.id || generateId();
    const now = Date.now();
    const project = {
      id,
      name: projectSpec.name || 'Untitled Project',
      description: projectSpec.description || '',
      goals: (projectSpec.goals || []).map((g, i) => this._normalizeGoal(g, i)),
      milestones: [],
      tasks: [],
      status: 'planning',
      createdAt: now,
      updatedAt: now,
    };

    this._generateMilestonesAndTasks(project);
    this.projects.set(id, project);
    this._persist();
    return id;
  }

  getProject(id) {
    return this.projects.get(id);
  }

  getProjects() {
    return Array.from(this.projects.values());
  }

  deleteProject(id) {
    if (this._destroyed) throw new Error('ProjectPlanner has been destroyed');
    const removed = this.projects.delete(id);
    if (removed) this._persist();
    return removed;
  }

  /**
   * Add an additional backlog item (bug, feature, tech-debt) to an existing project.
   */
  addBacklogItem(projectId, item) {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const goal = this._normalizeGoal(item, project.goals.length);
    project.goals.push(goal);
    const offset = project.tasks.length;
    this._generateGoalMilestones(project, goal, project.goals.length - 1, offset);
    project.updatedAt = Date.now();
    this._persist();
    return project;
  }

  /**
   * Return the pending backlog for a project or all projects.
   */
  getBacklog(projectId, options = {}) {
    const projects = projectId ? [this.getProject(projectId)].filter(Boolean) : this.getProjects();
    let tasks = [];
    for (const p of projects) {
      tasks = tasks.concat(p.tasks.filter((t) => (options.status ? t.status === options.status : t.status === 'pending')));
    }

    if (options.sortBy === 'priority') {
      tasks.sort((a, b) => (PRIORITY[b.priority] || 0) - (PRIORITY[a.priority] || 0) || a.order - b.order);
    } else if (options.sortBy === 'dependency') {
      tasks.sort((a, b) => a.order - b.order);
    }
    return tasks;
  }

  /**
   * Re-prioritize the pending backlog using a strategy.
   */
  prioritize(projectId, strategy = 'priority') {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const pending = project.tasks.filter((t) => t.status === 'pending');
    if (strategy === 'priority') {
      pending.sort((a, b) => (PRIORITY[b.priority] || 0) - (PRIORITY[a.priority] || 0) || a.order - b.order);
    } else if (strategy === 'dependency') {
      pending.sort((a, b) => a.order - b.order);
    } else if (strategy === 'reverse') {
      pending.reverse();
    }

    const reordered = pending.map((t, i) => ({ ...t, order: i + 1 }));
    const others = project.tasks.filter((t) => t.status !== 'pending');
    project.tasks = others.concat(reordered);
    project.updatedAt = Date.now();
    this._persist();
    return reordered;
  }

  /**
   * Convert a project's pending tasks into TaskEngine tasks and execute them.
   * handlerMap is an object mapping stage names to async functions.
   */
  toTaskEngine(projectId, taskEngine, handlerMap = {}) {
    const project = this.getProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const pending = project.tasks.filter((t) => t.status === 'pending');
    const stageHandlers = { ...this._defaultHandlers(), ...handlerMap };
    const idMap = new Map();

    for (const task of pending) {
      const handler = stageHandlers[task.stage] || stageHandlers.default;
      const engineId = taskEngine.enqueue({
        id: task.id,
        name: `${task.stage}: ${task.title}`,
        priority: task.priority,
        dependencies: task.dependencies,
        payload: { projectId, task },
        handler: async (t, engine) => {
          try {
            project.tasks.find((pt) => pt.id === t.id).status = 'in_progress';
            const result = await handler(t, engine, project);
            project.tasks.find((pt) => pt.id === t.id).status = 'completed';
            project.tasks.find((pt) => pt.id === t.id).result = result;
            project.updatedAt = Date.now();
            return result;
          } catch (e) {
            project.tasks.find((pt) => pt.id === t.id).status = 'failed';
            throw e;
          }
        },
        maxRetries: task.maxRetries ?? 1,
        retryDelay: task.retryDelay ?? 0,
      });
      idMap.set(task.id, engineId);
    }

    this._persist();
    return idMap;
  }

  getStatus() {
    let milestones = 0;
    const counts = { pending: 0, in_progress: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const p of this.projects.values()) {
      milestones += p.milestones.length;
      for (const t of p.tasks) {
        if (counts[t.status] !== undefined) counts[t.status] += 1;
      }
    }
    return {
      projects: this.projects.size,
      milestones,
      ...counts,
      totalTasks: Object.values(counts).reduce((a, b) => a + b, 0),
    };
  }

  // -------------------------------------------------------------------------
  // Internal
  // -------------------------------------------------------------------------

  _normalizeGoal(goal, index) {
    if (typeof goal === 'string') {
      return { title: goal, priority: 'normal', index };
    }
    return { priority: 'normal', title: `Goal ${index + 1}`, ...goal, index };
  }

  _generateMilestonesAndTasks(project) {
    project.milestones = [];
    project.tasks = [];
    project.goals.forEach((goal, i) => this._generateGoalMilestones(project, goal, i, project.tasks.length));
  }

  _generateGoalMilestones(project, goal, goalIndex, offset) {
    const stages = this.config.stages;
    const milestoneId = `${project.id}_m${goalIndex}`;
    const milestone = {
      id: milestoneId,
      title: `${goal.title}: ${stages.map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join(' → ')}`,
      goalIndex,
      order: goalIndex + 1,
      stages,
      createdAt: Date.now(),
    };
    project.milestones.push(milestone);

    for (let s = 0; s < stages.length; s += 1) {
      const stage = stages[s];
      const id = taskId(project.id, goalIndex, s);
      const dependencies = s === 0 ? [] : [taskId(project.id, goalIndex, s - 1)];
      project.tasks.push({
        id,
        title: `${stage}: ${goal.title}`,
        stage,
        goal: goal.title,
        milestoneId,
        priority: goal.priority || 'normal',
        status: 'pending',
        dependencies,
        order: offset + s + 1,
        result: undefined,
        createdAt: Date.now(),
        updatedAt: Date.now(),
        maxRetries: 1,
        retryDelay: 0,
      });
    }

    project.updatedAt = Date.now();
  }

  _defaultHandlers() {
    return {
      default: async (task, _engine, _project) => {
        this.config.logger.log('[ProjectPlanner] executing', { stage: task.payload.task.stage, title: task.payload.task.title });
        return { stage: task.payload.task.stage, completed: true };
      },
    };
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  async _ensureDataDir() {
    try {
      await fs.mkdir(this.config.dataPath, { recursive: true });
    } catch (e) {
      this.config.logger.error('[ProjectPlanner] data dir error', { error: e instanceof Error ? e.message : String(e) });
    }
  }

  async _load() {
    try {
      const raw = await fs.readFile(this.storePath, 'utf8');
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.projects)) {
        this.projects = new Map(parsed.projects.map((p) => [p.id, this._hydrate(p)]));
      } else {
        throw new Error('invalid snapshot');
      }
    } catch (e) {
      if (e.code === 'ENOENT') {
        this.projects = new Map();
      } else {
        this.config.logger.error('[ProjectPlanner] load error, archiving corrupt store', { error: e instanceof Error ? e.message : String(e) });
        await this._archiveCorruptStore();
        this.projects = new Map();
      }
    }
  }

  _hydrate(stored) {
    const p = { ...stored };
    p.goals = p.goals || [];
    p.milestones = p.milestones || [];
    p.tasks = (p.tasks || []).map((t) => ({
      ...t,
      status: isValidStatus(t.status) ? t.status : 'pending',
      dependencies: t.dependencies || [],
      priority: t.priority || 'normal',
      maxRetries: t.maxRetries ?? 1,
      retryDelay: t.retryDelay ?? 0,
    }));
    return p;
  }

  async _archiveCorruptStore() {
    try {
      const corruptPath = `${this.storePath}.corrupt.${Date.now()}`;
      await fs.rename(this.storePath, corruptPath);
    } catch (archiveError) {
      this.config.logger.error('[ProjectPlanner] failed to archive corrupt store', { error: archiveError instanceof Error ? archiveError.message : String(archiveError) });
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
      projects: Array.from(this.projects.values()),
    };
    const temp = `${this.storePath}.tmp`;
    try {
      await fs.writeFile(temp, JSON.stringify(snapshot, null, 2));
      await fs.rename(temp, this.storePath);
    } catch (e) {
      this.config.logger.error('[ProjectPlanner] persist error', { error: e instanceof Error ? e.message : String(e) });
    }
  }
}

module.exports = ProjectPlanner;
