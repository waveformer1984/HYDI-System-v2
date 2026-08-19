/**
 * HYDI Operational Intelligence — Core Type System
 *
 * This module defines the canonical types for Phase 3 + Phase 4 operational intelligence:
 * - Component states (UNKNOWN, STARTING, HEALTHY, DEGRADED, UNAVAILABLE, RECOVERING,
 *   FAILED, BLOCKED, ESCALATION_REQUIRED)
 * - Health provenance (evidence chains for every health determination)
 * - Dependency graph (machine-readable component relationships)
 * - Operational events (durable incident records with correlation IDs)
 * - Recovery actions (bounded, capability-based, with preconditions and postconditions)
 * - Security capabilities (explicit allowlist for autonomous actions)
 * - Phase 4: Autonomy policy model, risk classification, action selection,
 *   decision records, escalation, recovery budgets, concurrency locks
 *
 * Key principle: UNKNOWN is never collapsed into HEALTHY or FAILED.
 * If the system cannot answer "why do you believe this is healthy?",
 * the state MUST be UNKNOWN.
 *
 * Phase 4 principle: confidence ≠ authorization.
 * A high-confidence diagnosis does not authorize a prohibited action.
 */

// ---------------------------------------------------------------------------
// Component State Model
// ---------------------------------------------------------------------------

export type ComponentState =
  | 'UNKNOWN'              // No evidence collected yet — NOT the same as HEALTHY or FAILED
  | 'STARTING'             // Process launched, waiting for readiness
  | 'HEALTHY'              // All checks passed, evidence chain complete
  | 'DEGRADED'             // Partially functional — some checks failed, others passed
  | 'UNAVAILABLE'          // Process/port/endpoint not responding
  | 'RECOVERING'           // Recovery action in progress
  | 'FAILED'               // Recovery attempted and exhausted, or unrecoverable
  | 'BLOCKED'              // Cannot proceed — dependency failed or policy denial
  | 'ESCALATION_REQUIRED'; // Phase 4: recovery exhausted, human intervention required

export type ComponentCategory =
  | 'repository'
  | 'runtime'
  | 'process'
  | 'network'
  | 'database'
  | 'persistence'
  | 'heidi'
  | 'bridge'
  | 'protoforge'
  | 'cascade'
  | 'kilo'
  | 'ollama'
  | 'external'
  | 'security'
  | 'health'
  | 'recovery'
  | 'container';

// ---------------------------------------------------------------------------
// Health Provenance
// ---------------------------------------------------------------------------

/**
 * A single piece of evidence supporting a health determination.
 * Every health result MUST include at least one evidence item.
 */
export interface HealthEvidence {
  check: string;           // e.g. "port-listening", "process-identity", "health-endpoint", "database-write"
  status: 'pass' | 'fail' | 'warn' | 'skip';
  value: string;           // e.g. "HTTP 200", "PID 1234 (node)", "insert succeeded"
  detail?: string;         // Additional context
  checkedAt: string;       // ISO timestamp
  latencyMs?: number;      // How long the check took
}

/**
 * Complete health provenance for a component.
 * Answers: "Why do you believe this component is healthy?"
 */
export interface ComponentHealth {
  component: string;       // e.g. "protoforge-core"
  category: ComponentCategory;
  state: ComponentState;
  evidence: HealthEvidence[];
  dependencies?: Record<string, ComponentState>;  // upstream dep states at check time
  checkedAt: string;       // ISO timestamp
  error?: string;          // Summary error if state is not HEALTHY
}

// ---------------------------------------------------------------------------
// Dependency Graph
// ---------------------------------------------------------------------------

export interface DependencyNode {
  id: string;              // e.g. "protoforge-core"
  category: ComponentCategory;
  criticality: 'critical' | 'important' | 'optional';
  dependencies: string[];  // upstream component IDs this node depends on
  dependents: string[];    // downstream component IDs that depend on this node
  recoveryOrder: number;   // lower = recover first
  recoveryPolicy?: RecoveryPolicyId;
}

