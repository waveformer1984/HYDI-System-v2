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
import type { RiskLevel } from '../operational/types';
import {
  ContractRegistry,
  computeAuthority,
  type CapabilityContract,
  type SystemStateSnapshot,
  type VerificationRunner,
} from '../capability-contract';
import { createHeidiVerificationRunner, heidiObservers } from './ContractVerification';
import { ALL_CONTRACTS } from './contracts';
import type { ProspectRecord, OpportunityRecord } from '../revenue/types';
import { getOfferCatalog } from '../revenue/OfferCatalog';
import { MissionProducer, type ProductionResult } from './MissionProducer';
import { collectExecutiveDiagnostic } from './ExecutiveDiagnostic';
import { collectDiagnosticFollowup, investigateDimension } from './DiagnosticFollowup';
import { collectReconciliation, resolveGitHead } from './DeploymentReconciliation';
import { runR0Recovery } from './SelfRepairR0';
import { collectCooState } from './CooState';
import { acknowledgeHumanAction } from './HumanActionQueue';
import { runInvestigateMission, runTopicInvestigation, runTopOpportunityInvestigation, collectAgentState, superviseAgents, stopAgent, retryMission, resolveHumanAction } from './AgentControlPlane';

export type CognitivePhase =
  | 'perceive' | 'validate' | 'understand' | 'update_world_model'
  | 'retrieve_memory' | 'identify_goals' | 'plan' | 'assess_risk'
  | 'select' | 'authorize' | 'act' | 'verify' | 'learn' | 'record'
  | 'replan' | 'escalate';

// ─── Bounded continuous loop state machine ──────────────────────────────

export type LoopState =
  | 'stopped'      // not running
  | 'starting'     // initialization in progress
  | 'running'      // actively cycling
  | 'paused'       // manually paused, can be resumed
  | 'cooldown'     // automatic cooldown after repeated failures
  | 'degraded'     // running but with degraded capabilities
  | 'failed'       // loop failed, needs manual intervention
  | 'stopping';    // graceful shutdown in progress

export interface LoopStatus {
  state: LoopState;
  running: boolean;
  cycleCount: number;
  lastCycleAt: string | null;
  lastSuccessfulCycleAt: string | null;
  lastFailureAt: string | null;
  consecutiveFailures: number;
  cooldownUntil: string | null;
  killSwitchActive: boolean;
  currentIntervalMs: number;
  cycleInFlight: boolean;
  lastError: string | null;
  lastCycleOutcome: CycleOutcome | null;
}

export interface LoopConfig {
  intervalMs: number;           // default: 60000 (60s)
  startupStabilizationMs: number; // default: 120000 (2min)
  cycleTimeoutMs: number;       // default: 30000 (30s)
  maxConsecutiveFailures: number; // default: 3
  cooldownMs: number;           // default: 300000 (5min)
  backoffBaseMs: number;        // default: 2000 (2s)
  backoffMaxMs: number;         // default: 60000 (60s)
}

const DEFAULT_LOOP_CONFIG: LoopConfig = {
  intervalMs: 60000,
  startupStabilizationMs: 120000,
  cycleTimeoutMs: 30000,
  maxConsecutiveFailures: 3,
  cooldownMs: 300000,
  backoffBaseMs: 2000,
  backoffMaxMs: 60000,
};

export interface CognitiveState {
  cycleId: string;
  timestamp: string;
  phase: CognitivePhase;
  identity: HeidiIdentity | null;
  perception: PerceptionResult | null;
  worldModelSummary: { total: number; healthy: number; degraded: number; failed: number; unknown: number } | null;
  activeGoals: Goal[];
  pendingWork: Goal[];
  producedMissions: ProductionResult | null;
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
  outcome?: CycleOutcome;
}

/**
 * Classification of a cognitive cycle's outcome.
 *
 * This is critical for the bounded loop: only HARD_FAILURE and RECOVERABLE_FAILURE
 * should count toward consecutiveFailures. EXPECTED_BLOCK is normal operation —
 * a governed refusal or missing credential is NOT a system crash.
 */
export type CycleOutcome =
  | 'SUCCESS'              // cycle completed, action executed and verified
  | 'EXPECTED_BLOCK'       // cycle completed, action blocked by governance or missing credentials
  | 'RECOVERABLE_FAILURE'  // cycle completed but with errors (timeout, provider down)
  | 'HARD_FAILURE';        // cycle threw an uncaught exception or timed out

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

/** One capability exercised directly, with its authority and verification outcome. */
export interface ExerciseRecord {
  capabilityId: string;
  startedAt: string;
  contractRegistered: boolean;
  tier: RiskLevel | null;
  requiresApproval: boolean;
  approvedBy: string | null;
  executed: boolean;
  executionOutcome: string | null;
  executionError: string | null;
  verificationOutcome: string | null;
  verificationEvidence: string | null;
  observationSource: string | null;
  /** Set when the capability was deliberately not run, with the reason. */
  skipped: string | null;
  /**
   * The executor's raw result, so a harness can chain one exercise into the
   * next without re-running the capability (which would double its effect).
   */
  rawResult?: unknown;
}

export interface AuthorizationResult {
  authorized: boolean;
  authorizationMode: 'autonomous' | 'policy_authorized' | 'human_required' | 'prohibited';
  reason: string;
  policyEvaluated: string;
  capabilityId: string | null;
  escalationRecordId: string | null;
  /**
   * The tier the capability contract derives for THIS invocation, from
   * (verb x target x blast radius x reversibility x state) — as opposed to
   * `action.riskLevel`, which is a constant attached to the capability.
   * Null when no contract is registered for the capability.
   */
  contractTier?: RiskLevel | null;
  /** Why the contract arrived at that tier. */
  contractRationale?: string | null;
  /**
   * Set when the contract would have refused an action the legacy risk level
   * permits. In `advisory` mode this is recorded and the action proceeds; in
   * `enforcing` mode the action is refused.
   */
  contractDisagreement?: string | null;
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

export interface DBConfig {
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
  revenuePipeline?: {
    identifyProspect: (input: { companyName: string; contactName?: string | null; contactEmail?: string | null; source: string; metadata?: Record<string, unknown> }) => Promise<unknown>;
    scoreProspect: (prospectId: string) => Promise<{ score: number; factors: Record<string, number>; reason: string }>;
    updateStatus: (prospectId: string, newStatus: string, context?: Record<string, unknown>) => Promise<unknown>;
    createOpportunity: (input: { prospectId: string; offerId: string; proposedPrice?: number; estimatedValue?: number; probability?: number; expectedCloseDate?: string }) => Promise<unknown>;
    getPipelineMetrics: () => Promise<unknown>;
    getProspect: (prospectId: string) => Promise<ProspectRecord | null>;
    getOpportunity: (opportunityId: string) => Promise<OpportunityRecord | null>;
  } | null;
  revenueLifecycle?: {
    startOnboarding: (input: { customerId: string; offerId: string; stripeCustomerId?: string; configuration?: Record<string, unknown> }) => Promise<unknown>;
    activateService: (serviceId: string) => Promise<unknown>;
    verifyService: (serviceId: string) => Promise<{ verified: boolean; result: string; details: Record<string, unknown> }>;
  } | null;
  revenueLedger?: {
    getVerifiedRevenue: () => Promise<unknown>;
    getRevenueSummary: () => Promise<unknown>;
  } | null;
  commercialWorkflow?: {
    getState: () => Promise<unknown>;
    discoverProspects: (query: { industry?: string; location?: string; maxResults?: number }) => Promise<unknown>;
    ingestProspect: (discovered: unknown) => Promise<unknown>;
    createOpportunityForProspect: (prospectId: string, offerId?: string) => Promise<unknown>;
    prepareOutreachDraft: (prospect: unknown, opportunity: unknown, offerId: string, cognitiveCycleId: string, goalId: string) => unknown;
    createAuthorizationPackage: (prospect: unknown, opportunity: unknown, draft: unknown, goalId: string, cognitiveCycleId: string) => unknown;
    approveAuthorizationPackage: (packageId: string, approvedBy: string, reason?: string) => unknown;
    sendApprovedMessage: (packageId: string) => Promise<unknown>;
    processInboundResponse: (message: unknown, prospects: unknown[], opportunities: unknown[]) => Promise<unknown>;
    verifyRevenue: () => Promise<unknown>;
    getAuthManager: () => { getPendingPackages: () => unknown[]; isApproved: (id: string) => boolean; getAllPackages: () => unknown[] };
    getDiscoveryAdapter: () => { isAvailable: () => boolean; getBlockerReason: () => string | null };
  } | null;
  memory?: {
    retrieve: (query: string, userId: string, sessionId?: string) => Promise<string>;
    storeExperience: (sessionId: string, userId: string, experience: { problem: string; actionsTaken: unknown[]; outcome: string; lesson: string }) => Promise<string | null>;
  } | null;
  metaCognition?: {
    evaluate: (thinkResult: { query: string; thinkingProcess: unknown[]; response: string; confidence: number }) => Promise<{ overallQualityScore: number; qualityClassification: string; improvementAreas: string[] }>;
  } | null;
  decisionResolver?: {
    resolve: (cascadeOutput: unknown, memorySignal: unknown, policyConstraints: unknown) => Promise<{ final_action: string; winning_authority: string; reasoning: string; confidence: number; conflict_resolution: string }>;
  } | null;
  // Self-sufficiency: capability health, blocker resolution, self-repair
  capabilityHealthManager?: {
    checkAll: () => Promise<unknown>;
    checkCapability: (capabilityId: string) => Promise<unknown>;
    getReadyCapabilities: () => unknown[];
    getBlockedCapabilities: () => unknown[];
    getLastSummary: () => unknown;
    formatSummary: (summary: unknown) => string;
  } | null;
  blockerResolutionEngine?: {
    resolveBlockers: (reports: unknown[], options?: unknown) => Promise<unknown>;
    resolveBlocker: (report: unknown) => Promise<unknown>;
    getHistory: () => unknown[];
  } | null;
  selfRepairEngine?: {
    runSelfRepair: (healthSummary: unknown, options?: unknown) => Promise<unknown>;
    getHistory: () => unknown[];
    registerRepairHandler: (capabilityId: string, handler: (capabilityId: string, procedure: string) => Promise<{ success: boolean; evidence: string }>) => void;
  } | null;
  // Key management: credential lifecycle, rotation, compromise response
  keyManagement?: {
    discover: () => Promise<{ added: unknown[]; updated: unknown[]; removed: unknown[] }>;
    getInventory: () => unknown;
    getKey: (keyId: string) => unknown | null;
    validate: (keyId: string) => Promise<unknown>;
    rotate: (keyId: string) => Promise<unknown>;
    revoke: (keyId: string) => Promise<unknown>;
    recover: (keyId: string) => Promise<unknown>;
    generate: (providerId: string, options: unknown) => Promise<unknown>;
    respondToCompromise: (keyId: string, suspicion: string) => Promise<unknown>;
    checkHealth: () => Promise<unknown>;
    scan: () => Promise<unknown>;
    setKillSwitch: (active: boolean) => void;
  } | null;
  // Production Operations Control Plane — preflight, blocker resolution,
  // credential health, configuration control, transaction authorization state.
  //
  // SECURITY: This bridge NEVER exposes raw credential values.
  // It returns metadata only (mode, health, configured, prefix).
  // Financial authorization is never created by this bridge — it can
  // only report authorization state. Human authorization remains external.
  controlPlane?: {
    /** Run a read-only preflight check. Returns READY/BLOCKED/FAILED with blocker list. */
    preflight: () => Promise<unknown>;
    /** Run the autonomous preflight loop: preflight → resolve auto-resolvable → verify → rerun. Bounded retries. */
    autonomousPreflight: () => Promise<unknown>;
    /** Get a safe, redacted status report (no secrets). */
    getStatus: () => Promise<unknown>;
    /** Get Stripe credential health metadata (mode, configured, valid — never the key). */
    getCredentialHealth: () => Promise<unknown>;
    /** Get the current transaction authorization state (does NOT create one). */
    getTransactionAuthorizationState: () => unknown;
    /** Apply a safe, non-secret configuration change (policy-checked, validated, audited). */
    applySafeConfiguration: (key: string, value: string, reason: string) => Promise<unknown>;
    /** Disarm live qualification mode (safety-reducing, idempotent, autonomous-safe). */
    disarmLiveQualification: (reason?: string) => Promise<unknown>;
    /** Stage a live authorization request (one-click Authorize flow). Does NOT set ALLOW_LIVE_STRIPE or issue auth. */
    stageLiveAuthorization: (params?: { customer?: string; amountCents?: number; product?: string }) => Promise<unknown>;
    /** Get the pending live authorization request (if any). */
    getPendingLiveAuthorizationRequest: () => unknown;
    /** Get a live authorization request by ID. */
    getLiveAuthorizationRequest: (requestId: string) => unknown;
  } | null;
}

/** Distinct from any legitimate result, including null and undefined. */
const TIMED_OUT = Symbol('timed-out');

export class CognitiveCore {
  private pool: Pool;
  private identity: HeidiIdentityModel;
  private goals: GoalSystem;
  private world: WorldModel;
  private trust: TrustModel;
  private guardian: GuardianModel;
  private registry: CapabilityRegistry;
  /**
   * Contract registry — the capabilities that describe themselves completely
   * enough that the planner does not need to know what they are. Verification
   * for these runs from the contract; everything else still falls through to
   * the legacy if-chain in verifyAction(), which is being retired branch by
   * branch as contracts land.
   */
  private contracts: ContractRegistry;
  private verifier: VerificationRunner;
  /**
   * `advisory` (default): the contract's tier is computed and recorded, and a
   * disagreement with the legacy risk level is logged, but the legacy decision
   * still governs. `enforcing`: a contract refusal blocks the action.
   *
   * Advisory is the default deliberately. Contract tiers are derived from
   * declared bounds, and those declarations are new; flipping straight to
   * enforcing would refuse work the system does today on the strength of
   * metadata nobody has yet checked against reality. Run advisory, read the
   * disagreements, then flip HEIDI_CONTRACT_AUTHORITY=enforcing.
   */
  private contractAuthorityMode: 'advisory' | 'enforcing';
  private missionProducer: MissionProducer | null;
  private bridge: ExecutionBridge;
  private currentCycle: CognitiveState | null = null;
  private cycleCount = 0;
  private sessionId: string;

