/**
 * HYDI Adaptive Operator Types
 *
 * The Adaptive Operator sits ABOVE the existing HumanActionEngine.
 * It does NOT directly execute shell/browser/API operations.
 * It produces governed HumanAction intents which continue through:
 *   POLICY → AUTHORIZATION → EXECUTION → VERIFICATION → JOURNAL
 *
 * The critical capability is ADAPTIVE REPLANNING:
 *   The operator observes reality, compares to expectations,
 *   classifies deviations, and generates new plans when needed.
 *   It does NOT follow a fixed sequence of predefined actions.
 */

import type { RiskLevel } from '../operational/types';
import type {
  ActionCategory,
  HumanActionIntent,
  HumanActionResult,
  HumanInterventionRequest,
} from '../human-action/HumanActionTypes';

// Re-export for convenience
export type { HumanActionIntent, HumanActionResult, HumanInterventionRequest } from '../human-action/HumanActionTypes';

// ===========================================================================
// World State — structured representation of observed reality
// ===========================================================================

/**
 * A single observation of the environment.
 * Every observation includes provenance metadata.
 */
export interface Observation {
  observationId: string;
  timestamp: string;              // ISO 8601
  source: ObservationSource;
  confidence: number;             // 0.0 to 1.0
  freshness: ObservationFreshness;
  correlationId: string;          // links to the action or goal that triggered it
  category: ObservationCategory;
  key: string;                    // unique key for this observation type (e.g. "process:node:3005")
  value: unknown;                 // the observed value
  summary: string;                // human-readable summary
  expiresAt?: string;             // when this observation becomes stale
}

export type ObservationSource =
  | 'filesystem'     // file system inspection
  | 'process'        // process inspection
  | 'network'        // network probe
  | 'browser'        // browser page inspection
  | 'api'            // API response
  | 'credential'     // credential validation
  | 'git'            // git status
  | 'docker'         // docker inspection
  | 'health'         // health endpoint
  | 'capability'     // capability health check
  | 'inference'      // inferred from other observations
  | 'human';         // reported by human

export type ObservationFreshness =
  | 'current'        // observed within the last few seconds
  | 'recent'         // observed within the last minute
  | 'stale'          // observed more than a minute ago
  | 'expired';       // past expiration time

export type ObservationCategory =
  | 'process'
  | 'port'
  | 'file'
  | 'service'
  | 'repository'
  | 'git_state'
  | 'container'
  | 'api'
  | 'credential'
  | 'browser_state'
  | 'network'
  | 'deployment'
  | 'capability_health'
  | 'blocker'
  | 'action_result'
  | 'verification'
  | 'environment'
  | 'health';

/**
 * The complete world state — a snapshot of everything HYDI has observed.
 */
export interface WorldState {
  worldId: string;
  observations: Map<string, Observation>;  // keyed by observation.key
  lastUpdated: string;
  observationCount: number;
}

// ===========================================================================
// Goal State — explicit representation of a human goal
// ===========================================================================

export type GoalStatus =
  | 'pending'           // goal registered, not yet started
  | 'observing'         // observing current state
  | 'planning'          // generating a plan
  | 'executing'         // executing actions
  | 'verifying'         // verifying results
  | 'replanning'       // replanning due to deviation
  | 'blocked'           // blocked by a blocker
  | 'pending_human'     // waiting for human intervention
  | 'partial'           // some objectives complete, some not
  | 'complete'          // all completion predicates satisfied
  | 'failed'            // cannot be completed
  | 'escalated'         // escalated to human
  | 'cancelled';        // cancelled by human

export interface GoalObjective {
  objectiveId: string;
  name: string;                   // e.g. "CODE_HEALTHY", "TESTS_PASS"
  description: string;
  status: ObjectiveStatus;
  predicates: CompletionPredicate[];  // what defines "complete" for this objective
  subObjectives?: GoalObjective[];
  parentObjectiveId?: string;
  discoveredAt: string;
  completedAt?: string;
  failureReason?: string;
}

export type ObjectiveStatus =
  | 'pending'
  | 'in_progress'
  | 'blocked'
  | 'complete'
  | 'failed'
  | 'skipped';

export interface CompletionPredicate {
  predicateId: string;
  name: string;
  description: string;
  check: (worldState: WorldState) => PredicateResult;
  satisfied: boolean;
  lastChecked?: string;
  evidence?: string;
}

export interface PredicateResult {
  satisfied: boolean;
  evidence: string;
  confidence: number;
}

export interface GoalState {
  goalId: string;
  statement: string;              // the original human goal
  statedBy: string;
  context?: string;
  constraints: GoalConstraint[];
  objectives: GoalObjective[];
  status: GoalStatus;
  completionConfidence: number;   // 0.0 to 1.0
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
  lastReplanAt?: string;
  replanCount: number;
  actionCount: number;
  summary?: string;
  blockers: GoalBlocker[];
  authorizationState: AuthorizationState;
  verificationState: VerificationState;
}

