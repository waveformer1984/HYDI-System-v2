/**
 * Heidi Goal Engine — Persistent, Multi-Step Objectives
 *
 * Upgrades Heidi from "reactive chat agent" to "goal-directed agent".
 * Goals persist across restarts (JSON file). Each goal decomposes into
 * an ordered task list; Heidi can ask the brain to break down a new
 * objective and then execute tasks one at a time.
 *
 * Usage:
 *   const goals = new HeidiGoalEngine(brain, memory);
 *   await goals.initialize();
 *   const goal = await goals.addGoal('Build the passive-services health page');
 *   const task = goals.nextTask(goal.id);
 *   await goals.completeTask(goal.id, task.id, { result: 'done' });
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_STORE = path.join(__dirname, '../heidi-core/data/heidi_goals.json');

class HeidiGoalEngine {
  constructor(brain, memory, config = {}) {
    this.brain = brain;       // OllamaClient (or Groq-compatible)
    this.memory = memory;     // HeidiMemory instance
    this.storePath = config.storePath || DEFAULT_STORE;
    this.goals = [];
  }

  async initialize() {
    this._ensureDir();
    this._load();
  }

  // ─── Goal Lifecycle ───────────────────────────────────────────────────────

  /**
   * Create a new goal from a natural-language objective.
   * Asks the brain to decompose it into 3-7 concrete tasks.
   */
  async addGoal(objective, priority = 'normal') {
    const tasks = await this._decompose(objective);
    const goal = {
      id: `goal_${crypto.randomBytes(4).toString('hex')}`,
      objective,
      priority,
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      tasks,
      completedTasks: [],
      notes: [],
    };
    this.goals.push(goal);
    this._save();
    return goal;
  }

  getGoal(goalId) {
    return this.goals.find(g => g.id === goalId) || null;
  }

  getActiveGoals() {
    return this.goals.filter(g => g.status === 'active');
  }

  getAllGoals() {
    return this.goals;
  }

  /**
   * Return the next incomplete task for a goal (or null if all done).
   */
  nextTask(goalId) {
    const goal = this.getGoal(goalId);
    if (!goal) return null;
    return goal.tasks.find(t => t.status === 'pending') || null;
  }

  /**
   * Mark a task complete and record its result.
   * Automatically marks the goal 'completed' if all tasks are done.
   */
  completeTask(goalId, taskId, result = {}) {
    const goal = this.getGoal(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);

    const task = goal.tasks.find(t => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found in goal ${goalId}`);

    task.status = 'completed';
    task.completedAt = new Date().toISOString();
    task.result = result;
    goal.completedTasks.push(taskId);
    goal.updatedAt = new Date().toISOString();

    const allDone = goal.tasks.every(t => t.status === 'completed');
    if (allDone) {
      goal.status = 'completed';
      goal.completedAt = new Date().toISOString();
    }

    this._save();
    return goal;
  }

  failTask(goalId, taskId, reason) {
    const goal = this.getGoal(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);
    const task = goal.tasks.find(t => t.id === taskId);
    if (!task) throw new Error(`Task ${taskId} not found`);

    task.status = 'failed';
    task.failedAt = new Date().toISOString();
    task.failReason = reason;
    goal.status = 'blocked';
    goal.updatedAt = new Date().toISOString();
    goal.notes.push(`Blocked at task "${task.description}": ${reason}`);
    this._save();
    return goal;
  }

  addNote(goalId, note) {
    const goal = this.getGoal(goalId);
    if (!goal) throw new Error(`Goal ${goalId} not found`);
    goal.notes.push({ text: note, at: new Date().toISOString() });
    goal.updatedAt = new Date().toISOString();
    this._save();
  }

  archiveCompleted() {
    const before = this.goals.length;
    this.goals = this.goals.filter(g => g.status !== 'completed');
    this._save();
    return before - this.goals.length;
  }

  // ─── Summary ──────────────────────────────────────────────────────────────

  getSummary() {
    const active = this.goals.filter(g => g.status === 'active');
    const blocked = this.goals.filter(g => g.status === 'blocked');
    const completed = this.goals.filter(g => g.status === 'completed');

    if (!active.length && !blocked.length) {
      return 'No active goals. Give me an objective and I\'ll break it down.';
    }

    const lines = [];
    for (const g of active) {
      const done = g.tasks.filter(t => t.status === 'completed').length;
      const total = g.tasks.length;
      const next = this.nextTask(g.id);
      lines.push(`[${g.id}] ${g.objective} (${done}/${total} tasks, next: ${next?.description ?? 'all done'})`);
    }
    for (const g of blocked) {
      lines.push(`[${g.id}] BLOCKED: ${g.objective} — ${g.notes.at(-1)?.text ?? 'unknown reason'}`);
    }
    if (completed.length) {
      lines.push(`${completed.length} goal(s) completed.`);
    }
    return lines.join('\n');
  }

  // ─── Internals ────────────────────────────────────────────────────────────

  async _decompose(objective) {
    let rawTasks = [];

    if (this.brain) {
      try {
        const prompt = `Break the following objective into 3 to 7 concrete, sequential, actionable tasks.
Return ONLY a JSON array of strings — no explanations, no markdown.
Objective: "${objective}"`;
        const result = await this.brain.generate(prompt, { maxTokens: 400, temperature: 0.3 });
        const match = result.text?.match(/\[[\s\S]*?\]/);
        if (match) {
          rawTasks = JSON.parse(match[0]);
        }
      } catch (_) {
        // fall through to default decomposition
      }
    }

    if (!rawTasks.length) {
      rawTasks = [`Plan approach for: ${objective}`, `Execute: ${objective}`, `Verify completion of: ${objective}`];
    }

    return rawTasks.map((description, i) => ({
      id: `task_${i + 1}`,
      description: String(description),
      status: 'pending',
      createdAt: new Date().toISOString(),
      completedAt: null,
      result: null,
    }));
  }

  _ensureDir() {
    const dir = path.dirname(this.storePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  }

  _load() {
    try {
      if (fs.existsSync(this.storePath)) {
        this.goals = JSON.parse(fs.readFileSync(this.storePath, 'utf8'));
      }
    } catch (_) {
      this.goals = [];
    }
  }

  _save() {
    try {
      fs.writeFileSync(this.storePath, JSON.stringify(this.goals, null, 2), 'utf8');
    } catch (err) {
      console.error('[HeidiGoals] Failed to save goals:', err.message);
    }
  }
}

module.exports = HeidiGoalEngine;