  // ─── Bounded loop state ──────────────────────────────────────────────
  private loopState: LoopState = 'stopped';
  private loopConfig: LoopConfig = DEFAULT_LOOP_CONFIG;
  private intervalHandle: NodeJS.Timeout | null = null;
  private cycleInFlight = false;
  private killSwitchActive = false;
  private consecutiveFailures = 0;
  private lastCycleAt: string | null = null;
  private lastSuccessfulCycleAt: string | null = null;
  private lastFailureAt: string | null = null;
  private cooldownUntil: string | null = null;
  private lastError: string | null = null;
  private lastDevScanAt = 0;
  private startedAt: number | null = null;
  private runtimeCommit: string | null | undefined; // undefined = not yet resolved

  constructor(config?: DBConfig, bridge?: ExecutionBridge, opts?: { missionProducer?: MissionProducer | null }) {
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
    this.contractAuthorityMode =
      process.env.HEIDI_CONTRACT_AUTHORITY === 'enforcing' ? 'enforcing' : 'advisory';

    // Contract layer: register the migrated contracts and build the observers
    // that can actually go and look at the world.
    this.contracts = new ContractRegistry({ strict: false });
    for (const contract of ALL_CONTRACTS) {
      this.contracts.register(contract);
    }
    const observerDeps = {
      pool: this.pool,
      goals: this.goals,
      operationalIntelligence: this.bridge.operationalIntelligence ?? null,
      revenueLifecycle: this.bridge.revenueLifecycle ?? null,
      communicationLayer: this.bridge.communicationLayer as
        | { verifyDelivery: (id: string) => Promise<{ status: string; providerMessageId: string | null }> }
        | null
        ?? null,
    };
    this.verifier = createHeidiVerificationRunner(observerDeps);
    // Same observers on the registry, so unobservable() reports the truth
    // rather than flagging everything for lack of registration.
    for (const [source, observer] of heidiObservers(observerDeps)) {
      this.contracts.registerObserver(source, observer);
    }

    // Wire capability executors if bridge components are available
    this.wireCapabilityExecutors();

    // The governed goal producer. It runs inside the cycle's
    // identify_goals phase and can only emit missions bound to
    // capabilities the registry already reports as executable — it
    // narrows the loop's work, never widens its authority. Injectable
    // (and nullable) so tests can substitute a bounded catalog.
    this.missionProducer = opts && 'missionProducer' in opts
      ? (opts.missionProducer as MissionProducer)
      : new MissionProducer({
        goals: this.goals,
        registry: this.registry,
        findingSource: () => this.latestFindings(),
      });
  }

  /**
   * Read the persisted findings from the most recent diagnostic_followup
   * event. Returns [] when none exists or the row is unreadable — the
   * producer treats that as "no findings", never as an error.
   */
  private async latestFindings(): Promise<import('./MissionProducer').FindingRef[]> {
    try {
      const rows = await this.pool.query<QueryResultRow>(
        `SELECT id, payload FROM heidi_events
         WHERE event_type = 'diagnostic_followup' ORDER BY created_at DESC LIMIT 1`,
      );
      const row = rows.rows[0];
      if (!row) return [];
      const findings = (row.payload as { findings?: Array<Record<string, unknown>> })?.findings ?? [];
      return findings
        .filter((f) => f && typeof f === 'object')
        .map((f) => ({
          diagnosticEventId: row.id as string,
          taskTemplate: f.taskTemplate as string,
          dimension: f.dimension as string | undefined,
          severity: f.severity as string | undefined,
          summary: f.summary as string | undefined,
          humanRequired: f.humanRequired === true,
        }));
    } catch {
      return [];
    }
  }

  // ─── Bounded external calls ───────────────────────────────────────────