export interface GoalConstraint {
  type: 'time_limit' | 'risk_limit' | 'resource_limit' | 'no_destructive' | 'no_external' | 'no_financial' | 'custom';
  value: unknown;
  description: string;
}

export type BlockerClassification =
  | 'SOFTWARE_BUG'
  | 'CONFIGURATION_BUG'
  | 'DATABASE_STATE_PROBLEM'
  | 'INFRASTRUCTURE_RUNTIME'
  | 'MISSING_LOCAL_CAPABILITY'
  | 'MISSING_EXTERNAL_CREDENTIAL'
  | 'HUMAN_AUTHORIZATION_REQUIRED'
  | 'EXTERNAL_SERVICE_UNAVAILABLE'
  | 'POLICY_PROHIBITED_ACTION'
  | 'UNKNOWN_BLOCKER';

export interface GoalBlocker {
  blockerId: string;
  objectiveId: string;
  description: string;
  classification: BlockerClassification;
  discoveredAt: string;
  resolutionAction?: string;
  resolvedAt?: string;
}

export interface AuthorizationState {
  authorityId: string | null;
  pendingRequests: HumanInterventionRequest[];
  deniedActions: string[];
  approvedActions: string[];
}

export interface VerificationState {
  verifiedObjectives: string[];
  failedObjectives: string[];
  pendingVerifications: string[];
  lastVerificationAt?: string;
}

// ===========================================================================
// Planning — dynamic dependency graphs from observed reality
// ===========================================================================

/**
 * A plan is a dynamic dependency graph of objectives and actions.
 * It is NOT a fixed sequence — it changes based on observations.
 */
export interface AdaptivePlan {
  planId: string;
  goalId: string;
  version: number;                // incremented on each replan
  createdAt: string;
  objectives: PlanObjective[];
  executionOrder: string[];       // topological order of objective IDs
  basedOnObservationIds: string[]; // observations that informed this plan
  assumptions: PlanAssumption[];
  replanReason?: string;
}

export interface PlanObjective {
  objectiveId: string;
  name: string;
  description: string;
  status: ObjectiveStatus;
  intents: HumanActionIntent[];   // actions to execute for this objective
  dependsOn: string[];            // other objective IDs
  expectedOutcome: string;
  verificationStrategy: string;
  riskLevel: RiskLevel;
  retryCount: number;
  maxRetries: number;
  results?: HumanActionResult[];
  completedAt?: string;
  failureReason?: string;
}

export interface PlanAssumption {
  assumptionId: string;
  description: string;
  basedOn: string;                // observation key
  valid: boolean;
  invalidatedAt?: string;
}

// ===========================================================================
// Replanning — deviation detection and response
// ===========================================================================

export type DeviationClassification =
  | 'EXPECTED'                    // result matches expectation
  | 'RECOVERABLE_DEVIATION'       // something went wrong but we can recover
  | 'NEW_INFORMATION'             // learned something new that changes the plan
  | 'BLOCKER'                     // cannot proceed without resolving something
  | 'AUTHORIZATION_REQUIRED'      // need human authorization
  | 'UNSUPPORTED'                 // capability not available
  | 'FAILURE'                     // action failed and cannot be recovered
  | 'UNKNOWN';                    // unexpected result, don't know what to do

export interface DeviationAnalysis {
  analysisId: string;
  actionResult: HumanActionResult;
  expectedOutcome: string;
  actualOutcome: string;
  classification: DeviationClassification;
  confidence: number;
  reason: string;
  recommendedAction: ReplanningAction;
  newObservations: Observation[];
  timestamp: string;
}

export type ReplanningAction =
  | 'CONTINUE'                     // proceed with current plan
  | 'RETRY'                        // retry the same action
  | 'REPLAN'                       // generate a new plan
  | 'INVESTIGATE'                  // observe more before deciding
  | 'ESCALATE'                     // escalate to human
  | 'ABORT'                        // abort the goal
  | 'WORK_AROUND'                  // find an alternative path
  | 'REQUEST_AUTHORIZATION'        // request human authorization
  | 'REPAIR'                       // attempt repair via existing recovery systems;

// ===========================================================================
// Failure Classification — standardized taxonomy
// ===========================================================================

