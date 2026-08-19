/**
 * HEIDI Hierarchical Goal System
 *
 * Persistent, hierarchical goals: MISSION → OBJECTIVE → PROJECT → TASK → SUBTASK → ACTION
 *
 * Goals survive process restarts. HEIDI can resume unfinished work.
 * Each goal has: purpose, priority, constraints, dependencies, success criteria,
 * owner, deadline, status, progress, confidence, evidence.
 *
 * Goals are linked to the existing autonomy policy — high-risk goals require
 * human authorization, low-risk goals can be autonomously executed.
 */

import { Pool, QueryResultRow } from 'pg';

export type GoalType = 'mission' | 'objective' | 'project' | 'task' | 'subtask' | 'action';
export type GoalStatus = 'pending' | 'active' | 'in_progress' | 'blocked' | 'completed' | 'cancelled' | 'failed' | 'escalated';

export interface Goal {
  goalId: string;
  parentId: string | null;
  goalType: GoalType;
  title: string;
  description: string | null;
  purpose: string | null;
  priority: number;
  status: GoalStatus;
  constraints: unknown[];
  dependencies: string[];
  successCriteria: unknown[];
  owner: string;
  deadline: string | null;
  progress: number;
  confidence: number;
  evidence: unknown[];
  assignedAgent: string | null;
  context: Record<string, unknown>;
  result: string | null;
  createdAt: string;
  updatedAt: string;
  startedAt: string | null;
  completedAt: string | null;
}

export interface GoalCreateInput {
  parentId?: string | null;
  goalType: GoalType;
  title: string;
  description?: string;
  purpose?: string;
  priority?: number;
  constraints?: unknown[];
  dependencies?: string[];
  successCriteria?: unknown[];
  owner?: string;
  deadline?: string;
  assignedAgent?: string;
  context?: Record<string, unknown>;
}

export interface GoalUpdateInput {
  status?: GoalStatus;
  progress?: number;
  confidence?: number;
  result?: string;
  evidence?: unknown[];
  assignedAgent?: string;
  context?: Record<string, unknown>;
}

interface DBConfig {
  host?: string; port?: number; database?: string; user?: string; password?: string;
}

const HIERARCHY: GoalType[] = ['mission', 'objective', 'project', 'task', 'subtask', 'action'];

export class GoalSystem {
  private pool: Pool;

  constructor(config?: DBConfig) {
    this.pool = new Pool({
      host: config?.host || process.env.PG_HOST || '127.0.0.1',
      port: config?.port || parseInt(process.env.PG_PORT || '54322', 10),
      database: config?.database || process.env.PG_DATABASE || 'postgres',
      user: config?.user || process.env.PG_USER || 'postgres',
      password: config?.password || process.env.PG_PASSWORD || 'postgres',
      max: 5, idleTimeoutMillis: 30000,
    });
  }

  async createGoal(input: GoalCreateInput): Promise<Goal> {
    // Validate hierarchy: parent must be a higher-level goal type
    if (input.parentId) {
      const parent = await this.getGoal(input.parentId);
      if (!parent) throw new Error(`Parent goal ${input.parentId} not found`);
      const parentIdx = HIERARCHY.indexOf(parent.goalType);
    const childIdx = HIERARCHY.indexOf(input.goalType);
      if (childIdx <= parentIdx) {
        throw new Error(`Goal type ${input.goalType} cannot be child of ${parent.goalType} — must be lower in hierarchy`);
      }
    } else if (input.goalType !== 'mission') {
      throw new Error(`Top-level goals must be type 'mission', got '${input.goalType}'`);
    }

    const row = await this.queryOne<QueryResultRow>(
      `INSERT INTO heidi_goals
         (parent_id, goal_type, title, description, purpose, priority, constraints,
          dependencies, success_criteria, owner, deadline, assigned_agent, context)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
       RETURNING *`,
      [
        input.parentId || null,
        input.goalType,
        input.title,
        input.description || null,
        input.purpose || null,
        input.priority || 5,
        JSON.stringify(input.constraints || []),
        JSON.stringify(input.dependencies || []),
        JSON.stringify(input.successCriteria || []),
        input.owner || 'heidi',
        input.deadline || null,
        input.assignedAgent || null,
        JSON.stringify(input.context || {}),
      ],
    );
    if (!row) throw new Error('Goal insert returned no row');
    return this.mapGoal(row);
  }