  /**
   * Budget for a single memory read or write inside a cycle.
   *
   * Sits just above EMBEDDING_TIMEOUT_MS (15 s) so the inner, more specific
   * timeout normally fires first and reports which provider stalled. This one
   * is the backstop for everything else on that path — a Supabase insert, a
   * dynamic import, an adapter that never resolves.
   */
  private memoryTimeoutMs(): number {
    const parsed = parseInt(process.env.HEIDI_MEMORY_TIMEOUT_MS || '', 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 20000;
  }

  /**
   * Run a promise with a hard deadline, returning `fallback` if it overruns.
   *
   * The cognitive loop is only "bounded" if every await inside it is bounded.
   * Wrapping the call in try/catch is not enough: a promise that never settles
   * never throws, so the catch never runs and the cycle hangs forever. This is
   * not hypothetical — Ollama's model runner can wedge while its metadata
   * endpoints keep answering instantly, and an unbounded embeddings call then
   * stalls every cycle indefinitely.
   *
   * The losing promise is explicitly swallowed so a late rejection does not
   * surface as an unhandled rejection after the cycle has moved on.
   */
  private async withDeadline<T>(
    work: Promise<T>,
    fallback: T,
    label: string,
    onTimeout?: (message: string) => void,
  ): Promise<T> {
    const timeoutMs = this.memoryTimeoutMs();
    let timer: NodeJS.Timeout | null = null;

    const timeout = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), timeoutMs);
    });

    try {
      const settled = await Promise.race([
        work.catch((err) => {
          throw err;
        }),
        timeout,
      ]);

      if (settled === TIMED_OUT) {
        // Detach the abandoned promise so its eventual rejection is not an
        // unhandled rejection in a cycle that already gave up on it.
        void work.catch(() => undefined);
        const message = `${label} exceeded ${timeoutMs}ms — continuing without it`;
        if (onTimeout) onTimeout(message);
        return fallback;
      }

      return settled as T;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ─── Contract layer ───────────────────────────────────────────────────

  /**
   * The state snapshot the authority function reasons over. Deliberately
   * conservative where HYDI does not actually know the answer: an unknown
   * environment is not assumed to be development.
   */
  private contractState(state?: CognitiveState | null): SystemStateSnapshot {
    const env = process.env.NODE_ENV;
    const environment: SystemStateSnapshot['environment'] =
      env === 'production' ? 'production'
        : env === 'test' || env === 'development' ? 'development'
          : 'unknown';

    const perception = state?.perception ?? null;
    const degradedComponents = (perception?.components ?? [])
      .filter((c) => c.status !== 'healthy' && c.status !== 'ok')
      .map((c) => c.name);

    const healthScore =
      perception === null ? 0.5
        : perception.systemHealth === 'healthy' ? 1
          : perception.systemHealth === 'degraded' ? 0.5
            : perception.systemHealth === 'failed' ? 0.1
              : 0.5;

    return {
      at: new Date().toISOString(),
      environment,
      // The loop runs unattended by construction. Claiming a human is present
      // would let the authority function assume an approval that nobody is
      // there to give.
      humanPresent: false,
      healthScore,
      degradedComponents,
      incidentActive:
        perception?.systemHealth === 'degraded' || perception?.systemHealth === 'failed',
      armedInterlocks: [],
      extra: {},
    };
  }

  /** The contract registered for a capability, if its verification has been migrated. */
  getContract(capabilityId: string): CapabilityContract | null {
    return this.contracts.get(capabilityId);
  }

  getContractRegistry(): ContractRegistry {
    return this.contracts;
  }

  /**
   * Migration status: which capabilities verify from a contract, which still
   * fall through to the legacy chain, and which contracts have no observer
   * and would therefore report `unverifiable` at run time.
   */
  contractCoverage(): {
    mode: 'advisory' | 'enforcing';
    contracted: string[];
    legacyFallback: string[];
    unobservable: string[];
  } {
    const contracted = this.contracts.list().map((c) => c.identity.id);
    const legacyFallback = this.registry
      .listAll()
      .map((c) => c.capabilityId)
      .filter((id) => contracted.indexOf(id) === -1);

    return {
      mode: this.contractAuthorityMode,
      contracted,
      legacyFallback,
      unobservable: this.contracts.unobservable().map((u) => u.capabilityId),
    };
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
      // The inverse of create_task. Registering it is what makes create_task's
      // reversibility claim true rather than aspirational — an undo nobody
      // wired up is not an undo.
      this.wireExecutor('tool.cancel_task', async (params, ctx) => this.executeViaActionExecutor(ae, 'cancel_task', params, ctx));
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

    // RevenuePipeline capabilities (ProspectPipeline)
    if (this.bridge.revenuePipeline) {
      const pipeline = this.bridge.revenuePipeline;
      this.wireExecutor('revenue.identify_prospect', async (params) => {
        const companyName = params.companyName as string;
        if (!companyName) return this.failResult('revenue.identify_prospect', 'Missing required param: companyName');
        const source = (params.source as string) || 'manual_entry';
        const result = await pipeline.identifyProspect({
          companyName,
          contactName: params.contactName as string | null | undefined,
          contactEmail: params.contactEmail as string | null | undefined,
          source: source as never,
          metadata: params.metadata as Record<string, unknown> | undefined,
        });
        return {
          capabilityId: 'revenue.identify_prospect',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ prospect: result }],
          verified: false, // verification re-reads the prospect
          verificationDetails: 'Pending re-read of prospect',
        };
      });
      this.wireExecutor('revenue.score_prospect', async (params) => {
        const prospectId = params.prospectId as string;
        if (!prospectId) return this.failResult('revenue.score_prospect', 'Missing required param: prospectId');
        const result = await pipeline.scoreProspect(prospectId);
        return {
          capabilityId: 'revenue.score_prospect',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ prospectId, score: result.score, factors: result.factors }],
          verified: typeof result.score === 'number',
          verificationDetails: typeof result.score === 'number' ? 'Score is numeric' : 'Score is not numeric',
        };
      });
      this.wireExecutor('revenue.update_prospect_status', async (params) => {
        const prospectId = params.prospectId as string;
        const newStatus = params.newStatus as string;
        if (!prospectId || !newStatus) return this.failResult('revenue.update_prospect_status', 'Missing required param: prospectId or newStatus');
        const result = await pipeline.updateStatus(prospectId, newStatus, params.context as Record<string, unknown> | undefined);
        return {
          capabilityId: 'revenue.update_prospect_status',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ prospectId, newStatus, result }],
          verified: false, // verification re-reads the prospect
          verificationDetails: 'Pending re-read of prospect status',
        };
      });
      this.wireExecutor('revenue.create_opportunity', async (params) => {
        const prospectId = params.prospectId as string;
        const offerId = params.offerId as string;
        if (!prospectId) return this.failResult('revenue.create_opportunity', 'Missing required param: prospectId');
        if (!offerId) return this.failResult('revenue.create_opportunity', 'Missing required param: offerId');

        // Default proposedPrice and estimatedValue from the offer catalog
        // when not explicitly provided by the caller.
        let proposedPrice = params.proposedPrice as number | undefined;
        let estimatedValue = params.estimatedValue as number | undefined;
        let probability = params.probability as number | undefined;
        if (proposedPrice === undefined || estimatedValue === undefined) {
          const offer = getOfferCatalog().get(offerId as never);
          if (offer) {
            if (proposedPrice === undefined) proposedPrice = offer.setupPrice;
            if (estimatedValue === undefined) estimatedValue = offer.setupPrice + offer.recurringPrice * 12;
          }
        }
        // Default probability from ICP score if not provided
        if (probability === undefined) {
          const prospect = await pipeline.getProspect(prospectId);
          if (prospect) {
            probability = 0.3 + (prospect.icpScore / 100) * 0.4;
          }
        }

        const result = await pipeline.createOpportunity({
          prospectId,
          offerId: offerId as never,
          proposedPrice,
          estimatedValue,
          probability,
          expectedCloseDate: params.expectedCloseDate as string | undefined,
        });
        return {
          capabilityId: 'revenue.create_opportunity',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ opportunity: result }],
          verified: false, // verification re-reads the opportunity
          verificationDetails: 'Pending re-read of opportunity',
        };
      });
      this.wireExecutor('revenue.pipeline_metrics', async () => {
        const result = await pipeline.getPipelineMetrics();
        return {
          capabilityId: 'revenue.pipeline_metrics',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ metrics: result }],
          verified: true,
          verificationDetails: 'Pipeline metrics returned',
        };
      });
    }

    // RevenueLifecycle capabilities (CustomerLifecycle)
    if (this.bridge.revenueLifecycle) {
      const lifecycle = this.bridge.revenueLifecycle;
      this.wireExecutor('revenue.start_onboarding', async (params) => {
        const customerId = params.customerId as string;
        const offerId = params.offerId as string;
        if (!customerId) return this.failResult('revenue.start_onboarding', 'Missing required param: customerId');
        if (!offerId) return this.failResult('revenue.start_onboarding', 'Missing required param: offerId');
        const result = await lifecycle.startOnboarding({
          customerId,
          offerId: offerId as never,
          stripeCustomerId: params.stripeCustomerId as string | undefined,
          configuration: params.configuration as Record<string, unknown> | undefined,
        });
        return {
          capabilityId: 'revenue.start_onboarding',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ onboarding: result }],
          verified: false, // verification re-reads the service record
          verificationDetails: 'Pending re-read of service record',
        };
      });
      this.wireExecutor('revenue.activate_service', async (params) => {
        const serviceId = params.serviceId as string;
        if (!serviceId) return this.failResult('revenue.activate_service', 'Missing required param: serviceId');
        const result = await lifecycle.activateService(serviceId);
        return {
          capabilityId: 'revenue.activate_service',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ serviceId, service: result }],
          verified: false, // verification re-reads the service
          verificationDetails: 'Pending re-read of service status',
        };
      });
      this.wireExecutor('revenue.verify_service', async (params) => {
        const serviceId = params.serviceId as string;
        if (!serviceId) return this.failResult('revenue.verify_service', 'Missing required param: serviceId');
        const result = await lifecycle.verifyService(serviceId);
        return {
          capabilityId: 'revenue.verify_service',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ serviceId, verified: result.verified, details: result.details }],
          verified: result.verified,
          verificationDetails: result.result,
        };
      });
    }

    // RevenueLedger capabilities (RevenueLedger)
    if (this.bridge.revenueLedger) {
      const ledger = this.bridge.revenueLedger;
      this.wireExecutor('revenue.get_verified_revenue', async () => {
        const result = await ledger.getVerifiedRevenue();
        const entries = Array.isArray(result) ? result : [];
        return {
          capabilityId: 'revenue.get_verified_revenue',
          executed: true,
          outcome: 'success' as const,
          result: entries,
          error: null,
          evidence: [{ entryCount: entries.length }],
          verified: Array.isArray(result),
          verificationDetails: Array.isArray(result) ? `${entries.length} verified ledger entries returned` : 'Invalid result',
        };
      });
      this.wireExecutor('revenue.get_revenue_summary', async () => {
        const result = await ledger.getRevenueSummary();
        return {
          capabilityId: 'revenue.get_revenue_summary',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ summary: result }],
          verified: true,
          verificationDetails: 'Revenue summary returned',
        };
      });
    }

    // CommercialWorkflow capabilities
    if (this.bridge.commercialWorkflow) {
      const cw = this.bridge.commercialWorkflow;
      this.wireExecutor('commercial.get_state', async () => {
        const result = await cw.getState();
        return {
          capabilityId: 'commercial.get_state',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ state: result }],
          verified: true,
          verificationDetails: 'Commercial workflow state returned',
        };
      });
      this.wireExecutor('commercial.discover_prospects', async (params) => {
        const result = await cw.discoverProspects({
          industry: params.industry as string | undefined,
          location: params.location as string | undefined,
          maxResults: params.maxResults as number | undefined,
        });
        return {
          capabilityId: 'commercial.discover_prospects',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ discovered: result }],
          verified: true,
          verificationDetails: 'Discovery result returned',
        };
      });
      this.wireExecutor('commercial.ingest_prospect', async (params) => {
        const result = await cw.ingestProspect(params.discovered as Record<string, unknown> as any);
        return {
          capabilityId: 'commercial.ingest_prospect',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ prospect: result }],
          verified: true,
          verificationDetails: 'Prospect ingested',
        };
      });
      this.wireExecutor('commercial.create_opportunity', async (params) => {
        const result = await cw.createOpportunityForProspect(
          params.prospectId as string,
          params.offerId as string | undefined,
        );
        return {
          capabilityId: 'commercial.create_opportunity',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ opportunity: result }],
          verified: !!result,
          verificationDetails: result ? 'Opportunity created' : 'No opportunity created (prospect not qualified)',
        };
      });
      this.wireExecutor('commercial.prepare_outreach', async (params) => {
        // Load prospect and opportunity by ID from the pipeline so they
        // are properly typed ProspectRecord/OpportunityRecord objects
        // (with camelCase fields), not raw snake_case DB rows.
        const pipeline = this.bridge.revenuePipeline;
        const prospectId = params.prospectId as string | undefined;
        const opportunityId = params.opportunityId as string | undefined;

        let prospect = params.prospect as ProspectRecord | undefined;
        let opportunity = params.opportunity as OpportunityRecord | undefined;

        if (pipeline && prospectId) {
          const loaded = await pipeline.getProspect(prospectId);
          if (loaded) prospect = loaded;
        }
        if (pipeline && opportunityId) {
          const loaded = await pipeline.getOpportunity(opportunityId);
          if (loaded) opportunity = loaded;
        }

        if (!prospect) {
          return this.failResult('commercial.prepare_outreach', 'Missing required param: prospect or prospectId (could not load from pipeline)');
        }
        if (!opportunity) {
          return this.failResult('commercial.prepare_outreach', 'Missing required param: opportunity or opportunityId (could not load from pipeline)');
        }

        const draft = cw.prepareOutreachDraft(
          prospect,
          opportunity,
          params.offerId as string,
          params.cognitiveCycleId as string,
          params.goalId as string,
        );
        return {
          capabilityId: 'commercial.prepare_outreach',
          executed: true,
          outcome: 'success' as const,
          result: draft,
          error: null,
          evidence: [{ draftId: (draft as any)?.draftId }],
          verified: !!draft,
          verificationDetails: 'Outreach draft prepared',
        };
      });
      this.wireExecutor('commercial.create_authorization_package', async (params) => {
        // Load prospect and opportunity by ID from the pipeline so they
        // are properly typed objects (with camelCase fields).
        const pipeline = this.bridge.revenuePipeline;
        const prospectId = params.prospectId as string | undefined;
        const opportunityId = params.opportunityId as string | undefined;

        let prospect = params.prospect as ProspectRecord | undefined;
        let opportunity = params.opportunity as OpportunityRecord | undefined;

        if (pipeline && prospectId) {
          const loaded = await pipeline.getProspect(prospectId);
          if (loaded) prospect = loaded;
        }
        if (pipeline && opportunityId) {
          const loaded = await pipeline.getOpportunity(opportunityId);
          if (loaded) opportunity = loaded;
        }

        if (!prospect) {
          return this.failResult('commercial.create_authorization_package', 'Missing required param: prospect or prospectId');
        }
        if (!opportunity) {
          return this.failResult('commercial.create_authorization_package', 'Missing required param: opportunity or opportunityId');
        }

        const pkg = cw.createAuthorizationPackage(
          prospect,
          opportunity,
          params.draft as any,
          params.goalId as string,
          params.cognitiveCycleId as string,
        );
        return {
          capabilityId: 'commercial.create_authorization_package',
          executed: true,
          outcome: 'success' as const,
          result: pkg,
          error: null,
          evidence: [{ packageId: (pkg as any)?.packageId }],
          verified: !!pkg,
          verificationDetails: 'Authorization package created',
        };
      });
      this.wireExecutor('commercial.verify_revenue', async () => {
        const result = await cw.verifyRevenue();
        return {
          capabilityId: 'commercial.verify_revenue',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ verifiedRevenueCents: (result as any)?.verifiedRevenueCents }],
          verified: true,
          verificationDetails: 'Revenue verified from RevenueLedger',
        };
      });
    }

    // ─── Self-Sufficiency capabilities ────────────────────────────────
    // CapabilityHealthManager: "What can I do right now?"
    if (this.bridge.capabilityHealthManager) {
      const chm = this.bridge.capabilityHealthManager;
      this.wireExecutor('self_sufficiency.check_all_capabilities', async () => {
        const summary = await chm.checkAll();
        return {
          capabilityId: 'self_sufficiency.check_all_capabilities',
          executed: true,
          outcome: 'success' as const,
          result: summary,
          error: null,
          evidence: [{ summary }],
          verified: true,
          verificationDetails: 'Capability health summary returned with evidence',
        };
      });
      this.wireExecutor('self_sufficiency.check_capability', async (params) => {
        const capabilityId = params.capabilityId as string;
        if (!capabilityId) return this.failResult('self_sufficiency.check_capability', 'Missing required param: capabilityId');
        const report = await chm.checkCapability(capabilityId);
        return {
          capabilityId: 'self_sufficiency.check_capability',
          executed: true,
          outcome: 'success' as const,
          result: report,
          error: null,
          evidence: [{ report }],
          verified: !!report,
          verificationDetails: report ? `Capability ${capabilityId} state: ${(report as any)?.state}` : 'Capability not found',
        };
      });
      this.wireExecutor('self_sufficiency.get_ready_capabilities', async () => {
        const ready = chm.getReadyCapabilities();
        return {
          capabilityId: 'self_sufficiency.get_ready_capabilities',
          executed: true,
          outcome: 'success' as const,
          result: ready,
          error: null,
          evidence: [{ count: Array.isArray(ready) ? ready.length : 0 }],
          verified: true,
          verificationDetails: `${Array.isArray(ready) ? ready.length : 0} READY capabilities`,
        };
      });
    }

    // BlockerResolutionEngine: classify and resolve blockers
    if (this.bridge.blockerResolutionEngine) {
      const bre = this.bridge.blockerResolutionEngine;
      this.wireExecutor('self_sufficiency.resolve_blockers', async (params) => {
        const reports = params.reports as unknown[];
        if (!Array.isArray(reports)) return this.failResult('self_sufficiency.resolve_blockers', 'Missing required param: reports');
        const result = await bre.resolveBlockers(reports as any, params.options as any);
        return {
          capabilityId: 'self_sufficiency.resolve_blockers',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ result }],
          verified: true,
          verificationDetails: 'Blocker resolution result returned',
        };
      });
    }

    // SelfRepairEngine: governed autonomous self-repair
    if (this.bridge.selfRepairEngine) {
      const sre = this.bridge.selfRepairEngine;
      this.wireExecutor('self_sufficiency.run_self_repair', async (params) => {
        const healthSummary = params.healthSummary;
        if (!healthSummary) return this.failResult('self_sufficiency.run_self_repair', 'Missing required param: healthSummary');
        const result = await sre.runSelfRepair(healthSummary as any, params.options as any);
        return {
          capabilityId: 'self_sufficiency.run_self_repair',
          executed: true,
          outcome: 'success' as const,
          result,
          error: null,
          evidence: [{ result }],
          verified: true,
          verificationDetails: 'Self-repair cycle completed',
        };
      });
      this.wireExecutor('self_sufficiency.get_repair_history', async () => {
        const history = sre.getHistory();
        return {
          capabilityId: 'self_sufficiency.get_repair_history',
          executed: true,
          outcome: 'success' as const,
          result: history,
          error: null,
          evidence: [{ count: Array.isArray(history) ? history.length : 0 }],
          verified: true,
          verificationDetails: `${Array.isArray(history) ? history.length : 0} repair records`,
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

    // Executive self-diagnostic — always wired: it reads durable state via
    // this.pool/goals/registry, so it works even when optional subsystems
    // (OperationalIntelligence, comms) are absent.
    this.wireExecutor('ops.executive_diagnostic', async () => {
      const report = await collectExecutiveDiagnostic({
        pool: this.pool,
        goals: this.goals,
        registry: this.registry,
        repoDir: process.cwd(),
      });
      const inserted = await this.pool.query<{ id: string }>(
        `INSERT INTO heidi_events (event_type, division, payload, verdict, created_at)
         VALUES ($1, $2, $3, $4, now()) RETURNING id`,
        ['executive_diagnostic', 'heidi', JSON.stringify(report), report.overall],
      );
      const reportId = inserted.rows[0]?.id ?? null;
      return {
        capabilityId: 'ops.executive_diagnostic',
        executed: reportId !== null,
        outcome: reportId !== null ? 'success' as const : 'failure' as const,
        result: { reportId, overall: report.overall, dimensions: report.dimensions.length, generatedAt: report.generatedAt },
        error: reportId === null ? 'heidi_events insert returned no id' : null,
        evidence: [{ overall: report.overall, generatedAt: report.generatedAt }],
        verified: false, // contract verification re-reads the row
        verificationDetails: 'Pending contract verification of persisted diagnostic row',
      };
    });

    // Diagnostic follow-up — investigates the findings the executive
    // diagnostic surfaced. Investigates, never repairs.
    this.wireExecutor('ops.diagnostic_followup', async () => {
      const report = await collectDiagnosticFollowup({
        pool: this.pool,
        repoDir: process.cwd(),
      });
      const inserted = await this.pool.query<{ id: string }>(
        `INSERT INTO heidi_events (event_type, division, payload, verdict, created_at)
         VALUES ($1, $2, $3, $4, now()) RETURNING id`,
        ['diagnostic_followup', 'heidi', JSON.stringify(report), report.verdict],
      );
      const reportId = inserted.rows[0]?.id ?? null;
      return {
        capabilityId: 'ops.diagnostic_followup',
        executed: reportId !== null,
        outcome: reportId !== null ? 'success' as const : 'failure' as const,
        result: {
          reportId,
          verdict: report.verdict,
          findings: report.findings.length,
          humanRequired: report.findings.filter((f) => f.humanRequired).length,
          diagnosticEventId: report.diagnosticEventId,
        },
        error: reportId === null ? 'heidi_events insert returned no id' : null,
        evidence: [{ verdict: report.verdict, findingCount: report.findings.length }],
        verified: false, // contract verification re-reads the row
        verificationDetails: 'Pending contract verification of persisted follow-up row',
      };
    });

    // Bounded investigation of one diagnostic dimension — the execution
    // target for finding-generated missions. Investigates; never repairs.
    this.wireExecutor('ops.investigate_finding', async (params) => {
      const dimension = params.dimension as string | undefined;
      const taskTemplate = params.taskTemplate as string | undefined;
      if (!dimension || !taskTemplate) {
        return this.failResult('ops.investigate_finding', 'Missing required param: dimension/taskTemplate');
      }
      const finding = await investigateDimension(
        { pool: this.pool, repoDir: process.cwd() },
        dimension,
      );
      const inserted = await this.pool.query<{ id: string }>(
        `INSERT INTO heidi_events (event_type, division, payload, verdict, created_at)
         VALUES ($1, $2, $3, $4, now()) RETURNING id`,
        [
          'investigation',
          'heidi',
          JSON.stringify({
            dimension,
            taskTemplate,
            diagnosticEventId: params.diagnosticEventId ?? null,
            investigationOnly: true,
            noRepairAuthorized: true,
            finding,
          }),
          finding.severity,
        ],
      );
      const reportId = inserted.rows[0]?.id ?? null;
      return {
        capabilityId: 'ops.investigate_finding',
        executed: reportId !== null,
        outcome: reportId !== null ? 'success' as const : 'failure' as const,
        result: {
          reportId,
          dimension,
          severity: finding.severity,
          suggestedFollowup: finding.suggestedFollowup,
          humanRequired: finding.humanRequired,
        },
        error: reportId === null ? 'heidi_events insert returned no id' : null,
        evidence: [{ dimension, severity: finding.severity }],
        verified: false, // contract verification re-reads the row
        verificationDetails: 'Pending contract verification of persisted investigation row',
      };
    });

    // Deployment reconciliation — observational only. Proves whether the
    // PM2-tracked process is the same process actually executing cycles.
    // Never kills, never steals the lock, never writes qualified-deployment.
    this.wireExecutor('ops.reconcile_deployment', async () => {
      const report = await collectReconciliation({
        pool: this.pool,
        repoDir: process.cwd(),
      });
      const verdictMap: Record<string, string> = {
        QUALIFIED: 'HEALTHY',
        DEPLOYMENT_DRIFT: 'DEGRADED',
        UNKNOWN: 'UNKNOWN',
      };
      const inserted = await this.pool.query<{ id: string }>(
        `INSERT INTO heidi_events (event_type, division, payload, verdict, created_at)
         VALUES ($1, $2, $3, $4, now()) RETURNING id`,
        ['deployment_reconciliation', 'heidi', JSON.stringify(report), verdictMap[report.verdict] ?? 'UNKNOWN'],
      );
      const reportId = inserted.rows[0]?.id ?? null;
      return {
        capabilityId: 'ops.reconcile_deployment',
        executed: reportId !== null,
        outcome: reportId !== null ? 'success' as const : 'failure' as const,
        result: {
          reportId,
          verdict: report.verdict,
          deploymentIdentity: report.deploymentIdentity,
          applicationHealth: report.applicationHealth,
          failures: report.failures,
        },
        error: reportId === null ? 'heidi_events insert returned no id' : null,
        evidence: [{ verdict: report.verdict, failures: report.failures }],
        verified: false, // contract verification re-reads the row
        verificationDetails: 'Pending contract verification of persisted reconciliation row',
      };
    });

    // R0 self-repair: daemon-unavailable → canonical pm2 restart →
    // post-recovery reconciliation. Observational refusals dominate:
    // anything that is not a proven dead daemon is NO_ACTION or
    // HUMAN_REQUIRED. Never kills, never steals the lock.
    this.wireExecutor('ops.recover_daemon_r0', async () => {
      const report = await runR0Recovery({ pool: this.pool, repoDir: process.cwd() });
      return {
        capabilityId: 'ops.recover_daemon_r0',
        executed: report.attemptRowId !== null,
        outcome: report.attemptRowId !== null ? 'success' as const : 'failure' as const,
        result: {
          reportId: report.attemptRowId,
          recoveryId: report.recoveryId,
          state: report.state,
          failureClass: report.failureClass,
          action: report.action,
          detail: report.detail,
        },
        error: report.attemptRowId === null ? 'recovery attempt row not persisted' : null,
        evidence: [{ state: report.state, detail: report.detail }],
        verified: false, // contract verification re-reads the row
        verificationDetails: 'Pending contract verification of persisted recovery attempt',
      };
    });

    // COO state — the authoritative cross-domain snapshot. Read-only;
    // derives the next authorized action deterministically from collected
    // state. Never repairs, never approves, never manufactures work.
    this.wireExecutor('ops.coo_state', async () => {
      const state = await collectCooState({ pool: this.pool, repoDir: process.cwd() });
      const verdict =
        state.deployment.identity === 'VALID' && state.applicationHealth === 'HEALTHY' ? 'HEALTHY'
          : state.deployment.identity === 'INVALID' ? 'DEGRADED'
            : state.deployment.identity === 'UNPROVEN' ? 'UNKNOWN'
              : 'DEGRADED';
      const inserted = await this.pool.query<{ id: string }>(
        `INSERT INTO heidi_events (event_type, division, payload, verdict, created_at)
         VALUES ($1, $2, $3, $4, now()) RETURNING id`,
        ['coo_state', 'heidi', JSON.stringify(state), verdict],
      );
      const reportId = inserted.rows[0]?.id ?? null;
      return {
        capabilityId: 'ops.coo_state',
        executed: reportId !== null,
        outcome: reportId !== null ? 'success' as const : 'failure' as const,
        result: {
          reportId,
          verdict,
          nextAction: state.nextAction,
          briefing: state.briefing,
        },
        error: reportId === null ? 'heidi_events insert returned no id' : null,
        evidence: [{ verdict, nextAction: state.nextAction }],
        verified: false, // contract verification re-reads the row
        verificationDetails: 'Pending contract verification of persisted coo_state row',
      };
    });

    // Governed human-action acknowledgement — records a durable ack for
    // one normalized queue item. Write of the ack record only: never
    // executes, never authorizes, never mutates the underlying source.
    // Idempotent on repeat; fail-closed on missing/expired items.
    this.wireExecutor('ops.acknowledge_human_action', async (params) => {
      const queueItemId = typeof params?.queueItemId === 'string' ? params.queueItemId : null;
      const actor = typeof params?.actor === 'string' ? params.actor : 'operator';
      if (!queueItemId) {
        return {
          capabilityId: 'ops.acknowledge_human_action',
          executed: false,
          outcome: 'failure' as const,
          result: null,
          error: 'capabilityParams.queueItemId required',
          evidence: [],
          verified: false,
          verificationDetails: 'Missing queueItemId',
        };
      }
      const res = await acknowledgeHumanAction(this.pool, queueItemId, actor);
      return {
        capabilityId: 'ops.acknowledge_human_action',
        executed: res.ok,
        outcome: res.ok ? 'success' as const : 'failure' as const,
        result: {
          acknowledgementId: res.acknowledgementId ?? null,
          queueItemId: res.queueItemId ?? queueItemId,
          outcome: res.outcome,
          reason: res.reason ?? null,
        },
        error: res.ok ? null : (res.reason ?? 'acknowledgement refused'),
        evidence: [{ outcome: res.outcome, queueItemId }],
        verified: false,
        verificationDetails: res.ok
          ? 'Pending contract verification of persisted human_action_ack row'
          : 'Refused before write — nothing to verify',
      };
    });

    // Bounded multi-agent mission — currently one governed workload:
    // protoforge.investigate (research A ∥ research B → analyst C).
    // Agents are in-process bounded workers; all state is event-sourced.
    this.wireExecutor('ops.agent_mission', async (params) => {
      const opportunityId = typeof params?.opportunityId === 'string' ? params.opportunityId : null;
      const topic = typeof params?.topic === 'string' && params.topic.trim() ? params.topic.trim() : null;
      const selectTop = typeof params?.selectTop === 'number' && params.selectTop > 0 ? params.selectTop : null;
      if (topic) {
        // Free-form topic mission — the executive-loop path for
        // "investigate X" where X isn't a scouted opportunity.
        const res = await runTopicInvestigation(this.pool, topic, { pool: this.pool, repoDir: process.cwd() });
        return {
          capabilityId: 'ops.agent_mission',
          executed: true,
          outcome: res.refused ? 'failure' as const : 'success' as const,
          result: { parentMissionId: res.parentMissionId, missionEventId: res.missionEventId, spawned: res.spawned, topic },
          error: res.refused ?? null,
          evidence: [{ parentMissionId: res.parentMissionId }],
          verified: false,
          verificationDetails: 'Pending contract verification of persisted agent_mission row',
        };
      }
      if (selectTop !== null) {
        // Natural-objective path: investigate the top-ranked unreviewed
        // opportunities — deterministic selection, bounded count.
        const r = await runTopOpportunityInvestigation(this.pool, selectTop, { pool: this.pool, repoDir: process.cwd() });
        const last = r.parents[r.parents.length - 1];
        return {
          capabilityId: 'ops.agent_mission',
          executed: true,
          outcome: r.parents.length === 0 || r.parents.every((p) => p.refused) ? 'failure' as const : 'success' as const,
          result: {
            missionEventId: last?.missionEventId ?? null,
            parents: r.parents.map((p) => ({ missionId: p.parentMissionId, opportunity: p.title.slice(0, 60), spawned: p.spawned.length, refused: p.refused ?? null })),
            selected: r.selected,
          },
          error: r.parents.length === 0 ? 'no needs_review opportunities' : (r.parents.every((p) => p.refused) ? 'all investigations refused' : null),
          evidence: [{ parents: r.parents.map((p) => p.parentMissionId) }],
          verified: false,
          verificationDetails: last?.missionEventId ? 'Pending contract verification of persisted agent_mission row' : 'Nothing new persisted',
        };
      }
      if (!opportunityId) {
        return {
          capabilityId: 'ops.agent_mission',
          executed: false,
          outcome: 'failure' as const,
          result: null,
          error: 'capabilityParams.opportunityId or capabilityParams.selectTop required',
          evidence: [],
          verified: false,
          verificationDetails: 'Missing opportunityId/selectTop',
        };
      }
      const res = await runInvestigateMission(this.pool, opportunityId, { pool: this.pool, repoDir: process.cwd() });
      const spawned = res.spawned.length > 0;
      // Idempotent collapse returns missionEventId:null — the mission
      // already exists. Resolve THAT row's event id so contract
      // verification observes the durable record either way.
      let missionEventId = res.missionEventId;
      if (!missionEventId && res.parentMissionId) {
        missionEventId = await this.pool.query(
          `SELECT id FROM heidi_events WHERE event_type='agent_mission'
             AND payload->>'missionId'=$1 ORDER BY created_at ASC LIMIT 1`,
          [res.parentMissionId],
        ).then(x => (x.rows[0]?.id as string) ?? null).catch(() => null);
      }
      return {
        capabilityId: 'ops.agent_mission',
        executed: true,
        outcome: res.refused ? 'failure' as const : 'success' as const,
        result: {
          parentMissionId: res.parentMissionId,
          missionEventId,
          spawned: res.spawned,
          refused: res.refused ?? null,
        },
        error: res.refused ?? null,
        evidence: [{ parentMissionId: res.parentMissionId, spawned: res.spawned }],
        verified: false,
        verificationDetails: res.missionEventId
          ? 'Pending contract verification of persisted agent_mission row'
          : 'Mission already existed (idempotent collapse) — nothing new to verify',
      };
    });

    // Bounded dev patch — R2 autonomous code change. The mission/proposal
    // carries the exact patch; this executor applies verbatim, verifies
    // typecheck, commits once, and persists evidence. Never pushes,
    // never expands scope, never touches protected files.
    this.wireExecutor('ops.dev_patch', async (params) => {
      const { applyBoundedPatch } = await import('./DevPatchExecutor');
      const mission = {
        missionId: String(params?.missionId ?? params?.goalId ?? 'adhoc'),
        patches: (params?.patches ?? []) as Array<{ file: string; oldString: string; newString: string }>,
        commitMessage: String(params?.commitMessage ?? 'autonomous bounded change'),
        verify: Array.isArray(params?.verify) ? params.verify as string[] : undefined,
      };
      const r = await applyBoundedPatch(mission);
      const eventId = await this.pool.query(
        `INSERT INTO heidi_events (event_type, payload, created_at) VALUES ('dev_patch', $1, now()) RETURNING id`,
        [JSON.stringify({ missionId: mission.missionId, status: r.status, commitSha: r.commitSha ?? null, filesChanged: r.filesChanged, reason: r.reason ?? null })],
      ).then(x => x.rows[0].id as string).catch(() => null);
      return {
        capabilityId: 'ops.dev_patch',
        executed: r.ok,
        outcome: r.ok ? 'success' as const : 'failure' as const,
        result: { status: r.status, commitSha: r.commitSha ?? null, filesChanged: r.filesChanged, eventId },
        error: r.reason ?? null,
        evidence: r.evidence,
        verified: r.ok,
        verificationDetails: r.ok ? `committed ${r.commitSha}, tsc clean` : `not applied: ${r.reason}`,
      };
    });

    // Business context — R0: seed + refresh + retrieve the authoritative
    // business fact store. This is what makes briefings answer "why"
    // instead of only "what".
    this.wireExecutor('ops.business_context', async (params) => {
      const { BusinessContext } = await import('./BusinessContext');
      const bc = new BusinessContext(this.pool);
      await bc.ensure();
      await bc.refresh();
      const facts = await bc.getFacts(params?.kind as never);
      return {
        capabilityId: 'ops.business_context',
        executed: true,
        outcome: 'success' as const,
        result: { factCount: facts.length, kinds: [...new Set(facts.map(f => f.kind))], digest: await bc.digest() },
        error: null,
        evidence: [{ factCount: facts.length }],
        verified: facts.length > 0,
        verificationDetails: `${facts.length} business facts retrieved with provenance`,
      };
    });

    // Opportunity verdict — R0: folds durable mission evidence into a
    // typed business finding. A pending mission returns skipped so the
    // goal stays open and retries on the next cycle; anything else
    // persists a business_finding event the contract can re-read.
    this.wireExecutor('ops.opp_verdict', async (params) => {
      const opportunityId = String(params?.opportunityId ?? '');
      if (!opportunityId) return this.failResult('ops.opp_verdict', 'capabilityParams.opportunityId required');
      const { verdictForOpportunity } = await import('./OpportunityVerdict');
      const v = await verdictForOpportunity(this.pool, opportunityId);
      if (!v || v.verdict === 'MISSION_PENDING') {
        return {
          capabilityId: 'ops.opp_verdict', executed: true, outcome: 'skipped' as const,
          result: { verdict: v?.verdict ?? 'NO_MISSION' }, error: null, evidence: [],
          verified: false,
          verificationDetails: v ? `mission ${v.evidence.missionStatus ?? 'in flight'} — verdict waits` : 'no investigate mission for this opportunity',
        };
      }
      const eventId = await this.pool.query(
        `INSERT INTO heidi_events (event_type, payload, created_at) VALUES ('business_finding', $1, now()) RETURNING id`,
        [JSON.stringify({ opportunityId, ...v })],
      ).then(x => x.rows[0].id as string).catch(() => null);
      // Customer-validation bridge: a real finding structures a human
      // decision — never executes contact. The hypothesis lands in the
      // existing human queue; J's approve produces an authorized
      // experiment record, and only real evidence upgrades the finding.
      if (v.verdict === 'PARTIALLY_SUPPORTED' || v.verdict === 'CONFIRMED') {
        const { hypothesisFor, createHypothesisRecord } = await import('./CustomerValidation');
        await createHypothesisRecord(this.pool, opportunityId, hypothesisFor({ analystSummary: v.evidence.analystSummary, sourceCount: v.evidence.sourceCount, limitations: v.limitations })).catch(() => { });
      }
      return {
        capabilityId: 'ops.opp_verdict',
        executed: true,
        outcome: 'success' as const,
        result: { verdict: v.verdict, confidence: v.confidence, recommendedAction: v.recommendedAction, eventId },
        error: null,
        evidence: [v.evidence],
        verified: true,
        verificationDetails: `${v.verdict} (${v.confidence}) — ${v.limitations.slice(0, 80)}`,
      };
    });

    // Customer evidence intake — R0: records HUMAN-DECLARED evidence
    // only, requires an authorized experiment, and emits an updated
    // business_finding. CONFIRMED requires a real paid customer job —
    // declarations never reach it.
    this.wireExecutor('ops.opp_evidence', async (params) => {
      const opportunityId = String(params?.opportunityId ?? '');
      const channel = String(params?.channel ?? '');
      const summary = String(params?.summary ?? '');
      if (!opportunityId || !channel || !summary) {
        return this.failResult('ops.opp_evidence', 'capabilityParams require {opportunityId, channel, summary}');
      }
      const { authorizedExperiment, recordEvidence, hasRealPaidJob } = await import('./CustomerValidation');
      const exp = await authorizedExperiment(this.pool, opportunityId);
      if (!exp) {
        return {
          capabilityId: 'ops.opp_evidence', executed: false, outcome: 'failure' as const,
          result: null, error: 'no authorized validation experiment for this opportunity — human approval required first',
          evidence: [], verified: false,
          verificationDetails: 'Refused: customer evidence requires an approved hypothesis',
        };
      }
      const paid = await hasRealPaidJob(this.pool);
      const r = await recordEvidence(this.pool, opportunityId, {
        channel, summary, respondents: typeof params?.respondents === 'number' ? params.respondents : undefined,
        declaredBy: String(params?.declaredBy ?? 'human_operator'),
      }, paid);
      return {
        capabilityId: 'ops.opp_evidence',
        executed: true,
        outcome: 'success' as const,
        result: { eventId: r.eventId, verdict: r.verdict, findingId: r.findingId },
        error: null,
        evidence: [{ channel, paid }],
        verified: true,
        verificationDetails: `declared evidence recorded → ${r.verdict}${paid ? ' (real paid job)' : ' (declared, unverified)'}`,
      };
    });

    // ── Cognitive layer — reasoning/planning, all R0. Thought is not
    // authority: interpret/plan produce durable models and governed child
    // goals; the existing daemon executes each under standing policy.

    // ops.goal_interpret — free-text goal → typed goal model (facts,
    // assumptions, hypotheses, unknowns). Ollama proposes; the
    // deterministic envelope demotes model 'facts' without durable
    // provenance. Unreachable model → AI_UNAVAILABLE, never fabricated.
    this.wireExecutor('ops.goal_interpret', async (params) => {
      const goalText = String(params?.goal ?? '');
      if (!goalText) return this.failResult('ops.goal_interpret', 'capabilityParams.goal required');
      const { interpretGoal, persistGoalModel } = await import('./GoalInterpreter');
      const model = await interpretGoal(goalText, typeof params?.domainHint === 'string' ? params.domainHint : undefined);
      const goalModelId = await persistGoalModel(this.pool, goalText, model, 'governed-goal');
      // Chain the plan stage — a model without a plan isn't a result.
      let planGoalId: string | null = null;
      // Chain a plan even when the model is unavailable — the deterministic
      // composer can still decompose the raw objective; the plan event
      // labels it DETERMINISTIC_ONLY instead of hiding the AI outage.
      if (goalModelId) {
        const g = await this.pool.query(
          `INSERT INTO heidi_goals (title, goal_type, description, status, priority, success_criteria, context, created_at, updated_at)
           VALUES ($1,'task',$1,'active',5,'["plan event persisted with validated steps"]'::jsonb,$2,now(),now()) RETURNING id`,
          [`Plan: ${model.objective.slice(0, 90)}`,
          JSON.stringify({ capabilityId: 'ops.plan', capabilityParams: { goalModelId }, completeOnVerify: true, producedBy: 'goal_interpret' })],
        ).catch(() => null);
        planGoalId = g?.rows[0]?.id ?? null;
      }
      return {
        capabilityId: 'ops.goal_interpret', executed: true,
        outcome: 'success' as const,
        result: { goalModelId, planGoalId, aiStatus: model.aiStatus, objective: model.objective, kinds: model.knowledge.map(k => k.kind) },
        error: null, evidence: [model], verified: true,
        verificationDetails: model.aiStatus === 'ok' ? `goal model persisted (${model.knowledge.length} typed statements)` : 'AI_UNAVAILABLE — goal model persisted as unknown, no fabrication',
      };
    });

    // ops.plan — goal model → validated ordered steps → governed child
    // goals. Validator rejects unknown capabilities and marks anything
    // above R2 human_required — a step the model invents never executes.
    this.wireExecutor('ops.plan', async (params) => {
      const goalModelId = String(params?.goalModelId ?? '');
      if (!goalModelId) return this.failResult('ops.plan', 'capabilityParams.goalModelId required');
      const { proposePlan, validateSteps, deterministicPlan, materializePlan, relevantLessons } = await import('./Planner');
      const mRow = await this.pool.query(
        `SELECT payload FROM heidi_events WHERE id=$1 AND event_type='goal_model'`,
        [goalModelId]).catch(() => ({ rows: [] as Array<{ payload: unknown }> }));
      if (!mRow.rows[0]) return this.failResult('ops.plan', `goal model ${goalModelId} not found`);
      const model = mRow.rows[0].payload as import('./GoalInterpreter').GoalModel & { goal?: string };
      const lessons = await relevantLessons(this.pool, model.objective);
      const proposed = await proposePlan(model, lessons);
      const aiStatus = proposed ? 'ok' as const : 'DETERMINISTIC_ONLY' as const;
      const steps = validateSteps(proposed ?? deterministicPlan(model));
      const planId = `plan-${goalModelId.slice(0, 8)}-${Date.now().toString(36)}`;
      const { planEventId, childGoalIds } = await materializePlan(this.pool, planId, goalModelId, model, steps, aiStatus);
      return {
        capabilityId: 'ops.plan', executed: true, outcome: 'success' as const,
        result: {
          planEventId, childGoalIds, lessonsUsed: lessons.length,
          executable: steps.filter(s => s.status === 'executable').length,
          humanRequired: steps.filter(s => s.status === 'human_required').length,
          rejected: steps.filter(s => s.status === 'rejected').length,
        },
        error: null, evidence: [steps], verified: true,
        verificationDetails: `plan persisted: ${childGoalIds.length} executable child goal(s), ${steps.filter(s => s.status !== 'executable').length} gated`,
      };
    });

    // ops.world_assert — typed world-model assertion; contradiction
    // produces belief_revision, never silent overwrite.
    this.wireExecutor('ops.world_assert', async (params) => {
      const subject = String(params?.subject ?? '');
      const predicate = String(params?.predicate ?? '');
      const value = String(params?.value ?? '');
      if (!subject || !predicate || !value) {
        return this.failResult('ops.world_assert', 'capabilityParams require {subject, predicate, value}');
      }
      const { assertWorld, worldState, reviseBelief } = await import('./WorldAssertions');
      const prior = await worldState(this.pool, subject);
      const conflict = prior.find(a => a.predicate === predicate && a.value !== value);
      const assertionId = await assertWorld(this.pool, {
        kind: (['fact', 'belief', 'hypothesis', 'unknown'] as const).includes(params?.kind as 'fact') ? params.kind as 'fact' | 'belief' | 'hypothesis' | 'unknown' : 'unknown',
        subject, predicate, value,
        provenance: String(params?.provenance ?? 'human:operator'),
        confidence: typeof params?.confidence === 'number' ? params.confidence : undefined,
        falsification: typeof params?.falsification === 'string' ? params.falsification : undefined,
        reason: typeof params?.reason === 'string' ? params.reason : undefined,
      });
      let revisionId: string | null = null;
      if (conflict && assertionId) {
        revisionId = await reviseBelief(this.pool, conflict.id, 'refuted', assertionId, `contradicted by new assertion ${assertionId.slice(0, 8)}`);
      }
      return {
        capabilityId: 'ops.world_assert', executed: true, outcome: 'success' as const,
        result: { assertionId, revisionId, contradicted: !!conflict },
        error: null, evidence: [{ subject, predicate }], verified: true,
        verificationDetails: conflict ? `assertion persisted + prior ${conflict.id.slice(0, 8)} marked refuted — both survive` : 'assertion persisted',
      };
    });

    // ops.model_catalog — discover local Ollama models, persist catalog.
    this.wireExecutor('ops.model_catalog', async () => {
      const res = await fetch(`${process.env.OLLAMA_URL || 'http://localhost:11434'}/api/tags`, { signal: AbortSignal.timeout(10000) }).catch(() => null);
      if (!res || !res.ok) {
        return { capabilityId: 'ops.model_catalog', executed: false, outcome: 'failure' as const, result: null, error: 'AI_UNAVAILABLE: ollama unreachable', evidence: [], verified: false, verificationDetails: 'catalog not persisted — no local model list' };
      }
      const data = await res.json() as { models?: Array<{ name: string; size: number; details?: { family?: string; parameter_size?: string } }> };
      const models = (data.models ?? []).map(m => ({ name: m.name, sizeBytes: m.size, params: m.details?.parameter_size ?? null, family: m.details?.family ?? null }));
      const ev = await this.pool.query(
        `INSERT INTO heidi_events (event_type, payload, created_at) VALUES ('model_catalog', $1, now()) RETURNING id`,
        [JSON.stringify({ models, at: new Date().toISOString() })],
      ).catch(() => null);
      return {
        capabilityId: 'ops.model_catalog', executed: true, outcome: 'success' as const,
        result: { eventId: ev?.rows[0]?.id ?? null, count: models.length, names: models.map(m => m.name) },
        error: null, evidence: models, verified: true,
        verificationDetails: `${models.length} local model(s) cataloged`,
      };
    });

    // Dev signal observer — R0 read-only. Deterministic scan for
    // development findings; each becomes an investigation goal (R0).
    this.wireExecutor('ops.dev_observe', async () => {
      const { observeDevelopmentSignals } = await import('./DevObserver');
      const findings = await observeDevelopmentSignals(this.pool);
      let goalsCreated = 0;
      for (const f of findings.slice(0, 5)) {
        try {
          // Dedupe: an open investigation goal for the same target+question
          // already carries the work — recreating it every scan floods the queue.
          const dup = await this.pool.query(
            `SELECT id FROM heidi_goals WHERE status IN ('pending','active','in_progress','blocked')
               AND context->>'capabilityId' = 'ops.dev_investigate'
               AND context->>'target' = $1 AND context->>'question' = $2 LIMIT 1`,
            [f.target, f.question],
          );
          if (dup.rows.length > 0) continue;
          await this.pool.query(
            `INSERT INTO heidi_goals (title, goal_type, description, status, priority, success_criteria, context, created_at, updated_at)
             VALUES ($1, 'task', $1, 'active', 5, '["investigation reaches a persisted conclusion"]'::jsonb, $2, now(), now())`,
            [`Investigate: ${f.question.slice(0, 140)}`,
            JSON.stringify({ capabilityId: 'ops.dev_investigate', findingType: f.findingType, target: f.target, question: f.question, initialObservation: f.initialObservation, suspectedFiles: f.suspectedFiles, severity: f.severity })],
          );
          goalsCreated++;
        } catch { /* duplicate/pool issue — skip */ }
      }
      const eventId = await this.pool.query(
        `INSERT INTO heidi_events (event_type, payload, created_at) VALUES ('dev_observation', $1, now()) RETURNING id`,
        [JSON.stringify({ findings: findings.length, goalsCreated, types: findings.map(f => f.findingType) })],
      ).then(x => x.rows[0].id as string).catch(() => null);
      return {
        capabilityId: 'ops.dev_observe',
        executed: true,
        outcome: 'success' as const,
        result: { findings: findings.length, goalsCreated, types: findings.map(f => f.findingType), eventId },
        error: null,
        evidence: [{ findings }],
        verified: true,
        verificationDetails: `${findings.length} finding(s) observed, ${goalsCreated} investigation goal(s) created`,
      };
    });

    // Dev investigation — R0 read-only. Counterexample-first: a finding is
    // a hypothesis until the evidence survives attempts to disprove it.
    // CONFIRMED_DEFECT creates a dev mission (ops.dev_author) as a goal;
    // NOT_A_DEFECT / INSUFFICIENT stop honestly.
    this.wireExecutor('ops.dev_investigate', async (params) => {
      const { investigateFinding } = await import('./DevInvestigator');
      const rec = await investigateFinding({
        findingType: (params?.findingType as 'test_framework_mismatch' | 'escalation_asymmetry' | 'generic') ?? 'generic',
        target: String(params?.target ?? ''),
        question: String(params?.question ?? ''),
        initialObservation: String(params?.initialObservation ?? ''),
        suspectedFiles: Array.isArray(params?.suspectedFiles) ? params.suspectedFiles as string[] : [],
        knownEdit: params?.knownEdit as Array<{ file: string; oldString: string; newString: string }> | undefined,
        missionId: params?.missionId as string | undefined ?? params?.goalId as string | undefined,
      });
      let followup = null;
      if (rec.conclusion === 'CONFIRMED_DEFECT') {
        // Hand off as a real goal — dev_author runs under its own R2 gate.
        try {
          await this.pool.query(
            `INSERT INTO heidi_goals (title, goal_type, description, status, priority, success_criteria, context, created_at, updated_at)
             VALUES ($1, 'task', $1, 'active', 3, '["ops.dev_author executes and commits a verified patch"]'::jsonb, $2, now(), now())`,
            [`Fix confirmed defect: ${rec.target.slice(0, 120)}`,
            JSON.stringify({ capabilityId: 'ops.dev_author', problem: rec.question, evidence: String(params?.initialObservation ?? ''), targetFiles: params?.suspectedFiles ?? [], knownEdit: params?.knownEdit, missionId: rec.missionId, sourceInvestigation: rec.investigationId })],
          );
          followup = 'goal_created';
        } catch (e) { followup = `goal_failed:${(e as Error).message.slice(0, 120)}`; }
      }
      const eventId = await this.pool.query(
        `INSERT INTO heidi_events (event_type, payload, created_at) VALUES ('dev_investigation', $1, now()) RETURNING id`,
        [JSON.stringify({ investigationId: rec.investigationId, conclusion: rec.conclusion, confidence: rec.confidence, target: rec.target, followup, missionId: rec.missionId })],
      ).then(x => x.rows[0].id as string).catch(() => null);
      return {
        capabilityId: 'ops.dev_investigate',
        executed: true,
        outcome: 'success' as const,
        result: { investigationId: rec.investigationId, conclusion: rec.conclusion, confidence: rec.confidence, followup, recommendedAction: rec.recommendedAction, eventId },
        error: null,
        evidence: [{ filesInspected: rec.filesInspected, commandsRun: rec.commandsRun, durationMs: rec.durationMs }],
        verified: true,
        verificationDetails: `${rec.conclusion} (${rec.confidence}) after ${rec.filesInspected.length} files, ${rec.commandsRun.length} commands`,
      };
    });

    // Dev patch author — R2: turns a bounded finding into an executable
    // proposal. HIGH confidence flows straight to ops.dev_patch; anything
    // less becomes a human action with the proposal attached — never a
    // silent auto-apply.
    this.wireExecutor('ops.dev_author', async (params) => {
      const { authorPatchProposal } = await import('./DevPatchPlanner');
      const finding = {
        problem: String(params?.problem ?? ''),
        evidence: String(params?.evidence ?? ''),
        targetFiles: Array.isArray(params?.targetFiles) ? params.targetFiles as string[] : [],
        expectedBehavior: params?.expectedBehavior as string | undefined,
        knownEdit: params?.knownEdit as Array<{ file: string; oldString: string; newString: string }> | undefined,
        missionId: params?.missionId as string | undefined ?? params?.goalId as string | undefined,
      };
      if (!finding.problem || finding.targetFiles.length === 0) {
        return this.failResult('ops.dev_author', 'Missing required params: problem, targetFiles');
      }
      const proposal = await authorPatchProposal(finding);
      let execution: unknown = null;
      if (proposal.confidence === 'HIGH') {
        const { applyBoundedPatch } = await import('./DevPatchExecutor');
        execution = await applyBoundedPatch({
          missionId: proposal.missionId,
          patches: proposal.patches,
          commitMessage: `${finding.problem.slice(0, 80)}`,
          verify: proposal.verifyCommands,
        });
      } else {
        // Not safe to apply — escalate the proposal as a human action.
        await this.pool.query(
          `INSERT INTO human_intervention_requests (objective, status, context, created_at)
           VALUES ($1, 'pending', $2, now())`,
          [`Review dev proposal ${proposal.proposalId}: ${finding.problem.slice(0, 120)}`,
          JSON.stringify({ proposal, kind: 'dev_patch_review' })],
        ).catch(() => { });
      }
      const eventId = await this.pool.query(
        `INSERT INTO heidi_events (event_type, payload, created_at) VALUES ('dev_author', $1, now()) RETURNING id`,
        [JSON.stringify({ proposalId: proposal.proposalId, confidence: proposal.confidence, author: proposal.author, missionId: proposal.missionId, autoApplied: proposal.confidence === 'HIGH', execution })],
      ).then(x => x.rows[0].id as string).catch(() => null);
      return {
        capabilityId: 'ops.dev_author',
        executed: proposal.confidence === 'HIGH' && !!(execution as { ok?: boolean } | null)?.ok,
        outcome: proposal.confidence === 'HIGH' ? (((execution as { ok?: boolean })?.ok) ? 'success' as const : 'failure' as const) : 'skipped' as const,
        result: { proposalId: proposal.proposalId, confidence: proposal.confidence, author: proposal.author, patchHash: proposal.patchHash ?? null, execution, eventId },
        error: proposal.reason ?? null,
        evidence: [{ proposal }],
        verified: proposal.confidence === 'HIGH' && !!(execution as { ok?: boolean } | null)?.ok,
        verificationDetails: proposal.confidence === 'HIGH'
          ? 'Patch prevalidated + applied + typechecked by DevPatchExecutor'
          : `Not auto-applied — ${proposal.reason ?? proposal.confidence}`,
      };
    });

    // Agent supervisor pass — R0 observation/lifecycle control. Persists
    // stale/failed transitions, bounded-retries R0/R1 missions, escalates
    // terminal failures to the human queue, reconciles parent missions.
    // Controls lifecycle; invents no authority.
    this.wireExecutor('ops.agent_supervise', async () => {
      const report = await superviseAgents(this.pool, { pool: this.pool, repoDir: process.cwd() });
      return {
        capabilityId: 'ops.agent_supervise',
        executed: true,
        outcome: 'success' as const,
        result: {
          supervisionEventId: report.supervisionEventId,
          agentsChecked: report.agentsChecked,
          transitions: report.transitions.length,
          retries: report.retries,
          escalations: report.escalations,
          parentsReconciled: report.parentsReconciled,
        },
        error: null,
        evidence: [report],
        verified: false,
        verificationDetails: 'Pending contract verification of persisted agent_supervision row',
      };
    });

    // Governed agent lifecycle control: stop <agentId> | retry <missionId>.
    // Emits a durable agent_control audit event; never grants authority.
    this.wireExecutor('ops.agent_control', async (params) => {
      const action = params?.action === 'stop' || params?.action === 'retry' ? params.action : null;
      const target = typeof params?.target === 'string' ? params.target : null;
      const actor = typeof params?.actor === 'string' ? params.actor : 'operator';
      if (!action || !target) {
        return {
          capabilityId: 'ops.agent_control', executed: false, outcome: 'failure' as const,
          result: null, error: "params require {action:'stop'|'retry', target}", evidence: [],
          verified: false, verificationDetails: 'Missing action/target',
        };
      }
      const res = action === 'stop'
        ? await stopAgent(this.pool, target, actor)
        : await retryMission(this.pool, target, actor, { pool: this.pool, repoDir: process.cwd() });
      const controlEventId = await this.pool.query(
        `INSERT INTO heidi_events (event_type, division, payload, verdict, created_at)
         VALUES ('agent_control', 'agents', $1, $2, now()) RETURNING id`,
        [JSON.stringify({ action, target, actor, outcome: res.outcome, detail: res.detail }), res.ok ? 'APPLIED' : 'REFUSED'],
      ).then((r) => r.rows[0]?.id as string).catch(() => null);
      return {
        capabilityId: 'ops.agent_control', executed: res.ok,
        outcome: res.ok ? 'success' as const : 'failure' as const,
        result: { controlEventId, ...res },
        error: res.ok ? null : (res.detail ?? 'control refused'),
        evidence: [{ action, target, outcome: res.outcome }],
        verified: false,
        verificationDetails: res.ok ? 'Pending contract verification of persisted agent_control row' : 'Refused before effect — nothing to verify',
      };
    });

    // Governed approve/reject of queue items — durable resolution. authz:*
    // items are fail-closed (capability grants need the explicit policy path).
    this.wireExecutor('ops.resolve_human_action', async (params) => {
      const queueItemId = typeof params?.queueItemId === 'string' ? params.queueItemId : null;
      const decision = params?.decision === 'approve' || params?.decision === 'reject' ? params.decision : null;
      const actor = typeof params?.actor === 'string' ? params.actor : 'operator';
      if (!queueItemId || !decision) {
        return {
          capabilityId: 'ops.resolve_human_action', executed: false, outcome: 'failure' as const,
          result: null, error: "params require {queueItemId, decision:'approve'|'reject'}", evidence: [],
          verified: false, verificationDetails: 'Missing queueItemId/decision',
        };
      }
      const res = await resolveHumanAction(this.pool, queueItemId, decision, actor);
      // An approved customer-validation hypothesis becomes an authorized
      // experiment record — authorization, not execution. Contact stays
      // human until evidence arrives through the declared-evidence path.
      if (res.ok && decision === 'approve') {
        try {
          const item = queueItemId.startsWith('intervention:')
            ? await this.pool.query(
              `SELECT intervention_type, objective, why_required, required_action FROM human_intervention_requests WHERE request_id=$1`,
              [queueItemId.slice('intervention:'.length)])
            : await this.pool.query(
              `SELECT intervention_type, objective, why_required, required_action FROM human_intervention_requests WHERE id=$1`,
              [queueItemId]);
          const row = item.rows[0];
          if (row?.intervention_type === 'customer_validation_hypothesis') {
            const meta = (() => { try { return JSON.parse(row.why_required as string) as Record<string, unknown>; } catch { return {}; } })();
            await this.pool.query(
              `INSERT INTO heidi_events (event_type, payload, created_at)
               VALUES ('validation_experiment', $1, now())`,
              [JSON.stringify({ ...meta, proposedExperiment: row.required_action, status: 'AUTHORIZED', authorizedBy: actor, queueItemId })],
            );
          }
        } catch { /* experiment record failure is not fatal to the resolution */ }
      }
      return {
        capabilityId: 'ops.resolve_human_action', executed: res.ok,
        outcome: res.ok ? 'success' as const : 'failure' as const,
        result: { resolutionEventId: res.resolutionEventId ?? null, outcome: res.outcome, detail: res.detail },
        error: res.ok ? null : (res.detail ?? 'resolution refused'),
        evidence: [{ queueItemId, decision, outcome: res.outcome }],
        verified: false,
        verificationDetails: res.ok ? 'Pending contract verification of persisted resolution row' : 'Refused before write — nothing to verify',
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
      producedMissions: null,
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
        state.retrievedMemory = await this.withDeadline<string | null>(
          this.bridge.memory.retrieve(query, 'heidi', this.sessionId),
          null,
          'retrieve_memory',
          (message) => errors.push(message),
        );
      }
      state.phase = 'identify_goals';
    } catch (e) {
      errors.push(`retrieve_memory: ${e instanceof Error ? e.message : 'unknown'}`);
    }

    // PHASE 6: IDENTIFY GOALS — produce governed missions, then plan over
    // the refreshed work set. Production is bounded (open-goal cap, per-key
    // dedupe, per-key cooldown) and can only emit capabilities the registry
    // reports as executable at the current autonomy level.
    try {
      state.producedMissions = this.missionProducer
        ? await this.missionProducer.produce(
          state.pendingWork,
          state.identity?.autonomyLevel ?? 0,
        )
        : null;
      if (state.producedMissions && state.producedMissions.created.length > 0) {
        state.pendingWork = await this.goals.getPendingWork();
        state.activeGoals = await this.goals.getActiveMissions();
      }
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
      state.authorizationResult = this.authorizeAction(state.selectedAction, state.identity, state);
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

    // ─── Evidence-backed perception via OperationalIntelligence ───────────
    //
    // When OperationalIntelligence is wired, use its HealthProvenanceChecker
    // as the PRIMARY observation source. Every component health determination
    // comes with evidence (port checks, process identity, health endpoints,
    // database writes). This replaces the shallow DB/Ollama-only checks.
    //
    // UNKNOWN is NEVER collapsed into FAILED. If the health checker returns
    // UNKNOWN for a component, we preserve that.
    let oiHealthAvailable = false;
    if (this.bridge.operationalIntelligence) {
      try {
        const healthResult = await this.bridge.operationalIntelligence.checkHealth();
        // checkHealth() returns a ComponentState (overall) or a structured object
        // with per-component states. We extract what we can.
        const overallState = (typeof healthResult === 'string' ? healthResult : (healthResult as { state?: string })?.state) || 'UNKNOWN';
        oiHealthAvailable = true;
        components.push({
          name: 'operational_intelligence',
          status: overallState.toLowerCase(),
          confidence: 1.0,
          evidence: `HealthProvenanceChecker.checkAll() → overall state: ${overallState}`,
        });
      } catch (e) {
        // Observer failure is recorded honestly — NOT as a component failure
        components.push({
          name: 'operational_intelligence',
          status: 'unknown',
          confidence: 0.3,
          evidence: `Observer failure: ${e instanceof Error ? e.message : 'unknown'}`,
        });
      }
    }

    // Check database (always — this is CognitiveCore's own DB pool)
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

    // Determine overall health — UNKNOWN is never collapsed into FAILED.
    // Observer failures are tracked separately: if the health observer itself
    // failed, the system health is UNKNOWN regardless of other components,
    // because we cannot trust the observation.
    const failed = components.filter((c) => c.status === 'failed').length;
    const degraded = components.filter((c) => c.status === 'degraded').length;
    const unknown = components.filter((c) => c.status === 'unknown').length;
    const observerFailed = components.some((c) => c.name === 'operational_intelligence' && c.evidence.startsWith('Observer failure:'));
    let systemHealth: PerceptionResult['systemHealth'];
    if (observerFailed) {
      // Observer failure means we cannot trust the observation — UNKNOWN
      systemHealth = 'unknown';
    } else if (failed > 0) {
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

  /**
   * Authorization = legacy decision INTERSECTED with the contract's decision.
   *
   * Governance layers compose by intersection, never by union: a second
   * opinion may refuse something the first permitted, but must never permit
   * something the first refused. So the contract can only ever narrow.
   *
   * In `advisory` mode (the default) a contract refusal is recorded on the
   * result and the legacy decision still governs, so the disagreements can be
   * read off real cycles before anyone bets uptime on new metadata.
   */
  private authorizeAction(
    action: SelectedAction | null,
    identity: HeidiIdentity | null,
    state?: CognitiveState | null,
  ): AuthorizationResult {
    const legacy = this.authorizeActionLegacy(action, identity);

    if (!action?.capabilityId) return legacy;
    const contract = this.contracts.get(action.capabilityId);
    if (!contract) {
      return { ...legacy, contractTier: null, contractRationale: null, contractDisagreement: null };
    }

    // Registry-level, so cross-contract coherence (an undo may not be gated
    // harder than the act it reverses) is applied.
    const decision =
      this.contracts.authorityFor(action.capabilityId, action.params, this.contractState(state)) ??
      computeAuthority(contract, action.params, this.contractState(state));

    // R3+ means a human has to say yes; the loop has nobody to ask.
    const contractRefuses = decision.requiresApproval || decision.tier === 'R5';
    const disagreement =
      legacy.authorized && contractRefuses
        ? `contract derives ${decision.tier} for this invocation (legacy risk level ${action.riskLevel}): ${decision.rationale}`
        : null;

    if (disagreement && this.contractAuthorityMode === 'enforcing') {
      return {
        ...legacy,
        authorized: false,
        authorizationMode: decision.tier === 'R5' ? 'prohibited' : 'human_required',
        reason: disagreement,
        policyEvaluated: 'capability_contract',
        contractTier: decision.tier,
        contractRationale: decision.rationale,
        contractDisagreement: disagreement,
      };
    }

    return {
      ...legacy,
      contractTier: decision.tier,
      contractRationale: decision.rationale,
      contractDisagreement: disagreement,
    };
  }

  private authorizeActionLegacy(action: SelectedAction | null, identity: HeidiIdentity | null): AuthorizationResult {
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

  /**
   * Verify through the capability's own contract.
   *
   * The planner contributes nothing capability-specific here: it hands over
   * the arguments and the executor's result, and the contract says what to go
   * look at and what must be true. `targetGoalId` is merged into the argument
   * bag because the legacy chain read it off the action rather than the
   * params, and contracts address it by name.
   */
  private async verifyThroughContract(
    action: SelectedAction,
    exec: ExecutionResult,
    state: CognitiveState,
  ): Promise<VerificationResult> {
    const contract = this.contracts.get(action.capabilityId as string) as CapabilityContract;
    // Name the contract AND what it went to look at. An audit record that says
    // only "verified" is not much better than no record; the useful question
    // later is always "verified against what?".
    const observation = contract.verification.observation;
    const strategy =
      `contract:${contract.identity.id}@${contract.identity.version} ` +
      `via ${observation.source}(${observation.target})`;

    const args: Record<string, unknown> = { ...action.params };
    if (action.targetGoalId) {
      args.targetGoalId = action.targetGoalId;
    }

    const result = await this.verifier.verify(
      contract,
      args,
      {
        sessionId: this.sessionId,
        actorId: 'heidi',
        authorityId: null,
        state: this.contractState(state),
      },
      exec.rawResult,
    );

    return {
      verified: result.verified,
      expectedState: contract.verification.description,
      // `unverifiable` and `error` are reported as themselves rather than
      // collapsed into "failed" — not knowing is a different problem from
      // knowing it went wrong, and they need different responses.
      actualState:
        result.outcome === 'verified'
          ? 'verified'
          : `${result.outcome}: ${result.evidence}`,
      verificationStrategy: strategy,
      evidence: [
        {
          outcome: result.outcome,
          confidence: result.confidence,
          failedConditions: result.failedConditions,
          observed: result.observedState,
          onFailure: result.onFailure,
          executorOutcome: exec.outcome,
        },
      ],
    };
  }

  /**
   * Verify the cycle's action.
   *
   * This used to be ~270 lines of hand-written `if (capabilityId === ...)`
   * branches — the planner holding capability-specific knowledge, which meant
   * every new capability required editing this method. All 43 registered
   * capabilities now carry contracts, so those branches were unreachable and
   * have been deleted. What remains is capability-agnostic.
   *
   * The fallback is deliberately `unverified`, not "trust the executor".
   * The old default was `verified: exec.outcome === 'success'`, which made the
   * answer to "did this work?" default to yes for exactly the capabilities
   * nobody had specified. A capability reaching this path has no contract;
   * that is a gap to close, not evidence of success.
   * `contractCoverage().legacyFallback` lists anything that lands here.
   */
  private async verifyAction(state: CognitiveState): Promise<VerificationResult> {
    if (!state.executionResult || !state.selectedAction) {
      return {
        verified: false,
        expectedState: 'unknown',
        actualState: 'no action or execution result to verify',
        verificationStrategy: 'none',
        evidence: [],
      };
    }

    const action = state.selectedAction;

    if (action.capabilityId && this.contracts.get(action.capabilityId)) {
      return this.verifyThroughContract(action, state.executionResult, state);
    }

    const id = action.capabilityId ?? action.actionType;
    return {
      verified: false,
      expectedState: 'a contract stating what success means',
      actualState: `no contract registered for "${id}" — cannot verify`,
      verificationStrategy: 'none',
      evidence: [{ executorOutcome: state.executionResult.outcome, uncontracted: id }],
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

    // Store experience in episodic memory if bridge is available. The
    // bridge returns the real `memories` row id — memoryStored means a
    // row exists with that id, not that a call returned without throwing.
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
        memoryId = await this.withDeadline(
          this.bridge.memory.storeExperience(this.sessionId, 'heidi', experience),
          null,
          'storeExperience',
          (message) => lessons.push(message),
        );
        memoryStored = memoryId !== null;
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

    // Complete a capability-bound goal once its bound capability executed
    // and verified. A goal carrying context.capabilityId means "run this
    // capability"; doing so successfully IS the work — leaving it open
    // would re-run it forever and wedge the producer's open-goal dedupe.
    if (goalUpdated && state.selectedAction) {
      try {
        const goal =
          state.pendingWork.find((g) => g.goalId === state.selectedAction!.targetGoalId)
          ?? await this.goals.getGoal(state.selectedAction.targetGoalId as string);
        const boundCapability = goal?.context?.capabilityId;
        if (
          goal
          && boundCapability === state.selectedAction.capabilityId
          && goal.context?.completeOnVerify !== false
          && goal.status !== 'completed'
        ) {
          const completed = await this.goals.updateGoal(goal.goalId, {
            status: 'completed',
            result: state.executionResult?.details || 'Capability executed and verified',
            progress: 1.0,
          });
          if (completed && goal.parentId) {
            await this.goals.propagateCompletion(goal.parentId);
          }
        }
      } catch {
        // Completion bookkeeping is not fatal to the cycle
      }
    }

    // Terminal failure: a capability-bound goal whose capability executed
    // and failed (or refused) must not re-pend — otherwise the same refusal
    // replays every cycle and starves real work. Failure is evidence.
    if (
      state.selectedAction?.targetGoalId
      && state.executionResult?.outcome === 'failure'
      && !goalUpdated
    ) {
      try {
        const goal =
          state.pendingWork.find((g) => g.goalId === state.selectedAction!.targetGoalId)
          ?? await this.goals.getGoal(state.selectedAction.targetGoalId as string);
        if (
          goal
          && goal.context?.capabilityId === state.selectedAction.capabilityId
          && goal.status !== 'completed'
          && goal.status !== 'failed'
        ) {
          await this.goals.updateGoal(goal.goalId, {
            status: 'failed',
            result: state.executionResult.details || 'capability refused or failed',
          });
        }
      } catch {
        // Failure bookkeeping is not fatal to the cycle
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

  /**
   * Minimal heartbeat for a timed-out cycle. recordCycle() only runs when a
   * cycle completes; this writes a single cognitive_cycle row marked
   * outcome='timeout' so event-flow monitoring sees the truth (loop alive,
   * cycle over budget) rather than silence. Bounded by its own short timeout
   * so a dead pool cannot hang the scheduler's catch path.
   */
  private async recordTimeoutHeartbeat(): Promise<void> {
    if (!this.pool) return;
    const write = this.pool.query(
      `INSERT INTO heidi_events (event_type, payload, created_at)
       VALUES ($1, $2, now())`,
      [
        'cognitive_cycle',
        JSON.stringify({
          runtimeIdentity: this.runtimeIdentity(),
          outcome: 'timeout',
          cycleTimeoutMs: this.loopConfig.cycleTimeoutMs,
          consecutiveFailures: this.consecutiveFailures,
        }),
      ],
    );
    await Promise.race([
      write,
      new Promise((_, reject) => setTimeout(() => reject(new Error('heartbeat write timeout')), 5000)),
    ]);
  }

  /**
   * The durable proof that the process writing this row is the one that
   * executed the cycle — the anchor deployment reconciliation uses to
   * distinguish "PM2 says online" from "this process actually executes".
   */
  private runtimeIdentity(): { pid: number; commit: string | null; cwd: string } {
    if (this.runtimeCommit === undefined) {
      this.runtimeCommit = resolveGitHead(process.cwd());
    }
    return { pid: process.pid, commit: this.runtimeCommit, cwd: process.cwd() };
  }

  private async recordCycle(state: CognitiveState): Promise<void> {
    try {
      await this.pool.query(
        `INSERT INTO heidi_events (event_type, payload, created_at)
         VALUES ($1, $2, now())`,
        [
          'cognitive_cycle',
          JSON.stringify({
            runtimeIdentity: this.runtimeIdentity(),
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
            // Contract-layer telemetry. While authority runs in advisory mode
            // this is the ONLY record that the contract disagreed — the
            // decision itself is discarded at the end of the cycle. Without
            // persisting it there is no evidence base for deciding whether
            // enforcing mode is safe, and the advisory period collects nothing.
            contractTier: state.authorizationResult?.contractTier ?? null,
            contractRationale: state.authorizationResult?.contractRationale ?? null,
            contractDisagreement: state.authorizationResult?.contractDisagreement ?? null,
            executed: state.executionResult?.executed,
            outcome: state.executionResult?.outcome,
            verified: state.verificationResult?.verified,
            verificationStrategy: state.verificationResult?.verificationStrategy,
            lessonLearned: state.learningResult?.lessonLearned,
            memoryStored: state.learningResult?.memoryStored,
            memoryId: state.learningResult?.memoryId ?? null,
            producedMissions: state.producedMissions
              ? {
                created: state.producedMissions.created.map((g) => g.goalId),
                skipped: state.producedMissions.skipped,
              }
              : null,
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

  /**
   * Read back the disagreements the advisory contract layer has recorded.
   *
   * This is the evidence for the enforcement decision: for each capability,
   * how often the contract would have refused an action the legacy risk level
   * permitted. A capability with many disagreements is either genuinely
   * riskier than its static level admits, or has contract bounds that are
   * wrong — and the rationale is what tells the two apart.
   *
   * Flipping HEIDI_CONTRACT_AUTHORITY=enforcing without reading this is
   * betting uptime on metadata nobody has checked.
   */
  async contractDisagreements(since: number | string = 168): Promise<Array<{
    capabilityId: string;
    disagreements: number;
    totalCycles: number;
    contractTiers: string[];
    sampleRationale: string | null;
  }>> {
    // A number means "last N hours"; a string is an absolute ISO boundary.
    // The absolute form matters after a contract or authority change: cycles
    // recorded before it carry the OLD tier, and averaging the two together
    // reports a model nobody is running any more.
    const absolute = typeof since === 'string';
    const rows = await this.pool.query<QueryResultRow>(
      `SELECT
         payload->>'selectedCapability'    AS capability_id,
         COUNT(*)                          AS total_cycles,
         COUNT(payload->>'contractDisagreement') AS disagreements,
         ARRAY_AGG(DISTINCT payload->>'contractTier')
           FILTER (WHERE payload->>'contractTier' IS NOT NULL) AS contract_tiers,
         (ARRAY_AGG(payload->>'contractRationale')
           FILTER (WHERE payload->>'contractDisagreement' IS NOT NULL))[1] AS sample_rationale
       FROM heidi_events
       WHERE event_type = 'cognitive_cycle'
         AND created_at > ${absolute ? '$1::timestamptz' : "now() - ($1 || ' hours')::interval"}
         AND payload->>'selectedCapability' IS NOT NULL
       GROUP BY payload->>'selectedCapability'
       ORDER BY COUNT(payload->>'contractDisagreement') DESC, COUNT(*) DESC`,
      [String(since)],
    );

    return rows.rows.map((row) => ({
      capabilityId: row.capability_id as string,
      disagreements: Number(row.disagreements),
      totalCycles: Number(row.total_cycles),
      contractTiers: (row.contract_tiers as string[] | null) ?? [],
      sampleRationale: (row.sample_rationale as string | null) ?? null,
    }));
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

  // ─── Bounded continuous loop ──────────────────────────────────────────
  //
  // The loop runs CognitiveCore.runCycle() at a bounded interval with:
  //   - no overlapping cycles (cycleInFlight guard)
  //   - 30-second cycle timeout
  //   - max 3 consecutive failures before cooldown
  //   - exponential backoff on retry
  //   - kill switch that immediately halts new cycles
  //   - state machine: stopped → starting → running → (paused/cooldown/degraded/failed) → stopping → stopped
  //   - startup stabilization (2 minutes before first cycle)
  //   - audit of state transitions

  /**
   * Start the bounded continuous cognitive loop.
   * Only one loop instance can run per CognitiveCore.
   */
  async start(intervalMs: number = 60000): Promise<void> {
    if (this.loopState !== 'stopped' && this.loopState !== 'failed') {
      return; // Already running or paused
    }

    // Preserve existing config overrides; only set intervalMs if explicitly provided
    this.loopConfig = { ...this.loopConfig, intervalMs };
    this.loopState = 'starting';
    this.startedAt = Date.now();
    this.consecutiveFailures = 0;
    this.lastError = null;
    this.auditLoopTransition('starting');

    // Resume goals after restart
    try {
      await this.resumeAfterRestart();
    } catch {
      // Non-fatal — goals may not exist yet
    }

    // Startup stabilization: wait before first cycle
    const stabilizationEnd = Date.now() + this.loopConfig.startupStabilizationMs;

    this.loopState = 'running';
    this.auditLoopTransition('running');

    // Schedule the first cycle after stabilization
    const delay = Math.max(0, stabilizationEnd - Date.now());
    setTimeout(() => {
      this.scheduleNextCycle();
    }, delay);
  }

  /**
   * Stop the continuous loop gracefully.
   */
  stop(): void {
    if (this.loopState === 'stopped') return;
    this.loopState = 'stopping';
    this.auditLoopTransition('stopping');

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    this.loopState = 'stopped';
    this.auditLoopTransition('stopped');
  }

  /**
   * Pause the loop. Cycles stop but state is preserved for resume.
   */
  pause(): void {
    if (this.loopState !== 'running' && this.loopState !== 'degraded') return;
    this.loopState = 'paused';
    this.auditLoopTransition('paused');

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Resume a paused loop.
   */
  resume(): void {
    if (this.loopState !== 'paused') return;
    this.loopState = 'running';
    this.auditLoopTransition('running');
    this.scheduleNextCycle();
  }

  /**
   * Activate the kill switch. Immediately halts all new cycles.
   */
  activateKillSwitch(reason: string): void {
    this.killSwitchActive = true;
    this.lastError = `Kill switch activated: ${reason}`;
    if (this.loopState === 'running') {
      this.loopState = 'degraded';
      this.auditLoopTransition('degraded');
    }

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Deactivate the kill switch and resume cycling.
   */
  deactivateKillSwitch(): void {
    this.killSwitchActive = false;
    this.lastError = null;
    if (this.loopState === 'degraded') {
      this.loopState = 'running';
      this.auditLoopTransition('running');
      this.scheduleNextCycle();
    }
  }

  /**
   * Get the current loop status.
   */
  getLoopStatus(): LoopStatus {
    return {
      state: this.loopState,
      running: this.loopState === 'running' || this.loopState === 'degraded',
      cycleCount: this.cycleCount,
      lastCycleAt: this.lastCycleAt,
      lastSuccessfulCycleAt: this.lastSuccessfulCycleAt,
      lastFailureAt: this.lastFailureAt,
      consecutiveFailures: this.consecutiveFailures,
      cooldownUntil: this.cooldownUntil,
      killSwitchActive: this.killSwitchActive,
      currentIntervalMs: this.loopConfig.intervalMs,
      cycleInFlight: this.cycleInFlight,
      lastError: this.lastError,
      lastCycleOutcome: this.currentCycle?.outcome || null,
    };
  }

  /**
   * Update loop configuration.
   */
  configureLoop(config: Partial<LoopConfig>): void {
    this.loopConfig = { ...this.loopConfig, ...config };
  }

  // ─── Private loop mechanics ───────────────────────────────────────────

  private scheduleNextCycle(): void {
    if (this.loopState !== 'running' && this.loopState !== 'degraded') return;
    if (this.killSwitchActive) return;
    if (this.intervalHandle) return;

    // Check cooldown
    if (this.cooldownUntil) {
      const cooldownEnd = new Date(this.cooldownUntil).getTime();
      if (Date.now() < cooldownEnd) {
        const delay = cooldownEnd - Date.now();
        setTimeout(() => {
          this.cooldownUntil = null;
          this.loopState = 'running';
          this.auditLoopTransition('running');
          this.scheduleNextCycle();
        }, delay);
        return;
      }
      this.cooldownUntil = null;
    }

    this.intervalHandle = setInterval(() => {
      this.runBoundedCycle().catch((e) => {
        this.lastError = e instanceof Error ? e.message : 'unknown';
      });
    }, this.loopConfig.intervalMs);
  }

  private async runBoundedCycle(): Promise<void> {
    // Guard: no overlapping cycles
    if (this.cycleInFlight) return;
    // Guard: kill switch
    if (this.killSwitchActive) return;
    // Guard: state
    if (this.loopState !== 'running' && this.loopState !== 'degraded') return;

    this.cycleInFlight = true;
    this.lastCycleAt = new Date().toISOString();

    try {
      // Run cycle with timeout
      const cycleState = await this.runCycleWithTimeout(this.loopConfig.cycleTimeoutMs);

      // Classify the cycle outcome
      const outcome = this.classifyCycleOutcome(cycleState);
      cycleState.outcome = outcome;

      // Only count actual failures toward consecutiveFailures.
      // EXPECTED_BLOCK (governed refusal, missing credential) is normal operation.
      if (outcome === 'SUCCESS' || outcome === 'EXPECTED_BLOCK') {
        this.lastSuccessfulCycleAt = new Date().toISOString();
        this.consecutiveFailures = 0;

        // If we were in degraded state, return to running
        if (this.loopState === 'degraded') {
          this.loopState = 'running';
          this.auditLoopTransition('running');
        }
      } else if (outcome === 'RECOVERABLE_FAILURE') {
        // Cycle completed but had errors — don't count as a hard failure
        // unless the errors are severe (e.g., all phases failed)
        this.lastSuccessfulCycleAt = new Date().toISOString();
        // Don't reset consecutiveFailures, but don't increment either
        // This prevents cooldown from triggering on recoverable errors
      }

      // Autonomous dev-scan cadence — every 30 min, R0, never blocks the
      // cycle. The observer emits findings as goals; the governed chain
      // (investigate → author → patch) picks them up on future cycles.
      if (Date.now() - this.lastDevScanAt > 30 * 60 * 1000) {
        this.lastDevScanAt = Date.now();
        try {
          await this.registry.execute('ops.dev_observe', {}, { sessionId: this.sessionId } as CapabilityExecutionContext);
        } catch { /* scan failure must not break the cycle */ }
      }
      // HARD_FAILURE falls through to the catch block via re-throw
      if (outcome === 'HARD_FAILURE') {
        throw new Error(cycleState.errors[0] || 'Cycle completed with hard failure');
      }
    } catch (e) {
      this.lastFailureAt = new Date().toISOString();
      this.lastError = e instanceof Error ? e.message : 'unknown';
      this.consecutiveFailures++;

      // Event-flow starvation guard: recordCycle() runs at phase 14 of
      // runCycle(); a timed-out cycle never reaches it, so heidi_events
      // goes silent while the daemon is still alive — which the system
      // health check reads as a CRITICAL event-flow failure. Record a
      // minimal truthful timeout heartbeat instead of silence.
      // (Observed live 2026-09-21: 13.5h of event starvation while the
      // daemon kept cycling — every cycle timed out before phase 14.)
      if (e instanceof Error && e.message.includes('timed out')) {
        await this.recordTimeoutHeartbeat().catch(() => { });
      }

      // Check if we need to enter cooldown
      if (this.consecutiveFailures >= this.loopConfig.maxConsecutiveFailures) {
        this.enterCooldown();
      } else {
        // Exponential backoff: delay next cycle
        const backoff = Math.min(
          this.loopConfig.backoffBaseMs * Math.pow(2, this.consecutiveFailures - 1),
          this.loopConfig.backoffMaxMs,
        );
        if (this.intervalHandle) {
          clearInterval(this.intervalHandle);
          this.intervalHandle = null;
        }
        setTimeout(() => {
          if (this.loopState === 'running' || this.loopState === 'degraded') {
            this.scheduleNextCycle();
          }
        }, backoff);
      }
    } finally {
      this.cycleInFlight = false;
    }
  }

  private async runCycleWithTimeout(timeoutMs: number): Promise<CognitiveState> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Cycle timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      this.runCycle()
        .then((state) => {
          clearTimeout(timer);
          resolve(state);
        })
        .catch((e) => {
          clearTimeout(timer);
          reject(e);
        });
    });
  }

  /**
   * Classify the outcome of a cognitive cycle.
   *
   * This is the key to preventing governed refusals from being treated as
   * system crashes. A cycle where the action was blocked by policy or
   * missing credentials is EXPECTED_BLOCK, not a failure.
   */
  private classifyCycleOutcome(state: CognitiveState): CycleOutcome {
    // If the cycle had no errors and the action was executed or skipped normally
    if (state.errors.length === 0) {
      // Check if the action was blocked by governance or missing credentials
      const auth = state.authorizationResult;
      const exec = state.executionResult;

      if (auth && !auth.authorized) {
        // Governed refusal — this is normal operation
        return 'EXPECTED_BLOCK';
      }

      if (exec && !exec.executed && exec.outcome === 'skipped') {
        // Action was skipped (not authorized or no action selected)
        return 'EXPECTED_BLOCK';
      }

      if (exec && exec.executed && state.verificationResult?.verified) {
        // Action executed and verified
        return 'SUCCESS';
      }

      if (exec && exec.executed && !state.verificationResult?.verified) {
        // Action executed but verification failed — recoverable
        return 'RECOVERABLE_FAILURE';
      }

      // No action selected, no errors — normal idle cycle
      return 'SUCCESS';
    }

    // Cycle had errors — classify based on severity
    // If all errors are from phases that failed, it's a recoverable failure
    // If the cycle couldn't even perceive, it's a hard failure
    const criticalPhases = ['perceive'];
    const hasCriticalErrors = state.errors.some((e) =>
      criticalPhases.some((p) => e.startsWith(p + ':')),
    );

    // If the cycle reached the record phase, it completed most of its work
    if (state.phase === 'record' || state.phase === 'replan') {
      return 'RECOVERABLE_FAILURE';
    }

    if (hasCriticalErrors) {
      return 'HARD_FAILURE';
    }

    return 'RECOVERABLE_FAILURE';
  }

  private enterCooldown(): void {
    this.loopState = 'cooldown';
    this.cooldownUntil = new Date(Date.now() + this.loopConfig.cooldownMs).toISOString();
    this.auditLoopTransition('cooldown');

    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }

    // After cooldown, return to running
    setTimeout(() => {
      if (this.loopState === 'cooldown') {
        this.cooldownUntil = null;
        this.consecutiveFailures = 0;
        this.loopState = 'running';
        this.auditLoopTransition('running');
        this.scheduleNextCycle();
      }
    }, this.loopConfig.cooldownMs);
  }

  private auditLoopTransition(newState: LoopState): void {
    try {
      this.pool.query(
        `INSERT INTO cognitive_loop_audit (transition_to, timestamp, cycle_count, consecutive_failures, kill_switch_active, error)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [newState, new Date().toISOString(), this.cycleCount, this.consecutiveFailures, this.killSwitchActive, this.lastError],
      ).catch(() => { /* non-fatal */ });
    } catch {
      // Non-fatal — audit table may not exist
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

  /**
   * Exercise one capability directly, for qualification.
   *
   * The cognitive loop only ever exercises whichever capabilities its goals
   * happen to select, which left 41 of 45 contracts unexercised — and an
   * unexercised contract is not validated, however well-formed. This runs the
   * REAL executor and the REAL contract verification so the result is evidence
   * about the production path, not about a stub.
   *
   * It deliberately does NOT bypass authority. A capability whose contract
   * requires approval is refused unless `operatorApproval` is passed, and the
   * decision is recorded either way. A harness that quietly self-authorized
   * would be qualifying a governance model it had just stepped around.
   */
  async exerciseCapability(
    capabilityId: string,
    params: Record<string, unknown>,
    options: { operatorApproval?: string } = {},
  ): Promise<ExerciseRecord> {
    const startedAt = new Date().toISOString();
    const contract = this.contracts.get(capabilityId);
    const state = this.contractState(null);

    const decision = contract
      ? this.contracts.authorityFor(capabilityId, params, state)
      : null;

    const base: ExerciseRecord = {
      capabilityId,
      startedAt,
      contractRegistered: contract !== null,
      tier: decision?.tier ?? null,
      requiresApproval: decision?.requiresApproval ?? false,
      approvedBy: options.operatorApproval ?? null,
      executed: false,
      executionOutcome: null,
      executionError: null,
      verificationOutcome: null,
      verificationEvidence: null,
      observationSource: contract?.verification.observation.source ?? null,
      skipped: null,
    };

    if (!contract) {
      return { ...base, skipped: `no contract registered for "${capabilityId}"` };
    }

    if (decision?.requiresApproval && !options.operatorApproval) {
      return {
        ...base,
        skipped:
          `${decision.tier} requires approval and none was supplied — ` +
          `refused rather than self-authorized. ${decision.rationale}`,
      };
    }

    const executor = this.registry.getExecutor(capabilityId);
    if (!executor) {
      return { ...base, skipped: `capability has no wired executor` };
    }

    let result: unknown = null;
    try {
      const capResult = await executor(params, {
        sessionId: this.sessionId,
        actorId: 'qualification-harness',
        actorTrustLevel: 'trusted_system',
        authorizationMode: options.operatorApproval ? 'human_authorized' : 'autonomous',
        auditTrail: [],
      });
      result = capResult.result;
      base.executed = capResult.executed;
      base.executionOutcome = capResult.outcome;
      base.executionError = capResult.error;
    } catch (err) {
      return {
        ...base,
        executed: false,
        executionOutcome: 'failure',
        executionError: err instanceof Error ? err.message : String(err),
      };
    }

    // Verification only means something if the action actually ran. Verifying
    // the result of a declined execution reports a "verification failure" that
    // is really an execution failure — two different problems that need two
    // different fixes.
    if (!base.executed) {
      return {
        ...base,
        verificationOutcome: null,
        verificationEvidence: null,
        rawResult: result,
      };
    }

    const verification = await this.verifier.verify(
      contract,
      params,
      {
        sessionId: this.sessionId,
        actorId: 'qualification-harness',
        authorityId: options.operatorApproval ?? null,
        state,
      },
      result,
    );

    return {
      ...base,
      verificationOutcome: verification.outcome,
      verificationEvidence: verification.evidence,
      rawResult: result,
    };
  }

  /**
   * Get the ExecutionBridge. Used by the orchestrator to access
   * self-sufficiency components (CapabilityHealthManager, BlockerResolutionEngine,
   * SelfRepairEngine) without exposing internal CognitiveCore state.
   */
  getBridge(): ExecutionBridge {
    return this.bridge;
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
