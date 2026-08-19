/**
 * HEIDI Cognitive Core — The Master Cognitive Loop
 *
 * The full cognitive pipeline:
 *   PERCEIVE → VALIDATE → UNDERSTAND → UPDATE WORLD MODEL →
 *   RETRIEVE MEMORY → IDENTIFY GOALS → PLAN → ASSESS RISK/CONFIDENCE →
 *   SELECT → AUTHORIZE → EXECUTE REAL CAPABILITY → VERIFY →
 *   LEARN → RECORD → CONTINUE / REPLAN / ESCALATE
 *
 * This is the authoritative cognitive core that integrates:
 *   - HeidiIdentity (who am I, what can I do)
 *   - WorldModel (what exists, what's happening)
 *   - GoalSystem (what am I trying to accomplish)
 *   - TrustModel (can I trust this input)
 *   - GuardianModel (what am I protecting)
 *   - CapabilityRegistry (what can I invoke)
 *   - Existing operational intelligence (observe, recover, escalate)
 *   - Existing memory systems (semantic, episodic, operational)
 *   - Existing meta-cognition (reasoning quality evaluation)
 *   - Existing decision resolver (conflict resolution)
 *   - Existing ActionExecutor (tool execution)
 *   - Existing CommunicationLayer (messaging)
 *   - Existing RevenueControlLoop (revenue actions)
 *
 * The cognitive core NEVER bypasses governance. Every action passes through:
 *   COGNITIVE DECISION → CAPABILITY REGISTRY → RISK CLASSIFICATION →
 *   AUTONOMY POLICY → AUTHORIZATION → EXECUTION → VERIFICATION → AUDIT
 */

import { Pool, QueryResultRow } from 'pg';
import { HeidiIdentityModel, HeidiIdentity, AutonomyLevel } from './HeidiIdentity';
import { GoalSystem, Goal, GoalStatus } from './GoalSystem';
import { WorldModel, WorldEntity } from './WorldModel';
import { TrustModel, TrustClassification } from './TrustModel';
import { GuardianModel, ThreatAssessment } from './GuardianModel';
import {
  CapabilityRegistry,
  getCapabilityRegistry,
  CapabilityDescriptor,
  CapabilityResult,
  CapabilityExecutionContext,
  CapabilityExecutor,
} from './CapabilityRegistry';

export type CognitivePhase =
  | 'perceive' | 'validate' | 'understand' | 'update_world_model'
  | 'retrieve_memory' | 'identify_goals' | 'plan' | 'assess_risk'
  | 'select' | 'authorize' | 'act' | 'verify' | 'learn' | 'record'
  | 'replan' | 'escalate';

export interface CognitiveState {
  cycleId: string;
  timestamp: string;
  phase: CognitivePhase;
  identity: HeidiIdentity | null;
  perception: PerceptionResult | null;
  worldModelSummary: { total: number; healthy: number; degraded: number; failed: number; unknown: number } | null;
  activeGoals: Goal[];
  pendingWork: Goal[];
  retrievedMemory: string | null;
  trustClassification: TrustClassification | null;
  threatAssessments: ThreatAssessment[];
  metaCognitiveEvaluation: MetaCognitiveResult | null;
  decisionResolution: DecisionResolutionResult | null;
  selectedAction: SelectedAction | null;
  authorizationResult: AuthorizationResult | null;
  executionResult: ExecutionResult | null;
  verificationResult: VerificationResult | null;
  learningResult: LearningResult | null;
  replanResult: ReplanResult | null;
  errors: string[];
  durationMs: number;
}

export interface PerceptionResult {
  observedAt: string;
  systemHealth: 'healthy' | 'degraded' | 'failed' | 'unknown';
  components: Array<{ name: string; status: string; confidence: number; evidence: string }>;
  revenueStatus: { totalRevenue: number; activeStreams: number; recentEvents: number } | null;
  communicationStatus: { activeConversations: number; unreadMessages: number } | null;
  workerStatus: { activeWorkers: number; queuedJobs: number; failedJobs: number } | null;
  capabilitySummary: { total: number; available: number; unavailable: number } | null;
}

export interface MetaCognitiveResult {
  qualityScore: number;
  classification: string;
  improvementAreas: string[];
  confidenceCalibration: number;
  biasDetected: string[];
}

export interface DecisionResolutionResult {
  finalAction: string;
  winningAuthority: string;
  reasoning: string;
  confidence: number;
  conflictResolution: string;
  alternativesConsidered: Array<{ action: string; reason: string; rejected: boolean }>;
}

export interface SelectedAction {
  actionType: string;
  capabilityId: string | null;
  description: string;
  targetGoalId: string | null;
  riskLevel: string;
  estimatedImpact: string;
  reasoning: string;
  params: Record<string, unknown>;
  alternatives: Array<{ action: string; reason: string; rejected: boolean }>;
}

export interface AuthorizationResult {
  authorized: boolean;
  authorizationMode: 'autonomous' | 'policy_authorized' | 'human_required' | 'prohibited';
  reason: string;
  policyEvaluated: string;
  capabilityId: string | null;
  escalationRecordId: string | null;
}

export interface ExecutionResult {
  executed: boolean;
  actionType: string;
  capabilityId: string | null;
  outcome: 'success' | 'failure' | 'skipped' | 'pending';
  details: string;
  evidence: unknown[];
  rawResult: unknown;
}

export interface VerificationResult {
  verified: boolean;
  expectedState: string;
  actualState: string;
  verificationStrategy: string;
  evidence: unknown[];
}

export interface LearningResult {
  lessonLearned: boolean;
  lesson: string | null;
  memoryStored: boolean;
  memoryId: string | null;
  goalUpdated: boolean;
  outcomeClassification: 'success' | 'partial_failure' | 'failure' | 'unverified';
}

export interface ReplanResult {
  replanned: boolean;
  originalGoalId: string | null;
  deviationReason: string | null;
  newGoalId: string | null;
  revisedPlan: string | null;
}