export interface DependencyGraph {
  nodes: Map<string, DependencyNode>;
  criticalPath: string[];  // ordered component IDs on the minimum operational path
  edges: Array<{ from: string; to: string; type: 'hard' | 'soft' }>;
}

// ---------------------------------------------------------------------------
// Operational Events (durable incident records)
// ---------------------------------------------------------------------------

// Note: OperationalEventType is defined at the end of this file with Phase 4
// extensions (policy_decision, action_selected, etc.)

export interface OperationalEvent {
  id: string;              // unique event ID
  timestamp: string;       // ISO timestamp
  type: OperationalEventType;
  component: string;       // which component this event pertains to
  previousState?: ComponentState;
  newState?: ComponentState;
  cause?: string;          // what triggered this event
  evidence?: HealthEvidence[];
  action?: string;         // what action was taken
  actionResult?: 'success' | 'failure' | 'denied' | 'skipped' | 'stopped';
  recoveryAttempt?: number; // 1-based attempt number
  recoveryResult?: 'success' | 'failure' | 'pending';
  correlationId?: string;  // links related events into one incident
  detail?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Recovery Actions
// ---------------------------------------------------------------------------

export type RecoveryPolicyId =
  | 'restart_process'      // kill + respawn a boot.config.json module
  | 'restart_container'    // restart a Docker container by name
  | 'restart_ollama'       // restart the local Ollama AI service
  | 'recover_database'     // wait for / reconnect to local database
  | 'restart_bridge'       // restart a bridge component
  | 'wait_for_dependency'  // do nothing locally; wait for upstream recovery
  | 'escalate'             // exhausted retries; signal for human intervention
  | 'no_action';           // component is healthy or recovery not applicable

export interface RecoveryAction {
  type: RecoveryPolicyId;
  target: string;          // component ID to act on
  precondition?: string;   // human-readable precondition description
  maxAttempts: number;     // retry budget
  cooldownMs: number;      // minimum time between attempts
  postcondition?: string;  // human-readable postcondition description
  escalationPath: string;  // what happens if all attempts fail
}

export interface RecoveryAttempt {
  action: RecoveryAction;
  attemptNumber: number;
  startedAt: string;
  completedAt?: string;
  result: 'success' | 'failure' | 'denied' | 'pending';
  evidence: HealthEvidence[];
  error?: string;
  // Phase 7: Recovery Failure Intelligence — explicit outcome and classification
  recoveryId?: string;             // unique identity for this attempt
  incidentId?: string;             // links to the incident this attempt belongs to
  outcome?: RecoveryOutcome;       // canonical outcome classification
  failureClassification?: RecoveryFailureClassification;  // what kind of failure
  executionSucceeded?: boolean;    // did the command itself complete without error?
  postconditionSucceeded?: boolean; // did the target become healthy after execution?
  verificationSucceeded?: boolean;  // did service-level verification pass?
  retryDecision?: RetryDecision;    // should we retry? why or why not?
  durationMs?: number;             // time from start to completion
}

export interface RecoveryRecord {
  component: string;
  correlationId: string;
  cause: string;
  action: RecoveryAction;
  attempts: RecoveryAttempt[];
  finalState: ComponentState;
  startedAt: string;
  completedAt?: string;
  // Phase 7: Recovery Failure Intelligence
  incidentId?: string;
  finalOutcome?: RecoveryOutcome;
  failureClassification?: RecoveryFailureClassification;
  escalationRecord?: EscalationRecord;
}

// ---------------------------------------------------------------------------
// Phase 7: Recovery Failure Intelligence — Canonical Outcome Model
// ---------------------------------------------------------------------------

/**
 * Canonical recovery outcome. The authoritative result comes from
 * EXECUTION + POSTCONDITION + SERVICE VERIFICATION — never from exit code alone.
 */
export type RecoveryOutcome =
  | 'RECOVERY_SUCCESS'              // target is HEALTHY after recovery
  | 'RECOVERY_EXECUTION_FAILED'     // the recovery command itself failed
  | 'RECOVERY_POSTCONDITION_FAILED' // command succeeded but target still unhealthy
  | 'RECOVERY_VERIFICATION_FAILED'  // target running but service-level check failed
  | 'RECOVERY_TIMEOUT'              // recovery action timed out
  | 'RECOVERY_DEPENDENCY_BLOCKED'   // a dependency is down — retrying target is pointless
  | 'RECOVERY_POLICY_DENIED'        // policy does not authorize this recovery
  | 'RECOVERY_TARGET_UNAVAILABLE'   // target cannot be reached at all
  | 'RECOVERY_EXHAUSTED'            // all attempts failed — budget exhausted
  | 'RECOVERY_OBSERVER_UNCERTAIN'   // observation is uncertain — cannot trust result
  | 'RECOVERY_NOT_REQUIRED';        // target was already healthy (idempotent)

/**
 * Classification of what kind of problem caused recovery to fail.
 * This classification must affect the next decision.
 */
export type RecoveryFailureClassification =
  | 'TARGET_PROBLEM'           // the target itself remains unhealthy
  | 'DEPENDENCY_PROBLEM'       // a dependency is blocking recovery
  | 'RECOVERY_MECHANISM_PROBLEM' // the restart/start action itself failed
  | 'VERIFICATION_PROBLEM'     // service may have recovered but verification failed
  | 'OBSERVER_PROBLEM'         // recovery result cannot be trusted — observation unavailable
  | 'POLICY_PROBLEM'           // recovery is no longer authorized
  | 'TIMEOUT_PROBLEM'          // recovery action timed out
  | 'UNKNOWN_PROBLEM';         // cannot classify

/**
 * Retry decision — should HEIDI try again?
 */
export interface RetryDecision {
  shouldRetry: boolean;
  reason: string;
  retryableOutcome: boolean;    // is this outcome type retryable?
  nextAction: 'retry' | 'stop' | 'escalate' | 'recover_dependency' | 'wait';
  waitMs?: number;              // how long to wait before next action
}

/**
 * Structured escalation record — not just a log message.
 * A reviewer must be able to answer "Why did HEIDI stop trying?"
 */
export interface EscalationRecord {
  escalationId: string;
  incidentId: string;
  target: string;
  failureClassification: RecoveryFailureClassification;
  attemptCount: number;
  lastRecoveryAction: string;
  lastFailureReason: string;
  remainingEvidence: HealthEvidence[];
  risk: RiskLevel;
  reasonForEscalation: string;
  recommendedNextAction: string;
  timestamp: string;
  // Full attempt history for reconstruction
  attemptHistory: Array<{
    attemptNumber: number;
    action: string;
    outcome: RecoveryOutcome;
    failureClassification?: RecoveryFailureClassification;
    error?: string;
    timestamp: string;
  }>;
}

// ---------------------------------------------------------------------------
// Security Capabilities
// ---------------------------------------------------------------------------

export type Capability =
  | 'health.read'          // read health state of any component
  | 'health.recover'       // initiate recovery for a component
  | 'process.restart'      // restart a specific process (by module ID, not arbitrary)
  | 'process.kill'         // kill a specific process (by module ID)
  | 'database.recover'     // attempt database recovery (e.g. wait for Supabase)
  | 'configuration.validate' // validate configuration without changes
  | 'runtime.probe'        // execute functional probes
  | 'diagnostic.snapshot'; // produce a full diagnostic snapshot

export interface CapabilityAuthorization {
  capability: Capability;
  authorized: boolean;
  reason?: string;         // why denied if not authorized
  scope?: string[];        // allowed targets (e.g. module IDs)
}

/**
 * The command allowlist. Recovery actions are represented structurally,
 * never as arbitrary shell strings. The policy engine decides whether
 * a requested action is permitted.
 */
export interface AllowedCommand {
  type: RecoveryPolicyId;
  target: string;          // must match a boot.config.json module ID
  command: string;         // the actual command to execute (derived from boot.config.json, not user input)
  args: string[];          // structured arguments
  env?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// System Snapshot (diagnostic output)
// ---------------------------------------------------------------------------

export interface SystemSnapshot {
  timestamp: string;
  repository: {
    path: string;
    remote: string;
    branch: string;
    commit: string;
    clean: boolean;
  };
  runtime: {
    nodeVersion: string;
    platform: string;
    pid: number;
    uptimeSeconds: number;
  };
  components: ComponentHealth[];
  dependencyGraph: {
    nodes: Array<{ id: string; category: ComponentCategory; criticality: string; dependencies: string[] }>;
    criticalPath: string[];
  };
  persistence: {
    mode: 'local' | 'cloud' | 'unknown';
    endpoint: string;
    cloudFallback: boolean;
    active: 'local' | 'cloud' | 'unknown';
  };
  recovery: {
    activeRecoveries: string[];
    recentIncidents: OperationalEvent[];
    totalRecoveries: number;
    successRate: number;
  };
  security: {
    capabilities: CapabilityAuthorization[];
    deniedActions: number;
  };
  overallState: ComponentState;
}

// ---------------------------------------------------------------------------
// Phase 4: Autonomy Policy Model
// ---------------------------------------------------------------------------

/**
 * Risk levels for autonomous actions.
 * R0 = read-only, R5 = destructive/external.
 * Default authorization policy: R0-R1 autonomous, R2 policy auth, R3-R4 human auth, R5 prohibited.
 */
export type RiskLevel = 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';

/**
 * Authorization mode for an action.
 * - 'autonomous': Heidi may act without human approval
 * - 'policy_authorized': allowed by explicit policy rule
 * - 'human_required': requires human authorization
 * - 'prohibited': never allowed autonomously
 */
export type AuthorizationMode = 'autonomous' | 'policy_authorized' | 'human_required' | 'prohibited';

/**
 * A condition that must be true for a policy to allow an action.
 * Evaluated deterministically against observed state.
 */
export interface PolicyCondition {
  field: 'state' | 'process_identity' | 'dependency_state' | 'port_listening' | 'health_endpoint' | 'recovery_count' | 'circuit_breaker';
  operator: 'eq' | 'neq' | 'in' | 'nin' | 'lt' | 'gt' | 'lte' | 'gte';
  value: string | string[] | number;
}

/**
 * An autonomy policy rule. Defines what Heidi is allowed to do for a given
 * capability + target, under what conditions, with what risk and budget.
 */
export interface AutonomyPolicy {
  id: string;                          // unique policy rule ID
  capability: Capability;              // what capability this governs
  target: string | '*';                // which component(s) this applies to
  risk: RiskLevel;                     // risk classification
  authorization: AuthorizationMode;   // when this action is allowed
  allowedWhen: PolicyCondition[];      // conditions that must all be true
  maxAttempts: number;                 // per-incident retry budget
  cooldownMs: number;                  // minimum time between attempts
  requiredEvidence: string[];          // evidence checks that must be present
  escalationAction: string;            // what to do if budget exhausted
  description: string;                 // human-readable description
}

/**
 * The result of evaluating a policy against observed state.
 */
export interface PolicyEvaluationResult {
  policy: AutonomyPolicy;
  allowed: boolean;
  reason: string;
  conditionsMet: PolicyCondition[];
  conditionsFailed: PolicyCondition[];
  risk: RiskLevel;
  authorization: AuthorizationMode;
}

// ---------------------------------------------------------------------------
// Phase 4: Action Selection
// ---------------------------------------------------------------------------

/**
 * A candidate action proposed for execution.
 * The LLM may propose hypotheses, but the deterministic action selector
 * decides what is actually eligible.
 */
export interface CandidateAction {
  capability: Capability;
  target: string;
  risk: RiskLevel;
  reason: string;                      // why this action was proposed
  evidence: HealthEvidence[];          // supporting evidence
  confidence: number;                  // 0-100, diagnostic confidence
  source: 'deterministic' | 'llm_hypothesis'; // who proposed it
}

/**
 * The result of action selection — what Heidi chose to do and why.
 */
export interface ActionSelectionResult {
  selected: CandidateAction | null;    // null = no action (idempotent)
  reason: string;                      // why this was selected (or not)
  policy: PolicyEvaluationResult;      // policy evaluation for the selected action
  authorization: CapabilityAuthorization; // authorization result
  alternatives: CandidateAction[];     // other candidates that were considered
  dryRun: boolean;                     // true if this is a dry-run evaluation
}

// ---------------------------------------------------------------------------
// Phase 4: Policy Decision Record (durable audit trail)
// ---------------------------------------------------------------------------

/**
 * Every autonomous action produces a durable decision record.
 * This is the audit trail for autonomy.
 */
export interface PolicyDecisionRecord {
  decisionId: string;                  // unique decision ID
  incidentId: string;                  // links to incident
  correlationId: string;               // links to operational events
  component: string;
  observedState: ComponentState;
  evidence: HealthEvidence[];
  candidateActions: CandidateAction[];
  selectedAction: CandidateAction | null;
  risk: RiskLevel;
  policy: AutonomyPolicy | null;       // null if no policy matched
  authorization: CapabilityAuthorization;
  executor: string;                    // who/what executed
  result: 'success' | 'failure' | 'denied' | 'escalated' | 'no_action' | 'pending';
  reason: string;                      // why this decision was made
  verification?: HealthEvidence[];     // postcondition evidence
  timestamp: string;
  detail?: Record<string, unknown>;
  // Phase 6: Observation confidence evidence
  observationSource?: string;          // what observed the failure (e.g. "docker-inspect", "rest-probe")
  observationState?: string;           // hysteresis state at decision time
  observationConfidence?: string;      // HIGH | MEDIUM | LOW | NONE
  corroboratingEvidence?: string[];    // sources that agree target is down
  conflictingEvidence?: string[];      // sources that say target is healthy
  failureClassification?: string;      // TARGET_FAILURE | OBSERVER_FAILURE | CONFIRMED_FAILURE | etc.
  recoveryJustification?: string;      // why HEIDI believed this component was actually broken
}

// ---------------------------------------------------------------------------
// Phase 4: Escalation
// ---------------------------------------------------------------------------

/**
 * An escalation package produced when recovery is exhausted or an action
 * is denied. Operator-readable, not just "Recovery failed."
 */
export interface EscalationPackage {
  escalationId: string;
  incidentId: string;
  component: string;
  state: ComponentState;
  evidence: HealthEvidence[];
  attemptedActions: Array<{
    action: string;
    result: string;
    timestamp: string;
    error?: string;
  }>;
  policyStoppedReason: string;        // why policy stopped further action
  recommendedNextAction: string;
  risk: RiskLevel;
  affectedComponents: string[];
  timestamp: string;
  // Phase 7: Recovery Failure Intelligence — enhanced escalation fields
  failureClassification?: RecoveryFailureClassification;
  attemptCount?: number;
  lastRecoveryAction?: string;
  lastFailureReason?: string;
  escalationRecord?: EscalationRecord;
}

// ---------------------------------------------------------------------------
// Phase 4: Recovery Budget & Circuit Breaker
// ---------------------------------------------------------------------------

/**
 * Global recovery budget limits.
 */
export interface RecoveryBudget {
  maxRecoveryActionsPerIncident: number;
  maxRetriesPerComponent: number;
  maxConcurrentRecoveries: number;
  maxAffectedComponents: number;
  circuitBreakerThreshold: number;     // consecutive failures before tripping
  circuitBreakerCooldownMs: number;    // how long to stay tripped
}

/**
 * Circuit breaker state for a component.
 */
export interface CircuitBreakerState {
  component: string;
  consecutiveFailures: number;
  tripped: boolean;
  trippedAt: string | null;
  lastFailureAt: string | null;
  totalAttempts: number;
  totalSuccesses: number;
}

// ---------------------------------------------------------------------------
// Phase 4: Recovery Lock (concurrency safety)
// ---------------------------------------------------------------------------

/**
 * A recovery lease preventing concurrent recovery of the same component.
 */
export interface RecoveryLease {
  component: string;
  holderId: string;                    // unique ID of the recovery instance
  acquiredAt: string;
  expiresAt: string;                   // lease timeout
  active: boolean;
}

// ---------------------------------------------------------------------------
// Phase 4: Enhanced Incident Model
// ---------------------------------------------------------------------------

/**
 * A correlated incident with root cause and dependent impacts.
 */
export interface Incident {
  incidentId: string;
  rootComponent: string;
  rootCause: string;
  affectedComponents: string[];
  evidence: HealthEvidence[];
  timeline: Array<{
    timestamp: string;
    event: string;
    component: string;
  }>;
  probableCause: string;
  confidence: number;                  // 0-100
  actions: Array<{
    action: string;
    result: string;
    timestamp: string;
  }>;
  finalState: ComponentState;
  state: 'active' | 'resolved' | 'escalated';
  correlationId: string;
  createdAt: string;
  resolvedAt?: string;
}

// ---------------------------------------------------------------------------
// Phase 4: Extended Operational Events
// ---------------------------------------------------------------------------

export type OperationalEventType =
  | 'state_transition'
  | 'failure_detected'
  | 'recovery_started'
  | 'recovery_step'
  | 'recovery_completed'
  | 'recovery_failed'
  | 'recovery_skipped'          // optional component — no_action policy
  | 'incident_correlated'
  | 'capability_denied'
  | 'probe_executed'
  | 'diagnostic_snapshot'
  | 'policy_decision'           // Phase 4: a policy was evaluated
  | 'action_selected'           // Phase 4: an action was selected
  | 'action_authorized'         // Phase 4: an action was authorized
  | 'action_denied'             // Phase 4: an action was denied by policy
  | 'escalation_triggered'      // Phase 4: escalation was triggered
  | 'circuit_breaker_tripped'   // Phase 4: circuit breaker tripped
  | 'recovery_lock_acquired'    // Phase 4: recovery lock acquired
  | 'recovery_lock_released'    // Phase 4: recovery lock released
  | 'budget_exhausted'          // Phase 4: recovery budget exhausted
  | 'self_health_check'         // Phase 5: HEIDI self-health check
  | 'degraded_mode_entered'     // Phase 5: entered intentional degraded mode
  | 'degraded_mode_exited'      // Phase 5: exited degraded mode
  | 'qualification_step'        // Phase 5: qualification suite step
  | 'failure_injected'          // Phase 5: failure was deliberately injected
  | 'soak_metric'               // Phase 5: soak test metric recorded
  | 'observation_uncertain'     // Phase 6: observation confidence too low to act
  | 'false_recovery_prevented'  // Phase 6: recovery was correctly NOT triggered
  | 'recovery_stopped';         // Phase 7: recovery was intelligently stopped (non-retryable)

// ---------------------------------------------------------------------------
// Phase 6: Observation Confidence & Corroboration
// ---------------------------------------------------------------------------

/**
 * Classification of why an observation reported failure.
 * This is the core distinction that prevents false-positive recovery.
 *
 * - TARGET_FAILURE: Evidence indicates the actual component/service is unhealthy.
 * - OBSERVER_FAILURE: The mechanism used to inspect the component failed.
 * - DEPENDENCY_FAILURE: Target cannot be evaluated because upstream is unavailable.
 * - TRANSIENT_OBSERVATION: Observation failed once or temporarily.
 * - CONFIRMED_FAILURE: Multiple independent observations agree target is unhealthy.
 * - OBSERVATION_UNCERTAIN: Insufficient evidence to classify either way.
 */
export type FailureClassification =
  | 'HEALTHY'                // All sources confirm target is healthy
  | 'TARGET_FAILURE'         // Evidence indicates the actual component/service is unhealthy
  | 'OBSERVER_FAILURE'       // The mechanism used to inspect the component failed
  | 'DEPENDENCY_FAILURE'     // Target cannot be evaluated because upstream is unavailable
  | 'TRANSIENT_OBSERVATION'  // Observation failed once or temporarily
  | 'CONFIRMED_FAILURE'      // Multiple independent observations agree target is unhealthy
  | 'OBSERVATION_UNCERTAIN'; // Insufficient evidence to classify either way

/**
 * The confidence level of an observation.
 * Controls whether recovery may be authorized.
 *
 * - HIGH: Multiple independent sources agree → recovery may proceed
 * - MEDIUM: Primary source failed, secondary source confirms → recovery may proceed
 * - LOW: Primary source failed, no corroboration → recovery must NOT proceed
 * - NONE: All observation sources failed → escalate, do not recover blindly
 */
export type ObservationConfidence = 'HIGH' | 'MEDIUM' | 'LOW' | 'NONE';

/**
 * A single observation from one source (e.g. docker inspect, REST probe).
 */
export interface ObservationSource {
  name: string;                    // e.g. "docker-inspect", "rest-probe", "health-endpoint"
  ok: boolean;                     // did this source report success?
  value: string;                   // e.g. "running", "HTTP 200", "docker inspect failed"
  latencyMs?: number;
  checkedAt: string;               // ISO timestamp
  isObserverFailure: boolean;      // true = the source itself failed (not the target)
}

/**
 * The result of classifying an observation with confidence and corroboration.
 * This is what the recovery authorization layer evaluates.
 */
export interface ObservationAssessment {
  component: string;
  classification: FailureClassification;
  confidence: ObservationConfidence;
  sources: ObservationSource[];
  corroboratingEvidence: ObservationSource[];  // sources that agree target is down
  conflictingEvidence: ObservationSource[];    // sources that say target is healthy
  recoveryAuthorized: boolean;    // false when uncertain — the key safety gate
  reason: string;                 // human-readable explanation
  timestamp: string;
}

/**
 * Anti-flap hysteresis state for a single component.
 * Prevents a single failed observation from triggering recovery.
 */
export type ObservationHysteresisState =
  | 'HEALTHY'                // all observations passing
  | 'DEGRADED'               // some sources failing, others healthy
  | 'OBSERVATION_UNCERTAIN'  // observer failure, target status unknown
  | 'FAILURE_SUSPECTED'      // multiple failures but not yet confirmed
  | 'FAILURE_CONFIRMED'      // corroborated failure — recovery authorized
  | 'RECOVERING'             // recovery in progress
  | 'OBSERVER_FAILED';       // observation mechanism itself is broken

/**
 * Tracked observation history entry for hysteresis.
 */
export interface ObservationHistoryEntry {
  component: string;
  timestamp: string;
  ok: boolean;
  classification: FailureClassification;
  confidence: ObservationConfidence;
}

// ---------------------------------------------------------------------------
// Phase 5: Recovery Action Registry
// ---------------------------------------------------------------------------

/**
 * One authoritative registry entry for a recoverable action.
 * Every action HEIDI can take is registered here with full metadata.
 */
export interface ActionRegistryEntry {
  actionId: string;                    // unique action ID (e.g. "restart.protoforge-core")
  actionType: RecoveryPolicyId;        // what kind of action
  targetComponent: string;             // which component this acts on
  purpose: string;                     // why this action exists
  prerequisites: string[];             // what must be true before executing
  authorizationClass: AuthorizationMode;
  riskLevel: RiskLevel;
  reversibility: 'reversible' | 'irreversible' | 'partial';
  timeoutMs: number;                   // max execution time
  retryPolicy: {
    maxAttempts: number;
    cooldownMs: number;
  };
  cooldownMs: number;                  // minimum time between invocations
  expectedStateTransition: {
    from: ComponentState;
    to: ComponentState;
  };
  verificationStrategy: string;        // how recovery is verified
  escalationBehavior: string;          // what happens if this action fails
}

// ---------------------------------------------------------------------------
// Phase 5: Self-Health Model
// ---------------------------------------------------------------------------

/**
 * HEIDI's own operational health, separate from the components it manages.
 */
export interface SelfHealthState {
  timestamp: string;
  heidiAlive: boolean;                 // is the control plane process running?
  loopHealthy: boolean;                // is the observation loop cycling?
  lastObservationAge: number;          // seconds since last observation cycle
  memoryUsageMb: number;               // process memory usage
  memoryGrowthRate: number;            // bytes/second growth trend
  cpuPercent: number;                  // approximate CPU usage
  recoveryLatencyMs: number;           // last recovery duration
  repeatedExceptions: number;          // count of repeated errors
  persistenceWritable: boolean;        // can we write to operational event log?
  stuckRecoveries: number;             // recoveries that have been active too long
  capabilityFailures: number;          // recent capability authorization failures
  ownDependenciesHealthy: boolean;     // are HEIDI's own deps available?
  state: ComponentState;               // HEIDI's own state
  degradedMode: boolean;               // is HEIDI in intentional degraded mode?
  degradedReason?: string;             // why degraded mode was entered
}

// ---------------------------------------------------------------------------
// Phase 5: Failure Injection Framework
// ---------------------------------------------------------------------------

/**
 * A structured failure injection scenario.
 */
export interface FailureScenario {
  scenarioId: string;                  // unique scenario ID
  name: string;                        // human-readable name
  failureClass: 'A' | 'B' | 'C' | 'D' | 'E' | 'F';  // process, container, dependency, AI, persistence, bridge
  description: string;                 // what the scenario does
  targetComponent: string;             // which component to inject failure into
  setup: string[];                     // setup steps (readable)
  expectedObservation: string;         // what HEIDI should detect
  expectedDiagnosis: string;           // what HEIDI should conclude
  expectedAction: RecoveryPolicyId;    // what HEIDI should do
  expectedVerification: string;        // how recovery should be verified
  cleanup: string[];                   // cleanup steps
  riskLevel: RiskLevel;                // risk of injecting this failure
  timeoutMs: number;                   // max time for the whole scenario
}

/**
 * Result of running a failure scenario.
 */
export interface FailureScenarioResult {
  scenarioId: string;
  name: string;
  failureClass: string;
  injected: boolean;                   // was the failure successfully injected?
  detected: boolean;                   // did HEIDI detect the failure?
  diagnosed: boolean;                  // did HEIDI diagnose it correctly?
  actionSelected: string | null;       // what action was selected
  actionExecuted: boolean;             // was the action executed?
  recovered: boolean;                  // did the component return to HEALTHY?
  verified: boolean;                   // was recovery verified with evidence?
  escalated: boolean;                  // was it escalated instead?
  durationMs: number;                  // total scenario duration
  evidence: HealthEvidence[];          // evidence collected
  error?: string;                      // error if scenario failed
}

// ---------------------------------------------------------------------------
// Phase 5: Qualification Suite
// ---------------------------------------------------------------------------

/**
 * Result of a qualification run.
 */
export interface QualificationResult {
  suiteName: string;
  timestamp: string;
  scenarios: FailureScenarioResult[];
  totalScenarios: number;
  passed: number;
  failed: number;
  escalated: number;                   // safe escalation counts as pass
  durationMs: number;
  overallVerdict: 'OPERATIONAL' | 'OPERATIONAL_WITH_LIMITATIONS' | 'NOT_OPERATIONAL';
  evidence: {
    baselineHealthy: boolean;
    allScenariosCompleted: boolean;
    recoverySuccessRate: number;       // 0-100
    escalationRate: number;            // 0-100
  };
}

// ---------------------------------------------------------------------------
// Phase 5: Soak Metrics
// ---------------------------------------------------------------------------

export interface SoakMetrics {
  durationMs: number;
  totalChecks: number;
  healthSuccessRate: number;           // 0-100
  incidentDetectionLatencyMs: number;  // average
  recoveryLatencyMs: number;           // average
  recoverySuccessRate: number;         // 0-100
  failedActions: number;
  repeatedIncidents: number;
  memoryGrowthMb: number;              // total growth over soak
  cpuAveragePercent: number;
  persistenceFailures: number;
  eventJournalIntegrity: boolean;      // did the journal survive intact?
  verdict: 'PASS' | 'FAIL';
}
