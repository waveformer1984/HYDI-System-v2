/**
 * HYDI Capability Contract v1
 *
 * The single descriptor that the planner consumes. Nothing else.
 *
 * WHY THIS EXISTS
 * ---------------
 * HYDI accumulated four parallel governance stacks, each holding one piece
 * of the answer and none of them sharing a descriptor:
 *
 *   lib/heidi/CapabilityRegistry      static riskLevel, verification as prose
 *   lib/delegated-operator/…Contract  executable predicates, orphaned from the registry
 *   lib/human-action/AuthorityManager resource patterns + confirmation policy
 *   lib/operational/CapabilityAuthorizer hardcoded module allowlist
 *
 * The consequence is that CognitiveCore.verifyAction() is a hand-written
 * if-chain over capability ids: every new capability requires editing the
 * planner. That is the ceiling. This contract removes it.
 *
 * THE INVARIANT
 * -------------
 * A capability describes itself completely enough that the planner never
 * needs to know what it *is*. Fabrication and `npm test` become the same
 * kind of object: something with a cost, a blast radius, an authority
 * function, and a success predicate.
 *
 * FAIL-CLOSED
 * -----------
 * Absence of information is never treated as permission. A capability that
 * cannot state a verification predicate is capped at R1 (recommend-only)
 * by ContractValidator, permanently, no matter how safe it looks.
 */

import type { RiskLevel } from '../operational/types';

// ---------------------------------------------------------------------------
// Identity
// ---------------------------------------------------------------------------

export interface CapabilityIdentity {
  /** Stable id. Never reused for a different meaning. e.g. "process.restart" */
  id: string;
  /** Semantic version of the CONTRACT, not the implementation. */
  version: string;
  /** Human owner accountable for this capability's behaviour. */
  owner: string;
  /** Which subsystem implements it. Free-form: new providers must not require a type edit. */
  provider: string;
  /** Human-readable description. */
  description: string;
}

// ---------------------------------------------------------------------------
// Signature — typed inputs/outputs
// ---------------------------------------------------------------------------

export type ParamType = 'string' | 'number' | 'boolean' | 'object' | 'array' | 'null';

export interface ParamSpec {
  name: string;
  type: ParamType;
  required: boolean;
  description: string;
  /** Optional enumerated set of legal values. */
  enum?: Array<string | number>;
  /** Optional regex (as source string) the value must match. Strings only. */
  pattern?: string;
  /** Marks a parameter as naming a resource, so blast radius can be computed from it. */
  resourceRef?: ResourceKind;
}

export interface CapabilitySignature {
  params: ParamSpec[];
  /** Description of the shape returned on success. */
  returns: string;
}

// ---------------------------------------------------------------------------
// Preconditions
// ---------------------------------------------------------------------------

/**
 * A precondition is evaluated against the current world state BEFORE
 * authority is computed. A failed precondition is not a denial — it is a
 * "not now", and the planner may schedule work to satisfy it.
 */
export interface Precondition {
  id: string;
  description: string;
  /** Pure predicate over the system state snapshot. Must not perform I/O. */
  test: (state: SystemStateSnapshot, args: CapabilityArgs) => boolean;
  /** Capability id that, if run, would likely satisfy this precondition. */
  satisfiedBy?: string;
}

// ---------------------------------------------------------------------------
// Effects and blast radius
// ---------------------------------------------------------------------------

export type ResourceKind =
  | 'file_path'
  | 'url'
  | 'service'
  | 'process'
  | 'database'
  | 'credential'
  | 'repository'
  | 'external_party'
  | 'money'
  | 'physical_machine'
  | 'any';

export type EffectVerb =
  | 'read'
  | 'create'
  | 'update'
  | 'delete'
  | 'restart'
  | 'deploy'
  | 'communicate'
  | 'transact'
  | 'actuate';

/** Ordered widest-last. Index is meaningful — see BlastRadius.ts. */
export const BLAST_SCOPES = [
  'none',
  'self',
  'single_resource',
  'subsystem',
  'system',
  'external',
  'irreversible_physical',
] as const;

export type BlastScope = (typeof BLAST_SCOPES)[number];

export interface EffectSpec {
  verb: EffectVerb;
  /** What kind of thing is touched. */
  resourceKind: ResourceKind;
  /**
   * Which concrete resources may be touched. A capability whose effects
   * cannot be bounded by patterns is, by definition, unbounded — and is
   * treated as `system` scope at minimum.
   */
  resourcePatterns: string[];
  /** Widest plausible consequence if this effect goes wrong. */
  worstCaseScope: BlastScope;
  /** Whether the effect leaves the machine/org boundary. */
  crossesTrustBoundary: boolean;
}