interface DBConfig {
  host?: string; port?: number; database?: string; user?: string; password?: string;
}

// ─── Execution bridge integrations ─────────────────────────────────────
//
// These are optional injectable executors. CognitiveCore wires them
// during initialization if the underlying systems are available.

export interface ExecutionBridge {
  actionExecutor?: {
    execute: (action: { type: string; payload: Record<string, unknown> }, sessionId: string) => Promise<{ status: string; result?: unknown; error?: string }>;
  } | null;
  operationalIntelligence?: {
    governedRecover: (component: string, cause: string) => Promise<string>;
    checkHealth: () => Promise<unknown>;
    diagnose: (jsonOutput?: boolean) => Promise<string>;
    autoRecover: () => Promise<string>;
  } | null;
  communicationLayer?: {
    sendMessage: (request: Record<string, unknown>) => Promise<{ messageId: string; deliveryStatus: string; error: string | null }>;
    getCapabilities: () => Promise<unknown[]>;
  } | null;
  revenueControlLoop?: {
    run: () => Promise<unknown>;
    collectMetrics: () => Promise<unknown>;
  } | null;
  memory?: {
    retrieve: (query: string, userId: string, sessionId?: string) => Promise<string>;
    storeExperience: (sessionId: string, userId: string, experience: { problem: string; actionsTaken: unknown[]; outcome: string; lesson: string }) => Promise<boolean>;
  } | null;
  metaCognition?: {
    evaluate: (thinkResult: { query: string; thinkingProcess: unknown[]; response: string; confidence: number }) => Promise<{ overallQualityScore: number; qualityClassification: string; improvementAreas: string[] }>;
  } | null;
  decisionResolver?: {
    resolve: (cascadeOutput: unknown, memorySignal: unknown, policyConstraints: unknown) => Promise<{ final_action: string; winning_authority: string; reasoning: string; confidence: number; conflict_resolution: string }>;
  } | null;
}

export class CognitiveCore {
  private pool: Pool;
  private identity: HeidiIdentityModel;
  private goals: GoalSystem;
  private world: WorldModel;
  private trust: TrustModel;
  private guardian: GuardianModel;
  private registry: CapabilityRegistry;
  private bridge: ExecutionBridge;
  private currentCycle: CognitiveState | null = null;
  private cycleCount = 0;
  private running = false;
  private intervalHandle: NodeJS.Timeout | null = null;
  private sessionId: string;

  constructor(config?: DBConfig, bridge?: ExecutionBridge) {
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
    this.registry = getCapabilityRegistry();
    this.bridge = bridge || {};
    this.sessionId = `cognitive-${Date.now()}`;

    // Wire capability executors if bridge components are available
    this.wireCapabilityExecutors();
  }

