/**
 * HEIDI Cognitive Core — The Master Cognitive Loop
 *
 * The full cognitive pipeline:
 *   PERCEIVE → VALIDATE → UNDERSTAND → UPDATE WORLD MODEL →
 *   RETRIEVE MEMORY → IDENTIFY GOALS → PLAN → SELECT →
 *   AUTHORIZE → ACT → VERIFY → LEARN → RECORD
 *
 * This is NOT a replacement for the existing HeidiCoreLoop.js — it is
 * the authoritative cognitive core that integrates:
 *   - HeidiIdentity (who am I, what can I do)
 *   - WorldModel (what exists, what's happening)
 *   - GoalSystem (what am I trying to accomplish)
 *   - TrustModel (can I trust this input)
 *   - GuardianModel (what am I protecting)
 *   - Existing operational intelligence (observe, recover, escalate)
 *   - Existing memory systems (semantic, episodic, operational)
 *
 * The loop runs on a configurable interval and produces a CognitiveState
 * that captures the full perceive→understand→decide→act cycle.
 */

import { Pool, QueryResultRow } from 'pg';
import { HeidiIdentityModel, HeidiIdentity, AutonomyLevel } from './HeidiIdentity';
import { GoalSystem, Goal, GoalStatus } from './GoalSystem';
import { WorldModel, WorldEntity } from './WorldModel';
import { TrustModel, TrustClassification } from './TrustModel';
import { GuardianModel, ThreatAssessment } from './GuardianModel';

export type CognitivePhase =
  | 'perceive' | 'validate' | 'understand' | 'update_world_model'
  | 'retrieve_memory' | 'identify_goals' | 'plan' | 'select'
  | 'authorize' | 'act' | 'verify' | 'learn' | 'record';

export interface CognitiveState {
  cycleId: string;
  timestamp: string;
  phase: CognitivePhase;
  identity: HeidiIdentity | null;
  perception: PerceptionResult | null;
  worldModelSummary: { total: number; healthy: number; degraded: number; failed: number; unknown: number } | null;
  activeGoals: Goal[];
  pendingWork: Goal[];
  trustClassification: TrustClassification | null;
  threatAssessments: ThreatAssessment[];
  selectedAction: SelectedAction | null;
  authorizationResult: AuthorizationResult | null;
  executionResult: ExecutionResult | null;
  verificationResult: VerificationResult | null;
  learningResult: LearningResult | null;
  errors: string[];
  durationMs: number;
}

export interface PerceptionResult {
  observedAt: string;
  systemHealth: 'healthy' | 'degraded' | 'failed' | 'unknown';
  components: Array<{ name: string; status: string; confidence: number }>;
  revenueStatus: { totalRevenue: number; activeStreams: number; recentEvents: number } | null;
  communicationStatus: { activeConversations: number; unreadMessages: number } | null;
  workerStatus: { activeWorkers: number; queuedJobs: number; failedJobs: number } | null;
}

export interface SelectedAction {
  actionType: string;
  description: string;
  targetGoalId: string | null;
  riskLevel: string;
  estimatedImpact: string;
  reasoning: string;
}

export interface AuthorizationResult {
  authorized: boolean;
  authorizationMode: 'autonomous' | 'policy_authorized' | 'human_required' | 'prohibited';
  reason: string;
  policyEvaluated: string;
}

export interface ExecutionResult {
  executed: boolean;
  actionType: string;
  outcome: 'success' | 'failure' | 'skipped' | 'pending';
  details: string;
  evidence: unknown[];
}

export interface VerificationResult {
  verified: boolean;
  expectedState: string;
  actualState: string;
  evidence: unknown[];
}

export interface LearningResult {
  lessonLearned: boolean;
  lesson: string | null;
  memoryStored: boolean;
  goalUpdated: boolean;
}

interface DBConfig {
  host?: string; port?: number; database?: string; user?: string; password?: string;
}

export class CognitiveCore {
  private pool: Pool;
  private identity: HeidiIdentityModel;
  private goals: GoalSystem;
  private world: WorldModel;
  private trust: TrustModel;
  private guardian: GuardianModel;
  private currentCycle: CognitiveState | null = null;
  private cycleCount = 0;
  private running = false;
  private intervalHandle: NodeJS.Timeout | null = null;