// ---------------------------------------------------------------------------
// Reversibility
// ---------------------------------------------------------------------------

export type ReversibilityKind =
  /** An inverse capability exists and is itself registered. */
  | 'inverse_capability'
  /** State is snapshotted before execution and can be restored. */
  | 'snapshot_restore'
  /** Effect decays on its own (e.g. a cache write, a temp file). */
  | 'self_healing'
  /** No mechanical undo. Money sent, email delivered, filament extruded. */
  | 'none';

export interface Reversibility {
  kind: ReversibilityKind;
  /** For `inverse_capability`: the capability id that undoes this one. */
  inverseCapabilityId?: string;
  /** How long the undo remains possible. Infinity for unbounded. */
  windowMs: number;
  /** Honest note about what the undo does NOT restore. */
  caveat: string;
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export interface CostSpec {
  /** Expected wall-clock duration. */
  estimatedMs: number;
  /** Hard timeout. Exceeding this is a failure, not a slow success. */
  timeoutMs: number;
  /** Direct monetary cost in minor units (cents). */
  estimatedCostCents: number;
  /** Consumable material, e.g. { grams: 84 } for a print. Free-form. */
  materials: Record<string, number>;
  /**
   * Wear on a physical asset, 0-1, as a fraction of a maintenance interval.
   * 0 for pure software.
   */
  wearFraction: number;
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export type ObservationSource =
  | 'api_response'
  | 'database'
  | 'filesystem'
  | 'process'
  | 'http_probe'
  | 'browser'
  | 'sensor'
  | 'camera'
  | 'ledger'
  | 'none';

export interface ObservationSpec {
  source: ObservationSource;
  /** URL, path, process name, table, sensor id. */
  target: string;
  /** Fields to extract from the observation for predicate evaluation. */
  extractFields: string[];
  /** Wait before observing — for effects that are not immediately visible. */
  settleMs: number;
}

export type ConditionOperator =
  | 'eq' | 'neq' | 'gt' | 'lt' | 'gte' | 'lte'
  | 'contains' | 'matches' | 'exists' | 'not_null';

export interface VerificationCondition {
  field: string;
  operator: ConditionOperator;
  expected: string | number | boolean | null;
}

export interface VerificationSpec {
  /** Human-readable statement of what success means. */
  description: string;
  /** How to go look. */
  observation: ObservationSpec;
  /** ALL conditions must hold. Empty array is illegal — see ContractValidator. */
  conditions: VerificationCondition[];
  /** What the planner should do when verification fails. */
  onFailure: 'retry' | 'replan' | 'escalate' | 'rollback' | 'fail';
  maxRetries: number;
  /**
   * True when verification is genuinely impossible to automate and a human
   * must confirm. Forces the capability to R3 minimum.
   */
  requiresHumanConfirmation: boolean;
}

// ---------------------------------------------------------------------------
// Observability
// ---------------------------------------------------------------------------

export interface ObservabilitySpec {
  /** Event type emitted to the journal on execution. */
  eventType: string;
  /** Parameter names that must be redacted before journalling. */
  redactParams: string[];
  /** Metric names this capability contributes to. */
  metrics: string[];
}

// ---------------------------------------------------------------------------
// Simulation
// ---------------------------------------------------------------------------

export interface SimulationSpec {
  supported: boolean;
  /**
   * Produce a description of what WOULD happen, without doing it.
   * Must perform no writes. Read-only probes are permitted.
   */
  dryRun?: (args: CapabilityArgs, state: SystemStateSnapshot) => Promise<SimulationOutcome>;
  /** If unsupported, why — so the planner can explain itself. */
  unsupportedReason?: string;
}

export interface SimulationOutcome {
  wouldSucceed: boolean;
  predictedEffects: string[];
  predictedCost: CostSpec;
  warnings: string[];
  /** Resources the simulation determined would actually be touched. */
  resolvedTargets: string[];
}

// ---------------------------------------------------------------------------
// Safety interlocks (physical capabilities)
// ---------------------------------------------------------------------------

/**
 * Interlocks that must hold INDEPENDENTLY of this software. Software
 * watches; hardware stops. A physical capability that names no independent
 * interlock cannot exceed R1.
 */
export interface InterlockRequirement {
  id: string;
  description: string;
  /** How the interlock is implemented. `software_only` is never sufficient. */
  mechanism: 'hardware' | 'firmware' | 'electromechanical' | 'software_only';
  /** How HYDI confirms the interlock is present and armed. */
  verification: ObservationSpec;
}

// ---------------------------------------------------------------------------
// Authority
// ---------------------------------------------------------------------------

export interface SystemStateSnapshot {
  /** ISO timestamp of the snapshot. */
  at: string;
  /** Environment the action would run in. */
  environment: 'development' | 'staging' | 'production' | 'unknown';
  /** Whether a human is available to respond right now. */
  humanPresent: boolean;
  /** Current overall system health, 0-1. */
  healthScore: number;
  /** Components currently degraded or down. */
  degradedComponents: string[];
  /** Whether an incident is open. Raises tiers across the board. */
  incidentActive: boolean;
  /** Interlock ids currently verified as armed. */
  armedInterlocks: string[];
  /** Free-form additional state for capability-specific authority functions. */
  extra: Record<string, unknown>;
}

export type CapabilityArgs = Record<string, unknown>;

export interface AuthorityDecision {
  tier: RiskLevel;
  /** Every input that contributed, so the decision is explainable and auditable. */
  factors: AuthorityFactor[];
  /** Human-readable one-liner. */
  rationale: string;
  /** True when the tier exceeds what standing delegation allows. */
  requiresApproval: boolean;
}

export interface AuthorityFactor {
  name: string;
  value: string;
  /** How many tiers this factor pushed the result up. Negative is illegal. */
  escalation: number;
}

/**
 * Computes the authority tier for a SPECIFIC invocation.
 *
 * This is the correction that makes the whole model scale: `delete` on a
 * build artifact and `delete` on a customer database are the same verb at
 * wildly different tiers. Tier is a function, never a constant.
 */
export type AuthorityFunction = (
  args: CapabilityArgs,
  state: SystemStateSnapshot,
  contract: CapabilityContract,
) => AuthorityDecision;

// ---------------------------------------------------------------------------
// The contract
// ---------------------------------------------------------------------------

export interface CapabilityContract {
  identity: CapabilityIdentity;
  signature: CapabilitySignature;
  preconditions: Precondition[];
  effects: EffectSpec[];
  reversibility: Reversibility;
  cost: CostSpec;
  verification: VerificationSpec;
  observability: ObservabilitySpec;
  simulation: SimulationSpec;
  /** Required only for capabilities with a `physical_machine` effect. */
  interlocks: InterlockRequirement[];
  /**
   * Optional override. When absent, the default authority function derives
   * the tier from effects + reversibility + state. Overriding is for
   * capabilities with domain knowledge the generic function cannot have.
   */
  authority?: AuthorityFunction;
  /**
   * Ceiling imposed at registration by ContractValidator. The resolved tier
   * is never allowed to sit ABOVE what the contract can justify, and the
   * capability is never allowed to run at a tier the contract cannot verify.
   */
  maxTier: RiskLevel;
  /** Capability ids this one depends on. */
  dependencies: string[];
  metadata: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Execution
// ---------------------------------------------------------------------------

export interface ExecutionContext {
  sessionId: string;
  actorId: string;
  /** The delegation under which this runs. */
  authorityId: string | null;
  state: SystemStateSnapshot;
  /** Set when the planner is running a plan rather than a single action. */
  planId?: string;
}

export interface CapabilityExecutor {
  (args: CapabilityArgs, ctx: ExecutionContext): Promise<unknown>;
}

/**
 * An observer reads the world after execution so verification conditions can
 * be evaluated. Registered per ObservationSource — this is how a camera and
 * a Postgres table become interchangeable to the planner.
 *
 * `result` is what the executor returned. Most observers ignore it and go
 * look at the world instead — that is the point of verification. The
 * `api_response` source is the honest exception: for a capability whose only
 * observable outcome IS its response (a query that returns an answer, a send
 * that returns a delivery receipt), the response is the observation. Such
 * verification is weaker than re-reading the world, and contracts using it
 * should say so in `verification.description`.
 */
export interface Observer {
  (
    spec: ObservationSpec,
    args: CapabilityArgs,
    ctx: ExecutionContext,
    result: unknown,
  ): Promise<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Tier helpers
// ---------------------------------------------------------------------------

export const TIERS: RiskLevel[] = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'];

export function tierIndex(tier: RiskLevel): number {
  const i = TIERS.indexOf(tier);
  return i < 0 ? TIERS.length - 1 : i;
}

export function tierFromIndex(index: number): RiskLevel {
  const clamped = Math.max(0, Math.min(TIERS.length - 1, Math.round(index)));
  return TIERS[clamped];
}

export function maxTier(a: RiskLevel, b: RiskLevel): RiskLevel {
  return tierIndex(a) >= tierIndex(b) ? a : b;
}

export function minTier(a: RiskLevel, b: RiskLevel): RiskLevel {
  return tierIndex(a) <= tierIndex(b) ? a : b;
}