  async getGoal(goalId: string): Promise<Goal | null> {
    const row = await this.queryOne<QueryResultRow>(
      `SELECT * FROM heidi_goals WHERE id = $1`,
      [goalId],
    );
    return row ? this.mapGoal(row) : null;
  }

  async getChildren(parentId: string): Promise<Goal[]> {
    const rows = await this.pool.query<QueryResultRow>(
      `SELECT * FROM heidi_goals WHERE parent_id = $1 ORDER BY priority DESC, created_at ASC`,
      [parentId],
    );
    return rows.rows.map((r) => this.mapGoal(r));
  }

  async getGoalTree(rootId: string): Promise<{ goal: Goal; children: GoalTree[] }> {
    const goal = await this.getGoal(rootId);
    if (!goal) throw new Error(`Goal ${rootId} not found`);
    const children = await this.getChildren(rootId);
    const childTrees: GoalTree[] = [];
    for (const child of children) {
      childTrees.push(await this.getGoalTree(child.goalId));
    }
    return { goal, children: childTrees };
  }

  async listGoals(filter: {
    goalType?: GoalType;
    status?: GoalStatus;
    owner?: string;
    assignedAgent?: string;
    limit?: number;
  }): Promise<Goal[]> {
    const conditions: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (filter.goalType) { conditions.push(`goal_type = $${idx++}`); params.push(filter.goalType); }
    if (filter.status) { conditions.push(`status = $${idx++}`); params.push(filter.status); }
    if (filter.owner) { conditions.push(`owner = $${idx++}`); params.push(filter.owner); }
    if (filter.assignedAgent) { conditions.push(`assigned_agent = $${idx++}`); params.push(filter.assignedAgent); }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filter.limit || 100;
    params.push(limit);

    const rows = await this.pool.query<QueryResultRow>(
      `SELECT * FROM heidi_goals ${where} ORDER BY priority DESC, created_at ASC LIMIT $${idx}`,
      params,
    );
    return rows.rows.map((r) => this.mapGoal(r));
  }

  async updateGoal(goalId: string, updates: GoalUpdateInput): Promise<Goal | null> {
    const sets: string[] = [];
    const params: unknown[] = [];
    let idx = 1;

    if (updates.status !== undefined) {
      sets.push(`status = $${idx++}`);
      params.push(updates.status);
      if (updates.status === 'in_progress' || updates.status === 'active') {
        sets.push(`started_at = COALESCE(started_at, now())`);
      }
      if (updates.status === 'completed' || updates.status === 'failed' || updates.status === 'cancelled') {
        sets.push(`completed_at = now()`);
      }
    }
    if (updates.progress !== undefined) { sets.push(`progress = $${idx++}`); params.push(updates.progress); }
    if (updates.confidence !== undefined) { sets.push(`confidence = $${idx++}`); params.push(updates.confidence); }
    if (updates.result !== undefined) { sets.push(`result = $${idx++}`); params.push(updates.result); }
    if (updates.assignedAgent !== undefined) { sets.push(`assigned_agent = $${idx++}`); params.push(updates.assignedAgent); }
    if (updates.context !== undefined) { sets.push(`context = $${idx++}`); params.push(JSON.stringify(updates.context)); }
    if (updates.evidence !== undefined) {
      // Append to existing evidence
      sets.push(`evidence = evidence || $${idx++}::jsonb`);
      params.push(JSON.stringify(updates.evidence));
    }

    if (sets.length === 0) return this.getGoal(goalId);

    params.push(goalId);
    const row = await this.queryOne<QueryResultRow>(
      `UPDATE heidi_goals SET ${sets.join(', ')} WHERE id = $${idx} RETURNING *`,
      params,
    );
    return row ? this.mapGoal(row) : null;
  }

  async addEvidence(goalId: string, evidence: unknown): Promise<Goal | null> {
    return this.updateGoal(goalId, { evidence: [evidence] });
  }

