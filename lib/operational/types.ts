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
  | 'recovery';

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
  actionResult?: 'success' | 'failure' | 'denied' | 'skipped';
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
  | 'budget_exhausted';         // Phase 4: recovery budget exhausted