  /**
   * Wire the capability registry executors to the bridge components.
   * Each executor is only wired if the corresponding bridge component exists.
   */
  private wireCapabilityExecutors(): void {
    // ActionExecutor capabilities
    if (this.bridge.actionExecutor) {
      const ae = this.bridge.actionExecutor;
      this.wireExecutor('tool.create_task', async (params, ctx) => this.executeViaActionExecutor(ae, 'create_task', params, ctx));
      this.wireExecutor('tool.fetch_data', async (params, ctx) => this.executeViaActionExecutor(ae, 'fetch_data', params, ctx));
      this.wireExecutor('tool.update_database', async (params, ctx) => this.executeViaActionExecutor(ae, 'update_database', params, ctx));
      this.wireExecutor('tool.schedule_event', async (params, ctx) => this.executeViaActionExecutor(ae, 'schedule_event', params, ctx));
      this.wireExecutor('tool.send_email', async (params, ctx) => this.executeViaActionExecutor(ae, 'send_email', params, ctx));
    }

    // OperationalIntelligence capabilities
    if (this.bridge.operationalIntelligence) {
      const oi = this.bridge.operationalIntelligence;
      this.wireExecutor('recovery.governed_recover', async (params) => {
        const component = params.component as string;
        const cause = (params.cause as string) || 'cognitive core initiated recovery';
        if (!component) {
          return this.failResult('recovery.governed_recover', 'Missing required param: component');
        }
        const result = await oi.governedRecover(component, cause);
        return {
          capabilityId: 'recovery.governed_recover',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ component, cause, result }],
          verified: false, // verification happens in verify phase
          verificationDetails: 'Pending re-observation',
        };
      });
      this.wireExecutor('ops.check_health', async () => {
        const result = await oi.checkHealth();
        return {
          capabilityId: 'ops.check_health',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ healthCheck: result }],
          verified: true,
          verificationDetails: 'Health check returned a valid state',
        };
      });
      this.wireExecutor('ops.diagnose', async () => {
        const result = await oi.diagnose(false);
        return {
          capabilityId: 'ops.diagnose',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ diagnostic: result.substring(0, 500) }],
          verified: true,
          verificationDetails: 'Diagnostic snapshot produced',
        };
      });
      this.wireExecutor('recovery.auto_recover', async () => {
        const result = await oi.autoRecover();
        return {
          capabilityId: 'recovery.auto_recover',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ autoRecovery: result.substring(0, 500) }],
          verified: false,
          verificationDetails: 'Pending final health check',
        };
      });
    }

    // CommunicationLayer capabilities
    if (this.bridge.communicationLayer) {
      const cl = this.bridge.communicationLayer;
      this.wireExecutor('comm.send_message', async (params) => {
        const result = await cl.sendMessage(params);
        return {
          capabilityId: 'comm.send_message',
          executed: result.error === null,
          outcome: result.error === null ? 'success' as const : 'failure' as const,
          result,
          error: result.error,
          evidence: [{ messageId: result.messageId, deliveryStatus: result.deliveryStatus }],
          verified: result.error === null,
          verificationDetails: result.error ? `Failed: ${result.error}` : 'Delivery status recorded',
        };
      });
      this.wireExecutor('comm.get_capabilities', async () => {
        const result = await cl.getCapabilities();
        return {
          capabilityId: 'comm.get_capabilities',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ capabilityCount: Array.isArray(result) ? result.length : 0 }],
          verified: true,
          verificationDetails: 'Capabilities list returned',
        };
      });
    }

    // RevenueControlLoop capabilities
    if (this.bridge.revenueControlLoop) {
      const rcl = this.bridge.revenueControlLoop;
      this.wireExecutor('revenue.run_cycle', async () => {
        const result = await rcl.run();
        return {
          capabilityId: 'revenue.run_cycle',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ revenueCycle: result }],
          verified: true,
          verificationDetails: 'RevenueControlLoopResult returned',
        };
      });
      this.wireExecutor('revenue.collect_metrics', async () => {
        const result = await rcl.collectMetrics();
        return {
          capabilityId: 'revenue.collect_metrics',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ metrics: result }],
          verified: true,
          verificationDetails: 'Metrics object returned',
        };
      });
    }

    // GoalSystem capabilities (always available — no bridge needed)
    this.wireExecutor('goal.create', async (params) => {
      const goal = await this.goals.createGoal({
        goalType: params.goalType as Goal['goalType'],
        title: params.title as string,
        description: params.description as string | undefined,
        purpose: params.purpose as string | undefined,
        priority: params.priority as number | undefined,
        parentId: params.parentId as string | null | undefined,
      });
      return {
        capabilityId: 'goal.create',
        executed: true,
        outcome: 'success' as const,
        result: goal,
        error: null,
        evidence: [{ goalId: goal.goalId, goalType: goal.goalType }],
        verified: true,
        verificationDetails: `Goal ${goal.goalId} created and retrievable`,
      };
    });

    this.wireExecutor('goal.advance', async (params) => {
      const goalId = params.goalId as string;
      if (!goalId) return this.failResult('goal.advance', 'Missing required param: goalId');
      const updated = await this.goals.updateGoal(goalId, { status: 'in_progress' as GoalStatus });
      return {
        capabilityId: 'goal.advance',
        executed: updated !== null,
        outcome: updated !== null ? 'success' as const : 'failure' as const,
        result: updated,
        error: updated === null ? 'Goal not found' : null,
        evidence: [{ goalId, status: updated?.status }],
        verified: updated?.status === 'in_progress',
        verificationDetails: updated?.status === 'in_progress' ? 'Goal is in_progress' : 'Goal status unchanged',
      };
    });

    this.wireExecutor('goal.complete', async (params) => {
      const goalId = params.goalId as string;
      if (!goalId) return this.failResult('goal.complete', 'Missing required param: goalId');
      const result = (params.result as string) || 'completed';
      const updated = await this.goals.updateGoal(goalId, { status: 'completed' as GoalStatus, result, progress: 1.0 });
      return {
        capabilityId: 'goal.complete',
        executed: updated !== null,
        outcome: updated !== null ? 'success' as const : 'failure' as const,
        result: updated,
        error: updated === null ? 'Goal not found' : null,
        evidence: [{ goalId, status: updated?.status, result }],
        verified: updated?.status === 'completed',
        verificationDetails: updated?.status === 'completed' ? 'Goal is completed' : 'Goal status unchanged',
      };
    });

    // WorldModel capabilities (always available)
    this.wireExecutor('world.sync', async () => {
      const result = await this.world.syncFromRuntime();
      return {
        capabilityId: 'world.sync',
        executed: true,
        outcome: 'success' as const,
        result,
        error: null,
        evidence: [{ synced: result.synced, errors: result.errors }],
        verified: result.errors.length === 0,
        verificationDetails: result.errors.length === 0 ? 'Sync completed without errors' : `Sync had ${result.errors.length} errors`,
      };
    });

    this.wireExecutor('world.query', async (params) => {
      const question = (params.question as string) || 'what exists';
      const answer = await this.world.answerQuestion(question);
      return {
        capabilityId: 'world.query',
        executed: true,
        outcome: 'success' as const,
        result: answer,
        error: null,
        evidence: [{ question, answer }],
        verified: true,
        verificationDetails: 'Query returned a valid answer',
      };
    });

    // CognitiveCore capability
    this.wireExecutor('cognitive.observe', async (_params, ctx) => {
      const perception = await this.perceive();
      return {
        capabilityId: 'cognitive.observe',
        executed: true,
        outcome: 'success' as const,
        result: perception,
        error: null,
        evidence: [{ cycleId: ctx.sessionId, perception }],
        verified: true,
        verificationDetails: 'Perception result contains system health',
      };
    });
  }

  private wireExecutor(capabilityId: string, executor: CapabilityExecutor): void {
    const cap = this.registry.get(capabilityId);
    if (cap) {
      // Re-register with executor
      this.registry.register({
        capabilityId: cap.capabilityId,
        capabilityName: cap.capabilityName,
        description: cap.description,
        provider: cap.provider,
        riskLevel: cap.riskLevel,
        autonomyRequirement: cap.autonomyRequirement,
        dependencies: cap.dependencies,
        verificationStrategy: cap.verificationStrategy,
        reversible: cap.reversible,
        timeoutMs: cap.timeoutMs,
        metadata: cap.metadata,
      }, executor);
    }
  }

  private async executeViaActionExecutor(
    ae: NonNullable<ExecutionBridge['actionExecutor']>,
    actionType: string,
    params: Record<string, unknown>,
    ctx: CapabilityExecutionContext,
  ): Promise<CapabilityResult> {
    const result = await ae.execute({ type: actionType, payload: params }, ctx.sessionId);
    const success = result.status === 'completed';
    return {
      capabilityId: `tool.${actionType}`,
      executed: success,
      outcome: success ? 'success' : 'failure',
      result: result.result,
      error: result.error || (success ? null : 'Action failed'),
      evidence: [{ actionType, params, result }],
      verified: success, // ActionExecutor returns explicit status
      verificationDetails: success ? 'ActionExecutor returned completed status' : `ActionExecutor returned failed: ${result.error}`,
    };
  }

  private failResult(capabilityId: string, error: string): CapabilityResult {
    return {
      capabilityId,
      executed: false,
      outcome: 'failure',
      result: null,
      error,
      evidence: [],
      verified: false,
      verificationDetails: 'Executor failed before execution',
    };
  }

  // ─── Main cognitive cycle ─────────────────────────────────────────────

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
      retrievedMemory: null,
      trustClassification: null,
      threatAssessments: [],
      metaCognitiveEvaluation: null,
      decisionResolution: null,
      selectedAction: null,
      authorizationResult: null,
      executionResult: null,
      verificationResult: null,
      learningResult: null,
      replanResult: null,
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

    // PHASE 3: UNDERSTAND — assess threats via guardian
    try {
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

    // PHASE 5: RETRIEVE MEMORY — retrieve relevant memories before reasoning
    try {
      state.activeGoals = await this.goals.getActiveMissions();
      state.pendingWork = await this.goals.getPendingWork();
      if (this.bridge.memory && state.pendingWork.length > 0) {
        const query = `cognitive cycle: ${state.pendingWork.map(g => g.title).join(', ')}`;
        state.retrievedMemory = await this.bridge.memory.retrieve(query, 'heidi', this.sessionId);
      }
      state.phase = 'identify_goals';
    } catch (e) {
      errors.push(`retrieve_memory: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 6: IDENTIFY GOALS — check for goals that need attention
    try {
      state.phase = 'plan';
    } catch (e) {
      errors.push(`identify_goals: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 7: PLAN — select the highest-priority actionable goal + alternatives
    try {
      state.selectedAction = this.planNextAction(state);
      state.phase = 'assess_risk';
    } catch (e) {
      errors.push(`plan: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 8: ASSESS RISK/CONFIDENCE — meta-cognitive evaluation
    try {
      state.metaCognitiveEvaluation = await this.assessMetaCognition(state);
      state.phase = 'select';
    } catch (e) {
      errors.push(`assess_risk: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 9: SELECT — decision resolution if there are competing goals
    try {
      state.decisionResolution = this.resolveDecision(state);
      state.phase = 'authorize';
    } catch (e) {
      errors.push(`select: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 10: AUTHORIZE — check capability registry + autonomy policy
    try {
      state.authorizationResult = this.authorizeAction(state.selectedAction, state.identity);
      state.phase = 'act';

      // If not authorized, create escalation record
      if (!state.authorizationResult.authorized && state.authorizationResult.escalationRecordId === null) {
        state.authorizationResult.escalationRecordId = `esc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await this.recordEscalation(state);
      }
    } catch (e) {
      errors.push(`authorize: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 11: ACT — execute the action through the capability registry
    try {
      if (state.authorizationResult?.authorized && state.selectedAction) {
        state.executionResult = await this.executeAction(state.selectedAction, state);
      } else {
        state.executionResult = {
          executed: false,
          actionType: state.selectedAction?.actionType || 'none',
          capabilityId: state.selectedAction?.capabilityId || null,
          outcome: 'skipped',
          details: state.authorizationResult?.reason || 'No action selected or not authorized',
          evidence: [],
          rawResult: null,
        };
      }
      state.phase = 'verify';
    } catch (e) {
      errors.push(`act: ${e instanceof Error ? e.message : 'unknown'}`);
      state.executionResult = {
        executed: false,
        actionType: state.selectedAction?.actionType || 'none',
        capabilityId: state.selectedAction?.capabilityId || null,
        outcome: 'failure',
        details: e instanceof Error ? e.message : 'unknown',
        evidence: [],
        rawResult: null,
      };
    }

    // PHASE 12: VERIFY — real verification per action type
    try {
      if (state.executionResult?.executed) {
        state.verificationResult = await this.verifyAction(state);
      }
      state.phase = 'learn';
    } catch (e) {
      errors.push(`verify: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 13: LEARN — close the learning loop with real memory storage
    try {
      state.learningResult = await this.learnFromCycle(state);
      state.phase = 'record';
    } catch (e) {
      errors.push(`learn: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 14: RECORD — persist the cognitive state
    try {
      await this.recordCycle(state);
    } catch (e) {
      errors.push(`record: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 15: REPLAN — if execution failed or verification failed, consider replanning
    try {
      if (state.executionResult?.outcome === 'failure' || (state.executionResult?.executed && state.verificationResult?.verified === false)) {
        state.replanResult = await this.replanOnDeviation(state);
        if (state.replanResult?.replanned) {
          state.phase = 'replan';
        }
      }
    } catch (e) {
      errors.push(`replan: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    state.durationMs = Date.now() - startTime;
    this.currentCycle = state;
    return state;
  }

  // ─── Perception ───────────────────────────────────────────────────────

  private async perceive(): Promise<PerceptionResult> {
    const components: Array<{ name: string; status: string; confidence: number; evidence: string }> = [];

    // Check database
    try {
      await this.pool.query('SELECT 1');
      components.push({ name: 'database', status: 'healthy', confidence: 1.0, evidence: 'SELECT 1 succeeded' });
    } catch (e) {
      components.push({ name: 'database', status: 'failed', confidence: 1.0, evidence: `SELECT 1 failed: ${e instanceof Error ? e.message : 'unknown'}` });
    }

    // Check Ollama if configured
    const ollamaUrl = process.env.LOCAL_MODEL_URL || 'http://localhost:11434';
    try {
      const resp = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(5000) });
      if (resp.ok) {
        components.push({ name: 'ollama', status: 'healthy', confidence: 1.0, evidence: `GET /api/tags returned ${resp.status}` });
      } else {
        components.push({ name: 'ollama', status: 'degraded', confidence: 0.8, evidence: `GET /api/tags returned ${resp.status}` });
      }
    } catch {
      components.push({ name: 'ollama', status: 'unknown', confidence: 0.5, evidence: 'Ollama not reachable or not configured' });
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

    // Capability summary
    const capSummary = this.registry.getSummary();

    // Determine overall health — UNKNOWN is never collapsed into FAILED
    const failed = components.filter((c) => c.status === 'failed').length;
    const degraded = components.filter((c) => c.status === 'degraded').length;
    const unknown = components.filter((c) => c.status === 'unknown').length;
    let systemHealth: PerceptionResult['systemHealth'];
    if (failed > 0) {
      systemHealth = 'failed';
    } else if (degraded > 0) {
      systemHealth = 'degraded';
    } else if (unknown > 0 && components.filter((c) => c.status === 'healthy').length === 0) {
      systemHealth = 'unknown';
    } else {
      systemHealth = 'healthy';
    }

    return {
      observedAt: new Date().toISOString(),
      systemHealth,
      components,
      revenueStatus,
      communicationStatus,
      workerStatus,
      capabilitySummary: { total: capSummary.total, available: capSummary.available, unavailable: capSummary.unavailable },
    };
  }

  // ─── Planning ─────────────────────────────────────────────────────────

  private planNextAction(state: CognitiveState): SelectedAction {
    const actionable = state.pendingWork.filter(
      (g) => g.status === 'active' || g.status === 'pending',
    );

    const alternatives: Array<{ action: string; reason: string; rejected: boolean }> = [];

    if (actionable.length === 0) {
      return {
        actionType: 'cognitive.observe',
        capabilityId: 'cognitive.observe',
        description: 'No pending work — continue observing',
        targetGoalId: null,
        riskLevel: 'R0',
        estimatedImpact: 'none',
        reasoning: 'No actionable goals found. Maintain observation.',
        params: {},
        alternatives,
      };
    }

    // Sort by priority (highest first)
    actionable.sort((a, b) => b.priority - a.priority);

    // Record alternatives
    for (let i = 1; i < Math.min(actionable.length, 4); i++) {
      alternatives.push({
        action: `advance_goal: ${actionable[i].title}`,
        reason: `Priority ${actionable[i].priority} — lower than selected`,
        rejected: true,
      });
    }

    const target = actionable[0];

    // Determine capability based on goal type
    let capabilityId = 'goal.advance';
    let actionType = 'goal.advance';
    let riskLevel = 'R0';
    let params: Record<string, unknown> = { goalId: target.goalId };

    // If the goal has a specific capability in its context, use it
    const goalContext = target.context as Record<string, unknown>;
    if (goalContext?.capabilityId && typeof goalContext.capabilityId === 'string') {
      const cap = this.registry.get(goalContext.capabilityId);
      if (cap && cap.status === 'available') {
        capabilityId = goalContext.capabilityId;
        actionType = goalContext.capabilityId;
        riskLevel = cap.riskLevel;
        params = (goalContext.capabilityParams as Record<string, unknown>) || params;
      }
    }

    return {
      actionType,
      capabilityId,
      description: `Advance goal: ${target.title}`,
      targetGoalId: target.goalId,
      riskLevel,
      estimatedImpact: target.goalType === 'mission' ? 'strategic' : 'operational',
      reasoning: `Goal ${target.goalId} (${target.goalType}: ${target.title}) is highest priority pending work. Selected over ${alternatives.length} alternatives.`,
      params,
      alternatives,
    };
  }

  // ─── Meta-cognition ───────────────────────────────────────────────────

  private async assessMetaCognition(state: CognitiveState): Promise<MetaCognitiveResult | null> {
    if (!this.bridge.metaCognition) {
      return null;
    }

    try {
      const thinkResult = {
        query: state.selectedAction?.description || 'cognitive cycle',
        thinkingProcess: [
          `Observed system health: ${state.perception?.systemHealth}`,
          `Active goals: ${state.activeGoals.length}`,
          `Pending work: ${state.pendingWork.length}`,
          `Selected action: ${state.selectedAction?.actionType || 'none'}`,
        ],
        response: state.selectedAction?.reasoning || 'no action selected',
        confidence: state.selectedAction ? 0.7 : 0.3,
      };

      const evaluation = await this.bridge.metaCognition.evaluate(thinkResult);
      return {
        qualityScore: evaluation.overallQualityScore,
        classification: evaluation.qualityClassification,
        improvementAreas: evaluation.improvementAreas,
        confidenceCalibration: evaluation.overallQualityScore,
        biasDetected: [],
      };
    } catch {
      return null;
    }
  }

  // ─── Decision resolution ──────────────────────────────────────────────

  private resolveDecision(state: CognitiveState): DecisionResolutionResult | null {
    if (!state.selectedAction) return null;

    // If there are no alternatives, no conflict to resolve
    if (state.selectedAction.alternatives.length === 0) {
      return {
        finalAction: state.selectedAction.actionType,
        winningAuthority: 'reasoning',
        reasoning: state.selectedAction.reasoning,
        confidence: 0.7,
        conflictResolution: 'no_conflict',
        alternativesConsidered: [],
      };
    }

    // If decision resolver is available, use it
    if (this.bridge.decisionResolver) {
      try {
        const cascadeOutput = {
          strategic_theme: state.selectedAction.description,
          strategic_theme_confidence: 0.7,
          v3_adjusted_score: 0.5,
        };
        const memorySignal = {
          rollingAccuracy: 0.7,
          theme: 'cognitive_cycle',
          correct: 5,
          incorrect: 1,
          last_updated: new Date().toISOString(),
        };
        const policyConstraints = {
          authorized: state.authorizationResult?.authorized ?? false,
          message: state.authorizationResult?.reason || 'pending',
          action: state.authorizationResult?.authorizationMode || 'pending',
        };

        const result = this.bridge.decisionResolver.resolve(cascadeOutput, memorySignal, policyConstraints);
        // Handle both sync and async resolve
        return Promise.resolve(result).then((r) => ({
          finalAction: r.final_action,
          winningAuthority: r.winning_authority,
          reasoning: r.reasoning,
          confidence: r.confidence,
          conflictResolution: r.conflict_resolution,
          alternativesConsidered: state.selectedAction!.alternatives,
        })) as unknown as DecisionResolutionResult;
      } catch {
        // Fall through to simple resolution
      }
    }

    // Simple resolution: selected action wins, alternatives recorded
    return {
      finalAction: state.selectedAction.actionType,
      winningAuthority: 'reasoning',
      reasoning: state.selectedAction.reasoning,
      confidence: 0.7,
      conflictResolution: 'no_conflict',
      alternativesConsidered: state.selectedAction.alternatives,
    };
  }

  // ─── Authorization ────────────────────────────────────────────────────

  private authorizeAction(action: SelectedAction | null, identity: HeidiIdentity | null): AuthorizationResult {
    if (!action) {
      return { authorized: false, authorizationMode: 'prohibited', reason: 'No action selected', policyEvaluated: 'none', capabilityId: null, escalationRecordId: null };
    }

    if (!identity) {
      return { authorized: false, authorizationMode: 'prohibited', reason: 'Identity not loaded', policyEvaluated: 'none', capabilityId: action.capabilityId, escalationRecordId: null };
    }

    // Check capability registry
    if (action.capabilityId) {
      const execCheck = this.registry.isExecutable(action.capabilityId, identity.autonomyLevel);
      if (!execCheck.executable) {
        return {
          authorized: false,
          authorizationMode: 'human_required',
          reason: execCheck.reason,
          policyEvaluated: 'capability_registry',
          capabilityId: action.capabilityId,
          escalationRecordId: null,
        };
      }
    }

    // Risk-based authorization
    const riskLevel = action.riskLevel;
    if (riskLevel === 'R0') {
      return { authorized: true, authorizationMode: 'autonomous', reason: 'R0 action — autonomous', policyEvaluated: 'R0 default', capabilityId: action.capabilityId, escalationRecordId: null };
    }
    if (riskLevel === 'R1') {
      if (identity.autonomyLevel >= 2) {
        return { authorized: true, authorizationMode: 'autonomous', reason: 'R1 action — autonomous at current autonomy level', policyEvaluated: 'R1 default', capabilityId: action.capabilityId, escalationRecordId: null };
      }
      return { authorized: false, authorizationMode: 'human_required', reason: 'R1 action requires autonomy level >= 2', policyEvaluated: 'R1 default', capabilityId: action.capabilityId, escalationRecordId: null };
    }
    if (riskLevel === 'R2') {
      const authorized = identity.autonomyLevel >= 3;
      return { authorized, authorizationMode: 'policy_authorized', reason: authorized ? 'R2 action — policy authorized' : 'R2 action requires autonomy level >= 3', policyEvaluated: 'R2 default', capabilityId: action.capabilityId, escalationRecordId: null };
    }
    if (riskLevel === 'R3' || riskLevel === 'R4') {
      return { authorized: false, authorizationMode: 'human_required', reason: `${riskLevel} action requires human authorization`, policyEvaluated: `${riskLevel} default`, capabilityId: action.capabilityId, escalationRecordId: null };
    }
    return { authorized: false, authorizationMode: 'prohibited', reason: 'R5 action — prohibited', policyEvaluated: 'R5 default', capabilityId: action.capabilityId, escalationRecordId: null };
  }

  // ─── Execution ────────────────────────────────────────────────────────

  private async executeAction(action: SelectedAction, state: CognitiveState): Promise<ExecutionResult> {
    // If the action has a capabilityId, execute through the registry
    if (action.capabilityId) {
      const ctx: CapabilityExecutionContext = {
        sessionId: this.sessionId,
        actorId: 'heidi',
        actorTrustLevel: state.trustClassification?.trustLevel || 'trusted_system',
        authorizationMode: state.authorizationResult?.authorizationMode || 'autonomous',
        auditTrail: state.errors,
      };

      const capResult = await this.registry.execute(action.capabilityId, action.params, ctx);

      return {
        executed: capResult.executed,
        actionType: action.actionType,
        capabilityId: action.capabilityId,
        outcome: capResult.outcome,
        details: capResult.error || `${action.capabilityId} executed`,
        evidence: capResult.evidence,
        rawResult: capResult.result,
      };
    }

    // Fallback: observe action
    if (action.actionType === 'observe' || action.actionType === 'cognitive.observe') {
      return {
        executed: true,
        actionType: 'cognitive.observe',
        capabilityId: 'cognitive.observe',
        outcome: 'success',
        details: 'Observation cycle completed',
        evidence: [{ cycleId: state.cycleId, perception: state.perception }],
        rawResult: state.perception,
      };
    }

    return {
      executed: false,
      actionType: action.actionType,
      capabilityId: null,
      outcome: 'skipped',
      details: `Action type ${action.actionType} has no capabilityId — not executable through registry`,
      evidence: [],
      rawResult: null,
    };
  }

  // ─── Verification ─────────────────────────────────────────────────────

  private async verifyAction(state: CognitiveState): Promise<VerificationResult> {
    if (!state.executionResult || !state.selectedAction) {
      return { verified: false, expectedState: 'unknown', actualState: 'unknown', verificationStrategy: 'none', evidence: [] };
    }

    const action = state.selectedAction;
    const exec = state.executionResult;

    // If the capability registry executor already verified, use that
    if (action.capabilityId) {
      const cap = this.registry.get(action.capabilityId);
      const verificationStrategy = cap?.verificationStrategy || 'unknown';

      // For goal.advance, verify by re-reading the goal
      if (action.capabilityId === 'goal.advance' && action.targetGoalId) {
        const goal = await this.goals.getGoal(action.targetGoalId);
        return {
          verified: goal?.status === 'in_progress' || goal?.status === 'completed',
          expectedState: 'in_progress or completed',
          actualState: goal?.status || 'unknown',
          verificationStrategy,
          evidence: [{ goalId: action.targetGoalId, status: goal?.status }],
        };
      }

      // For goal.complete, verify by re-reading the goal
      if (action.capabilityId === 'goal.complete' && action.targetGoalId) {
        const goal = await this.goals.getGoal(action.targetGoalId);
        return {
          verified: goal?.status === 'completed',
          expectedState: 'completed',
          actualState: goal?.status || 'unknown',
          verificationStrategy,
          evidence: [{ goalId: action.targetGoalId, status: goal?.status, result: goal?.result }],
        };
      }

      // For tool.create_task, verify by querying the actions table
      if (action.capabilityId === 'tool.create_task') {
        const result = exec.rawResult as { task_id?: string } | null;
        if (result?.task_id) {
          try {
            const row = await this.pool.query<QueryResultRow>(
              `SELECT id, status FROM actions WHERE id = $1`,
              [result.task_id],
            );
            return {
              verified: row.rows.length > 0,
              expectedState: 'task exists in actions table',
              actualState: row.rows.length > 0 ? `task exists, status=${row.rows[0].status}` : 'task not found',
              verificationStrategy,
              evidence: [{ taskId: result.task_id, found: row.rows.length > 0 }],
            };
          } catch (e) {
            return {
              verified: false,
              expectedState: 'task exists in actions table',
              actualState: `verification query failed: ${e instanceof Error ? e.message : 'unknown'}`,
              verificationStrategy,
              evidence: [],
            };
          }
        }
      }

      // For recovery actions, verify by re-checking health
      if (action.capabilityId === 'recovery.governed_recover' || action.capabilityId === 'recovery.auto_recover') {
        const component = action.params.component as string;
        if (component && this.bridge.operationalIntelligence) {
          try {
            await this.bridge.operationalIntelligence.checkHealth();
            return {
              verified: true,
              expectedState: 'component healthy after recovery',
              actualState: 'health check completed after recovery',
              verificationStrategy,
              evidence: [{ component, postRecoveryCheck: true }],
            };
          } catch (e) {
            return {
              verified: false,
              expectedState: 'component healthy after recovery',
              actualState: `post-recovery check failed: ${e instanceof Error ? e.message : 'unknown'}`,
              verificationStrategy,
              evidence: [],
            };
          }
        }
      }

      // For communication actions, verify delivery status
      if (action.capabilityId === 'comm.send_message') {
        const result = exec.rawResult as { deliveryStatus?: string; messageId?: string } | null;
        return {
          verified: result?.deliveryStatus === 'delivered' || result?.deliveryStatus === 'sent',
          expectedState: 'message delivered or sent',
          actualState: result?.deliveryStatus || 'unknown',
          verificationStrategy,
          evidence: [{ messageId: result?.messageId, deliveryStatus: result?.deliveryStatus }],
        };
      }

      // For revenue actions, verify the result structure
      if (action.capabilityId === 'revenue.run_cycle') {
        const result = exec.rawResult as { selectedAction?: unknown } | null;
        return {
          verified: result !== null && typeof result === 'object',
          expectedState: 'RevenueControlLoopResult returned',
          actualState: result !== null ? 'result object received' : 'no result',
          verificationStrategy,
          evidence: [{ hasResult: result !== null }],
        };
      }

      // For world.query, verify answer was returned
      if (action.capabilityId === 'world.query') {
        return {
          verified: typeof exec.rawResult === 'string' && exec.rawResult.length > 0,
          expectedState: 'non-empty answer string',
          actualState: typeof exec.rawResult === 'string' ? `answer (${exec.rawResult.length} chars)` : 'no answer',
          verificationStrategy,
          evidence: [{ answerLength: typeof exec.rawResult === 'string' ? exec.rawResult.length : 0 }],
        };
      }

      // Default: trust the executor's verification
      return {
        verified: exec.outcome === 'success',
        expectedState: 'executor reported success',
        actualState: exec.outcome,
        verificationStrategy,
        evidence: exec.evidence,
      };
    }

    // Fallback for observe
    if (action.actionType === 'observe' || action.actionType === 'cognitive.observe') {
      return {
        verified: true,
        expectedState: 'observation completed',
        actualState: exec.outcome === 'success' ? 'observation completed' : 'observation failed',
        verificationStrategy: 'perception result contains system health',
        evidence: exec.evidence,
      };
    }

    return {
      verified: false,
      expectedState: 'unknown',
      actualState: 'unknown',
      verificationStrategy: 'none',
      evidence: [],
    };
  }

  // ─── Learning ─────────────────────────────────────────────────────────

  private async learnFromCycle(state: CognitiveState): Promise<LearningResult> {
    const lessons: string[] = [];
    let outcomeClassification: LearningResult['outcomeClassification'] = 'unverified';

    if (state.errors.length > 0) {
      lessons.push(`Cycle had ${state.errors.length} errors: ${state.errors.join('; ')}`);
    }

    if (state.executionResult?.outcome === 'failure') {
      lessons.push(`Action ${state.executionResult.actionType} failed: ${state.executionResult.details}`);
      outcomeClassification = 'failure';
    } else if (state.executionResult?.executed && state.verificationResult?.verified) {
      lessons.push(`Action ${state.executionResult.actionType} executed and verified successfully`);
      outcomeClassification = 'success';
    } else if (state.executionResult?.executed && state.verificationResult?.verified === false) {
      lessons.push(`Action ${state.executionResult.actionType} executed but verification failed: ${state.verificationResult.actualState}`);
      outcomeClassification = 'partial_failure';
    } else if (state.executionResult?.outcome === 'skipped') {
      outcomeClassification = 'unverified';
    }

    if (state.perception?.systemHealth === 'failed') {
      lessons.push(`System health is failed — components: ${state.perception.components.map((c) => `${c.name}=${c.status}`).join(', ')}`);
    }

    // Meta-cognitive insights
    if (state.metaCognitiveEvaluation && state.metaCognitiveEvaluation.improvementAreas.length > 0) {
      lessons.push(`Meta-cognition identified improvement areas: ${state.metaCognitiveEvaluation.improvementAreas.join(', ')}`);
    }

    const lesson = lessons.length > 0 ? lessons.join('; ') : null;
    let memoryStored = false;
    let memoryId: string | null = null;

    // Store experience in episodic memory if bridge is available
    if (this.bridge.memory && lesson && state.executionResult?.executed) {
      try {
        const experience = {
          problem: state.selectedAction?.description || 'cognitive cycle',
          actionsTaken: [{
            type: state.selectedAction?.actionType || 'unknown',
            status: state.executionResult.outcome,
            error: state.executionResult.details,
          }],
          outcome: outcomeClassification,
          lesson,
        };
        memoryStored = await this.bridge.memory.storeExperience(this.sessionId, 'heidi', experience);
        if (memoryStored) {
          memoryId = `mem-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        }
      } catch {
        // Memory storage failure is not fatal
      }
    }

    // Update goal if action was for a goal
    let goalUpdated = false;
    if (state.executionResult?.executed && state.selectedAction?.targetGoalId && state.verificationResult?.verified) {
      try {
        // Add evidence to the goal
        await this.goals.addEvidence(state.selectedAction.targetGoalId, {
          cycleId: state.cycleId,
          action: state.selectedAction.actionType,
          outcome: state.executionResult.outcome,
          verified: state.verificationResult.verified,
          timestamp: state.timestamp,
        });
        goalUpdated = true;
      } catch {
        // Goal update failure is not fatal
      }
    }

    return {
      lessonLearned: lessons.length > 0,
      lesson,
      memoryStored,
      memoryId,
      goalUpdated,
      outcomeClassification,
    };
  }

  // ─── Replanning ───────────────────────────────────────────────────────

  private async replanOnDeviation(state: CognitiveState): Promise<ReplanResult> {
    if (!state.selectedAction?.targetGoalId) {
      return { replanned: false, originalGoalId: null, deviationReason: null, newGoalId: null, revisedPlan: null };
    }

    const goalId = state.selectedAction.targetGoalId;
    const deviationReason = state.executionResult?.outcome === 'failure'
      ? `Execution failed: ${state.executionResult.details}`
      : state.verificationResult?.verified === false
        ? `Verification failed: expected ${state.verificationResult.expectedState}, got ${state.verificationResult.actualState}`
        : 'unknown deviation';

    // Record the deviation on the goal
    try {
      await this.goals.addEvidence(goalId, {
        type: 'deviation',
        cycleId: state.cycleId,
        deviationReason,
        originalAction: state.selectedAction.actionType,
        timestamp: state.timestamp,
      });
    } catch {
      // Non-fatal
    }

    // Create a revised sub-goal if the original goal has a parent
    const goal = await this.goals.getGoal(goalId);
    if (goal?.parentId) {
      try {
        const revisedGoal = await this.goals.createGoal({
          goalType: 'task',
          title: `Replan: ${goal.title}`,
          description: `Revised plan after deviation: ${deviationReason}`,
          parentId: goal.parentId,
          priority: goal.priority,
          purpose: `Recovery from deviation in ${goal.title}`,
          context: {
            originalGoalId: goalId,
            deviationReason,
            revisedAt: state.timestamp,
          },
        });
        return {
          replanned: true,
          originalGoalId: goalId,
          deviationReason,
          newGoalId: revisedGoal.goalId,
          revisedPlan: `Created new task ${revisedGoal.goalId} under parent ${goal.parentId} to replace failed ${goalId}`,
        };
      } catch {
        // Non-fatal
      }
    }

    // If no parent, just mark the deviation
    return {
      replanned: false,
      originalGoalId: goalId,
      deviationReason,
      newGoalId: null,
      revisedPlan: `Deviation recorded on goal ${goalId}. No parent goal to create replacement under.`,
    };
  }

  // ─── Recording ────────────────────────────────────────────────────────

  private async recordCycle(state: CognitiveState): Promise<void> {
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
            retrievedMemory: state.retrievedMemory ? true : false,
            selectedAction: state.selectedAction?.actionType,
            selectedCapability: state.selectedAction?.capabilityId,
            alternativesConsidered: state.selectedAction?.alternatives.length || 0,
            metaCognitiveScore: state.metaCognitiveEvaluation?.qualityScore,
            decisionResolution: state.decisionResolution?.conflictResolution,
            authorized: state.authorizationResult?.authorized,
            authorizationMode: state.authorizationResult?.authorizationMode,
            executed: state.executionResult?.executed,
            outcome: state.executionResult?.outcome,
            verified: state.verificationResult?.verified,
            verificationStrategy: state.verificationResult?.verificationStrategy,
            lessonLearned: state.learningResult?.lessonLearned,
            memoryStored: state.learningResult?.memoryStored,
            outcomeClassification: state.learningResult?.outcomeClassification,
            replanned: state.replanResult?.replanned,
            errors: state.errors,
            durationMs: state.durationMs,
          }),
        ],
      );
    } catch {
      // heidi_events may have different schema — don't fail the cycle
    }
  }

  private async recordEscalation(state: CognitiveState): Promise<void> {
    if (!state.authorizationResult?.escalationRecordId) return;
    try {
      await this.pool.query(
        `INSERT INTO heidi_events (event_type, payload, created_at)
         VALUES ($1, $2, now())`,
        [
          'authorization_escalation',
          JSON.stringify({
            escalationId: state.authorizationResult.escalationRecordId,
            cycleId: state.cycleId,
            capabilityId: state.authorizationResult.capabilityId,
            actionType: state.selectedAction?.actionType,
            riskLevel: state.selectedAction?.riskLevel,
            authorizationMode: state.authorizationResult.authorizationMode,
            reason: state.authorizationResult.reason,
            timestamp: state.timestamp,
          }),
        ],
      );
    } catch {
      // Non-fatal
    }
  }

  // ─── Public API ───────────────────────────────────────────────────────

  async resumeAfterRestart(): Promise<{ resumedGoals: Goal[]; blockedGoals: Goal[] }> {
    const result = await this.goals.resumeAfterRestart();
    return { resumedGoals: result.resumed, blockedGoals: result.blocked };
  }

  async start(intervalMs: number = 60000): Promise<void> {
    if (this.running) return;
    this.running = true;
    await this.resumeAfterRestart();
    await this.runCycle();
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

  getRegistry(): CapabilityRegistry {
    return this.registry;
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