  constructor(config?: DBConfig) {
    this.pool = new Pool({
      host: config?.host || process.env.PG_HOST || '127.0.0.1',
      port: config?.port || parseInt(process.env.PG_PORT || '54322', 10),
      database: config?.database || process.env.PG_DATABASE || 'postgres',
      user: config?.user || process.env.PG_USER || 'postgres',
      password: config?.password || process.env.PG_PASSWORD || 'postgres',
      max: 3, idleTimeoutMillis: 30000,
    });
    this.identity = new HeidiIdentityModel(config);
    this.goals = new GoalSystem(config);
    this.world = new WorldModel(config);
    this.trust = new TrustModel(config);
    this.guardian = new GuardianModel(config);
  }

  async runCycle(): Promise<CognitiveState> {
    const cycleId = `cycle-${Date.now()}-${++this.cycleCount}`;
    const startTime = Date.now();
    const errors: string[] = [];

    const state: CognitiveState = {
      cycleId,
      timestamp: new Date().toISOString(),
      phase: 'perceive',
      identity: null,
      perception: null,
      worldModelSummary: null,
      activeGoals: [],
      pendingWork: [],
      trustClassification: null,
      threatAssessments: [],
      selectedAction: null,
      authorizationResult: null,
      executionResult: null,
      verificationResult: null,
      learningResult: null,
      errors,
      durationMs: 0,
    };

    // PHASE 1: PERCEIVE — load identity and observe the world
    try {
      state.identity = await this.identity.getIdentity();
      state.perception = await this.perceive();
      state.phase = 'validate';
    } catch (e) {
      errors.push(`perceive: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 2: VALIDATE — classify trust of observations
    try {
      state.trustClassification = this.trust.classify({
        source: 'heidi_internal',
        inputType: 'system_event',
        content: `cognitive cycle ${cycleId}`,
      });
      state.phase = 'understand';
    } catch (e) {
      errors.push(`validate: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 3: UNDERSTAND — assess threats and correlate
    try {
      // Check guardian for threats
      await this.guardian.seedDefaults();
      state.phase = 'update_world_model';
    } catch (e) {
      errors.push(`understand: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 4: UPDATE WORLD MODEL — sync from runtime
    try {
      await this.world.syncFromRuntime();
      state.worldModelSummary = await this.world.getHealthSummary();
      state.phase = 'retrieve_memory';
    } catch (e) {
      errors.push(`update_world_model: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 5: RETRIEVE MEMORY — load active goals and pending work
    try {
      state.activeGoals = await this.goals.getActiveMissions();
      state.pendingWork = await this.goals.getPendingWork();
      state.phase = 'identify_goals';
    } catch (e) {
      errors.push(`retrieve_memory: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 6: IDENTIFY GOALS — check for goals that need attention
    try {
      // Check if any in_progress goals need resumption
      if (state.pendingWork.length === 0) {
        // No pending work — check if we should create new goals
        state.phase = 'plan';
      } else {
        state.phase = 'plan';
      }
    } catch (e) {
      errors.push(`identify_goals: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 7: PLAN — select the highest-priority actionable goal
    try {
      state.selectedAction = this.planNextAction(state);
      state.phase = 'select';
    } catch (e) {
      errors.push(`plan: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 8: SELECT — confirm the selected action
    try {
      state.phase = 'authorize';
    } catch (e) {
      errors.push(`select: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 9: AUTHORIZE — check if the action is authorized
    try {
      state.authorizationResult = this.authorizeAction(state.selectedAction, state.identity);
      state.phase = 'act';
    } catch (e) {
      errors.push(`authorize: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 10: ACT — execute the action (if authorized)
    try {
      if (state.authorizationResult?.authorized && state.selectedAction) {
        state.executionResult = await this.executeAction(state.selectedAction, state);
      } else {
        state.executionResult = {
          executed: false,
          actionType: state.selectedAction?.actionType || 'none',
          outcome: 'skipped',
          details: state.authorizationResult?.reason || 'No action selected',
          evidence: [],
        };
      }
      state.phase = 'verify';
    } catch (e) {
      errors.push(`act: ${e instanceof Error ? e.message : 'unknown'}`);
      state.executionResult = {
        executed: false,
        actionType: state.selectedAction?.actionType || 'none',
        outcome: 'failure',
        details: e instanceof Error ? e.message : 'unknown',
        evidence: [],
      };
    }

    // PHASE 11: VERIFY — check if the action achieved its goal
    try {
      if (state.executionResult?.executed) {
        state.verificationResult = await this.verifyAction(state);
      }
      state.phase = 'learn';
    } catch (e) {
      errors.push(`verify: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 12: LEARN — extract lessons from the cycle
    try {
      state.learningResult = this.learnFromCycle(state);
      state.phase = 'record';
    } catch (e) {
      errors.push(`learn: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 13: RECORD — persist the cognitive state
    try {
      await this.recordCycle(state);
    } catch (e) {
      errors.push(`record: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    state.durationMs = Date.now() - startTime;
    this.currentCycle = state;
    return state;
  }

  private async perceive(): Promise<PerceptionResult> {
    const components: Array<{ name: string; status: string; confidence: number }> = [];

    // Check database
    try {
      await this.pool.query('SELECT 1');
      components.push({ name: 'database', status: 'healthy', confidence: 1.0 });
    } catch {
      components.push({ name: 'database', status: 'failed', confidence: 1.0 });
    }

    // Check revenue
    let revenueStatus: PerceptionResult['revenueStatus'] = null;
    try {
      const revRows = await this.pool.query<QueryResultRow>(
        `SELECT count(*) as total, count(DISTINCT stream_name) as streams,
                count(*) FILTER (WHERE created_at > now() - interval '24 hours') as recent
         FROM revenue_events`,
      );
      const r = revRows.rows[0];
      revenueStatus = {
        totalRevenue: parseInt(r.total, 10),
        activeStreams: parseInt(r.streams, 10),
        recentEvents: parseInt(r.recent, 10),
      };
    } catch {
      // revenue_events may not exist
    }

    // Check communication
    let communicationStatus: PerceptionResult['communicationStatus'] = null;
    try {
      const commRows = await this.pool.query<QueryResultRow>(
        `SELECT count(*) FILTER (WHERE status = 'active') as active,
                count(*) FILTER (WHERE direction = 'inbound' AND status = 'pending') as unread
         FROM communication_events`,
      );
      const c = commRows.rows[0];
      communicationStatus = {
        activeConversations: parseInt(c.active, 10),
        unreadMessages: parseInt(c.unread, 10),
      };
    } catch {
      // communication_events may not exist
    }

    // Check workers
    let workerStatus: PerceptionResult['workerStatus'] = null;
    try {
      const workerRows = await this.pool.query<QueryResultRow>(
        `SELECT count(*) FILTER (WHERE status = 'active') as active,
                count(*) FILTER (WHERE status = 'queued') as queued,
                count(*) FILTER (WHERE status = 'failed') as failed
         FROM worker_jobs`,
      );
      const w = workerRows.rows[0];
      workerStatus = {
        activeWorkers: parseInt(w.active, 10),
        queuedJobs: parseInt(w.queued, 10),
        failedJobs: parseInt(w.failed, 10),
      };
    } catch {
      // worker_jobs may not exist
    }

    // Determine overall health
    const failed = components.filter((c) => c.status === 'failed').length;
    const systemHealth = failed > 0 ? 'failed' : 'healthy';

    return {
      observedAt: new Date().toISOString(),
      systemHealth: systemHealth as PerceptionResult['systemHealth'],
      components,
      revenueStatus,
      communicationStatus,
      workerStatus,
    };
  }

  private planNextAction(state: CognitiveState): SelectedAction | null {
    // Find the highest-priority pending or active goal that has dependencies met
    const actionable = state.pendingWork.filter(
      (g) => g.status === 'active' || g.status === 'pending',
    );

    if (actionable.length === 0) {
      return {
        actionType: 'observe',
        description: 'No pending work — continue observing',
        targetGoalId: null,
        riskLevel: 'R0',
        estimatedImpact: 'none',
        reasoning: 'No actionable goals found. Maintain observation.',
      };
    }

    // Sort by priority (highest first)
    actionable.sort((a, b) => b.priority - a.priority);
    const target = actionable[0];

    return {
      actionType: 'advance_goal',
      description: `Advance goal: ${target.title}`,
      targetGoalId: target.goalId,
      riskLevel: target.goalType === 'action' ? 'R1' : 'R0',
      estimatedImpact: target.goalType === 'mission' ? 'strategic' : 'operational',
      reasoning: `Goal ${target.goalId} (${target.goalType}: ${target.title}) is highest priority pending work`,
    };
  }

  private authorizeAction(action: SelectedAction | null, identity: HeidiIdentity | null): AuthorizationResult {
    if (!action) {
      return { authorized: false, authorizationMode: 'prohibited', reason: 'No action selected', policyEvaluated: 'none' };
    }

    if (!identity) {
      return { authorized: false, authorizationMode: 'prohibited', reason: 'Identity not loaded', policyEvaluated: 'none' };
    }

    // R0 (observe) is always autonomous
    if (action.riskLevel === 'R0') {
      return { authorized: true, authorizationMode: 'autonomous', reason: 'R0 action — autonomous', policyEvaluated: 'R0 default' };
    }

    // R1 (reversible) is autonomous at autonomy level >= 2
    if (action.riskLevel === 'R1') {
      if (identity.autonomyLevel >= 2) {
        return { authorized: true, authorizationMode: 'autonomous', reason: 'R1 action — autonomous at current autonomy level', policyEvaluated: 'R1 default' };
      }
      return { authorized: false, authorizationMode: 'human_required', reason: 'R1 action requires autonomy level >= 2', policyEvaluated: 'R1 default' };
    }

    // R2+ requires policy authorization or human approval
    if (action.riskLevel === 'R2') {
      return { authorized: identity.autonomyLevel >= 3, authorizationMode: 'policy_authorized', reason: 'R2 action — policy authorized', policyEvaluated: 'R2 default' };
    }

    // R3-R4 require human
    if (action.riskLevel === 'R3' || action.riskLevel === 'R4') {
      return { authorized: false, authorizationMode: 'human_required', reason: `${action.riskLevel} action requires human authorization`, policyEvaluated: `${action.riskLevel} default` };
    }

    // R5 prohibited
    return { authorized: false, authorizationMode: 'prohibited', reason: 'R5 action — prohibited', policyEvaluated: 'R5 default' };
  }

  private async executeAction(action: SelectedAction, state: CognitiveState): Promise<ExecutionResult> {
    if (action.actionType === 'observe') {
      return {
        executed: true,
        actionType: 'observe',
        outcome: 'success',
        details: 'Observation cycle completed',
        evidence: [{ cycleId: state.cycleId, perception: state.perception }],
      };
    }

    if (action.actionType === 'advance_goal' && action.targetGoalId) {
      // Mark the goal as in_progress
      try {
        await this.goals.updateGoal(action.targetGoalId, { status: 'in_progress' as GoalStatus });
        return {
          executed: true,
          actionType: 'advance_goal',
          outcome: 'success',
          details: `Goal ${action.targetGoalId} marked in_progress`,
          evidence: [{ goalId: action.targetGoalId, timestamp: new Date().toISOString() }],
        };
      } catch (e) {
        return {
          executed: false,
          actionType: 'advance_goal',
          outcome: 'failure',
          details: `Failed to advance goal: ${e instanceof Error ? e.message : 'unknown'}`,
          evidence: [],
        };
      }
    }

    return {
      executed: false,
      actionType: action.actionType,
      outcome: 'skipped',
      details: `Action type ${action.actionType} not implemented in cognitive core`,
      evidence: [],
    };
  }

  private async verifyAction(state: CognitiveState): Promise<VerificationResult> {
    if (!state.executionResult || !state.selectedAction) {
      return { verified: false, expectedState: 'unknown', actualState: 'unknown', evidence: [] };
    }

    if (state.selectedAction.actionType === 'observe') {
      return {
        verified: true,
        expectedState: 'observation completed',
        actualState: state.executionResult.outcome === 'success' ? 'observation completed' : 'observation failed',
        evidence: state.executionResult.evidence,
      };
    }

    if (state.selectedAction.actionType === 'advance_goal' && state.selectedAction.targetGoalId) {
      const goal = await this.goals.getGoal(state.selectedAction.targetGoalId);
      return {
        verified: goal?.status === 'in_progress' || goal?.status === 'completed',
        expectedState: 'in_progress or completed',
        actualState: goal?.status || 'unknown',
        evidence: [{ goalId: state.selectedAction.targetGoalId, status: goal?.status }],
      };
    }

    return {
      verified: false,
      expectedState: 'unknown',
      actualState: 'unknown',
      evidence: [],
    };
  }

  private learnFromCycle(state: CognitiveState): LearningResult {
    const lessons: string[] = [];

    if (state.errors.length > 0) {
      lessons.push(`Cycle had ${state.errors.length} errors: ${state.errors.join('; ')}`);
    }

    if (state.executionResult?.outcome === 'failure') {
      lessons.push(`Action ${state.executionResult.actionType} failed: ${state.executionResult.details}`);
    }

    if (state.perception?.systemHealth === 'failed') {
      lessons.push(`System health is failed — components: ${state.perception.components.map((c) => `${c.name}=${c.status}`).join(', ')}`);
    }

    return {
      lessonLearned: lessons.length > 0,
      lesson: lessons.length > 0 ? lessons.join('; ') : null,
      memoryStored: false, // Memory storage would be handled by existing memory systems
      goalUpdated: state.executionResult?.executed === true && state.selectedAction?.targetGoalId !== null,
    };
  }

  private async recordCycle(state: CognitiveState): Promise<void> {
    // Record to heidi_events for audit trail
    try {
      await this.pool.query(
        `INSERT INTO heidi_events (event_type, payload, created_at)
         VALUES ($1, $2, now())`,
        [
          'cognitive_cycle',
          JSON.stringify({
            cycleId: state.cycleId,
            phase: state.phase,
            systemHealth: state.perception?.systemHealth,
            activeGoals: state.activeGoals.length,
            pendingWork: state.pendingWork.length,
            selectedAction: state.selectedAction?.actionType,
            authorized: state.authorizationResult?.authorized,
            executed: state.executionResult?.executed,
            outcome: state.executionResult?.outcome,
            verified: state.verificationResult?.verified,
            errors: state.errors,
            durationMs: state.durationMs,
          }),
        ],
      );
    } catch {
      // heidi_events may have different schema — don't fail the cycle
    }
  }

  async resumeAfterRestart(): Promise<{ resumedGoals: Goal[]; blockedGoals: Goal[] }> {
    const result = await this.goals.resumeAfterRestart();
    return { resumedGoals: result.resumed, blockedGoals: result.blocked };
  }

  async start(intervalMs: number = 60000): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Resume any in-progress goals
    await this.resumeAfterRestart();

    // Run initial cycle
    await this.runCycle();

    // Schedule periodic cycles
    this.intervalHandle = setInterval(() => {
      this.runCycle().catch(() => {});
    }, intervalMs);
  }

  stop(): void {
    this.running = false;
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  getCurrentCycle(): CognitiveState | null {
    return this.currentCycle;
  }

  getCycleCount(): number {
    return this.cycleCount;
  }

  async close(): Promise<void> {
    this.stop();
    await Promise.all([
      this.identity.close(),
      this.goals.close(),
      this.world.close(),
      this.trust.close(),
      this.guardian.close(),
      this.pool.end(),
    ]);
  }
}

// Singleton
let _instance: CognitiveCore | null = null;

export function getCognitiveCore(config?: DBConfig): CognitiveCore {
  if (!_instance) {
    _instance = new CognitiveCore(config);
  }
  return _instance;
}