  async getActiveMissions(): Promise<Goal[]> {
    return this.listGoals({ goalType: 'mission', status: 'active', limit: 50 });
  }

  async getPendingWork(): Promise<Goal[]> {
    // Get all goals that are pending or in_progress, ordered by priority
    const rows = await this.pool.query<QueryResultRow>(
      `SELECT * FROM heidi_goals
       WHERE status IN ('pending', 'active', 'in_progress', 'blocked')
       ORDER BY priority DESC, created_at ASC
       LIMIT 100`,
    );
    return rows.rows.map((r) => this.mapGoal(r));
  }

  async resumeAfterRestart(): Promise<{ resumed: Goal[]; blocked: Goal[] }> {
    // Find goals that were in_progress when the process died
    const rows = await this.pool.query<QueryResultRow>(
      `SELECT * FROM heidi_goals
       WHERE status = 'in_progress'
       ORDER BY priority DESC, created_at ASC`,
    );
    const inProgress = rows.rows.map((r) => this.mapGoal(r));

    const resumed: Goal[] = [];
    const blocked: Goal[] = [];

    for (const goal of inProgress) {
      // Check if dependencies are met
      const depsMet = await this.checkDependencies(goal);
      if (depsMet) {
        // Reset to active so the cognitive loop can pick it up
        await this.updateGoal(goal.goalId, { status: 'active' });
        resumed.push({ ...goal, status: 'active' });
      } else {
        await this.updateGoal(goal.goalId, { status: 'blocked' });
        blocked.push({ ...goal, status: 'blocked' });
      }
    }

    return { resumed, blocked };
  }

  async checkDependencies(goal: Goal): Promise<boolean> {
    if (!goal.dependencies || goal.dependencies.length === 0) return true;
    for (const depId of goal.dependencies) {
      const dep = await this.getGoal(depId);
      if (!dep || dep.status !== 'completed') return false;
    }
    return true;
  }

  async computeProgress(parentId: string): Promise<number> {
    const children = await this.getChildren(parentId);
    if (children.length === 0) return 0;
    const completed = children.filter((c) => c.status === 'completed').length;
    return completed / children.length;
  }

  async propagateCompletion(parentId: string): Promise<void> {
    const children = await this.getChildren(parentId);
    if (children.length === 0) return;
    const allCompleted = children.every((c) => c.status === 'completed');
    if (allCompleted) {
      await this.updateGoal(parentId, { status: 'completed', progress: 1.0, result: 'All sub-goals completed' });
      // Propagate upward
      const parent = await this.getGoal(parentId);
      if (parent?.parentId) {
        await this.propagateCompletion(parent.parentId);
      }
    } else {
      const progress = await this.computeProgress(parentId);
      await this.updateGoal(parentId, { progress });
    }
  }

  private mapGoal(row: QueryResultRow): Goal {
    return {
      goalId: row.id,
      parentId: row.parent_id,
      goalType: row.goal_type as GoalType,
      title: row.title,
      description: row.description,
      purpose: row.purpose,
      priority: row.priority,
      status: row.status as GoalStatus,
      constraints: row.constraints || [],
      dependencies: row.dependencies || [],
      successCriteria: row.success_criteria || [],
      owner: row.owner,
      deadline: row.deadline,
      progress: parseFloat(row.progress) || 0,
      confidence: parseFloat(row.confidence) || 0.5,
      evidence: row.evidence || [],
      assignedAgent: row.assigned_agent,
      context: row.context || {},
      result: row.result,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      startedAt: row.started_at,
      completedAt: row.completed_at,
    };
  }

  private async queryOne<T extends QueryResultRow>(text: string, params?: unknown[]): Promise<T | null> {
    const result = await this.pool.query<T>(text, params as never[]);
    return result.rows.length > 0 ? result.rows[0] : null;
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}

type GoalTree = { goal: Goal; children: GoalTree[] };

// Singleton
let _instance: GoalSystem | null = null;

export function getGoalSystem(config?: DBConfig): GoalSystem {
  if (!_instance) {
    _instance = new GoalSystem(config);
  }
  return _instance;
}