export type FailureClassification =
  | 'OBSERVATION_FAILURE'          // could not observe the environment
  | 'AUTHORIZATION_FAILURE'        // authorization was denied
  | 'CAPABILITY_UNAVAILABLE'       // capability not registered or not healthy
  | 'EXECUTION_FAILURE'            // execution itself failed
  | 'VERIFICATION_FAILURE'         // execution succeeded but verification failed
  | 'ENVIRONMENT_FAILURE'          // environment is not as expected
  | 'PROVIDER_FAILURE'             // external provider returned an error
  | 'TRANSIENT_FAILURE'            // temporary failure, likely retryable
  | 'PERMISSION_FAILURE'           // permission denied by the system
  | 'HUMAN_INTERVENTION_REQUIRED'  // need human to do something
  | 'UNSUPPORTED_OPERATION'        // HYDI cannot do this
  | 'UNKNOWN_FAILURE';             // don't know what happened

export interface FailureRecord {
  failureId: string;
  classification: FailureClassification;
  actionId: string;
  goalId: string;
  objectiveId: string;
  description: string;
  evidence: string;
  timestamp: string;
  retryable: boolean;
  recoveryStrategy?: string;
}

// ===========================================================================
// Bounded Autonomy — limits that prevent infinite loops
// ===========================================================================

export interface AutonomyBounds {
  maxActionsPerPlan: number;
  maxReplans: number;
  maxRetries: number;
  maxExecutionTimeMs: number;
  maxRisk: RiskLevel;
  maxExternalSideEffects: number;
  maxDestructiveActions: number;
  maxAuthorizationRequests: number;
  maxFinancialExposure: number;
}

export const DEFAULT_AUTONOMY_BOUNDS: AutonomyBounds = {
  maxActionsPerPlan: 50,
  maxReplans: 10,
  maxRetries: 3,
  maxExecutionTimeMs: 30 * 60 * 1000,  // 30 minutes
  maxRisk: 'R4',
  maxExternalSideEffects: 5,
  maxDestructiveActions: 3,
  maxAuthorizationRequests: 10,
  maxFinancialExposure: 0,
};

// ===========================================================================
// Action Budget — per-goal tracking
// ===========================================================================

export interface ActionBudget {
  goalId: string;
  actionsExecuted: number;
  actionsSucceeded: number;
  actionsFailed: number;
  retriesUsed: number;
  replansUsed: number;
  externalSideEffects: number;
  destructiveActions: number;
  authorizationRequests: number;
  financialExposure: number;
  elapsedMs: number;
  startedAt: string;
  lastActionAt?: string;
  bounds: AutonomyBounds;
}

// ===========================================================================
// Task Memory — scoped, persistent memory for a goal
// ===========================================================================

export interface TaskMemoryEntry {
  entryId: string;
  goalId: string;
  type: TaskMemoryType;
  content: unknown;
  timestamp: string;
  correlationId?: string;
}

export type TaskMemoryType =
  | 'observation'
  | 'decision'
  | 'action'
  | 'outcome'
  | 'failed_approach'
  | 'successful_approach'
  | 'environmental_fact'
  | 'blocker'
  | 'human_intervention'
  | 'replan'
  | 'completion_check';

export interface TaskMemory {
  goalId: string;
  entries: TaskMemoryEntry[];
  maxEntries: number;
  persistedPath?: string;
}

// ===========================================================================
// Adaptive Operator — the main orchestrator
// ===========================================================================

export interface AdaptiveOperatorOptions {
  rootDir: string;
  bounds?: AutonomyBounds;
  authorityId?: string;
  onHumanIntervention?: (request: HumanInterventionRequest) => void;
  onGoalComplete?: (goalId: string, status: GoalStatus, summary: string) => void;
  onReplan?: (goalId: string, reason: string, newPlan: AdaptivePlan) => void;
  onObservation?: (observation: Observation) => void;
  chromeExecutablePath?: string;
}

export interface GoalExecutionResult {
  goalId: string;
  status: GoalStatus;
  summary: string;
  objectivesCompleted: number;
  objectivesFailed: number;
  objectivesBlocked: number;
  actionsExecuted: number;
  replans: number;
  durationMs: number;
  budget: ActionBudget;
  worldState: WorldState;
  plan: AdaptivePlan;
  failures: FailureRecord[];
  interventions: HumanInterventionRequest[];
  completionConfidence: number;
}

// ===========================================================================
// Completion Evaluator — explicit completion predicates
// ===========================================================================

export interface CompletionEvaluatorResult {
  goalId: string;
  status: GoalStatus;
  confidence: number;
  satisfiedPredicates: string[];
  unsatisfiedPredicates: string[];
  evidence: Array<{ predicate: string; satisfied: boolean; evidence: string }>;
  summary: string;
}

// ===========================================================================
// Observation Engine — collects observations from the environment
// ===========================================================================

export interface ObservationRequest {
  category: ObservationCategory;
  target: string;
  capability?: string;
  correlationId: string;
  freshnessRequired?: number;  // max age in seconds
}

export interface ObservationResult {
  success: boolean;
  observation?: Observation;
  error?: string;
  fromCache?: boolean;
}
