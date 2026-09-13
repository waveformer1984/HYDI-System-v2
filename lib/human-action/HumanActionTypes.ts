/**
 * HYDI Human Action Types — The Action Abstraction
 *
 * This module defines the provider-independent action model that sits
 * between the HEIDI reasoning layer and the controlled execution layer.
 *
 * Architecture:
 *   LLM/HEIDI → proposes HumanActionIntent → ActionPolicyEvaluator
 *   → ActionAuthorizer → ActionExecutor → ActionVerifier → ActionRecorder
 *
 * The reasoning layer NEVER directly executes. It produces an intent.
 * The controlled execution layer validates, authorizes, executes, verifies,
 * and records.
 *
 * Key principles:
 *   - HumanActionIntent is what the reasoning layer proposes
 *   - HumanAction is the authorized, validated action that gets executed
 *   - HumanActionResult is the verified outcome
 *   - Secret material NEVER appears in any of these types
 *   - Every action has a rollback strategy and verification strategy
 *   - Risk maps to the existing R0-R5 RiskLevel system
 */

import type { RiskLevel } from '../operational/types';

// ---------------------------------------------------------------------------
// Action Categories — what domain the action belongs to
// ---------------------------------------------------------------------------

export type ActionCategory =
  | 'SYSTEM'           // filesystem, process, shell, service management
  | 'NETWORK'          // HTTP requests, DNS, connectivity
  | 'BROWSER'          // web automation
  | 'DEVELOPMENT'      // git, build, test, deploy
  | 'INFRASTRUCTURE'   // Docker, service restart, config change
  | 'CREDENTIALS'      // credential lifecycle
  | 'COMMUNICATION'    // email, messaging
  | 'FINANCIAL'        // payments, transfers, subscriptions
  | 'COGNITIVE';       // HEIDI internal operations (goals, memory, observation)

// ---------------------------------------------------------------------------
// Authorization Scopes — delegated authority model
// ---------------------------------------------------------------------------

export type AuthorizationScope =
  | 'READ_ONLY'              // inspect status, read files, check health
  | 'LOCAL_WRITE'            // create/modify local files, dev config
  | 'SERVICE_OPERATION'      // restart dev services, run tests
  | 'EXTERNAL_COMMUNICATION' // send emails, messages to external parties
  | 'ACCOUNT_CONFIGURATION'  // modify provider accounts, API settings
  | 'CREDENTIAL_MANAGEMENT'  // rotate, revoke, provision credentials
  | 'DEPLOYMENT'             // deploy to production, push branches
  | 'FINANCIAL'              // payments, purchases, subscriptions
  | 'DESTRUCTIVE';           // deletion, irreversible changes

// ---------------------------------------------------------------------------
// Action Lifecycle States
// ---------------------------------------------------------------------------

export type ActionState =
  | 'PROPOSED'           // reasoning layer proposed it, not yet evaluated
  | 'POLICY_EVALUATED'   // policy engine has evaluated it
  | 'AUTHORIZED'         // authorization granted
  | 'DENIED'             // authorization denied
  | 'PENDING_HUMAN'      // requires human authorization
  | 'EXECUTING'          // execution in progress
  | 'EXECUTED'           // execution completed, not yet verified
  | 'VERIFIED'           // execution verified successful
  | 'VERIFICATION_FAILED' // execution completed but verification failed
  | 'EXECUTION_FAILED'   // execution itself failed
  | 'ROLLING_BACK'       // rollback in progress
  | 'ROLLED_BACK'        // rollback completed
  | 'ROLLBACK_FAILED'    // rollback attempted but failed
  | 'BLOCKED'            // blocked by dependency or human intervention needed
  | 'RECOVERING'         // recovery action in progress
  | 'COMPLETED'          // fully done (verified or rolled back)
  | 'TIMEOUT'            // action timed out
  | 'PAUSED';            // paused for human intervention (e.g. MFA)

// ---------------------------------------------------------------------------
// Action Lifecycle Capability Labels (PHASE 21 — no overclaiming)
// ---------------------------------------------------------------------------

export type LifecycleCapability =
  | 'AUTOMATED'                 // HYDI can do this fully autonomously
  | 'SUPPORTED'                 // HYDI can do this with authorization
  | 'REQUIRES_AUTHORIZATION'    // HYDI can do it but needs explicit auth
  | 'REQUIRES_HUMAN_ACTION'     // a human must perform part of this
  | 'UNSUPPORTED'               // HYDI cannot do this
  | 'FAILED'                    // HYDI attempted and failed
  | 'UNKNOWN';                  // not yet determined

// ---------------------------------------------------------------------------
// HumanActionIntent — what the reasoning layer proposes
// ---------------------------------------------------------------------------

/**
 * The intent proposed by the reasoning layer. This is NOT executed directly.
 * It must pass through policy evaluation and authorization first.
 *
 * Secret material must NEVER be included in parameters.
 * Use opaque credential references (cred_01J...) instead.
 */
export interface HumanActionIntent {
  intentId: string;                    // unique intent ID
  goalId: string;                      // which goal this action serves
  actor: string;                       // who proposed this (e.g. "heidi", "user:owner")
  category: ActionCategory;
  capability: string;                  // e.g. "filesystem.write_file"
  operation: string;                   // e.g. "write", "read", "navigate"
  target: string;                      // what to act on (path, URL, service name, etc.)
  parameters: ActionParameters;        // structured parameters (NO secrets)
  reason: string;                      // why this action was proposed
  expectedResult: string;              // what should happen if successful
  dependencies?: string[];             // other action IDs that must complete first
  parentActionId?: string;             // if this is a sub-action
}

/**
 * Action parameters — structured, no raw secrets.
 * Credential references use opaque IDs that are resolved by the vault
 * at execution time, never in the reasoning layer.
 */
export interface ActionParameters {
  [key: string]: unknown;
  // Common fields:
  // path?: string;          — filesystem path
  // url?: string;           — URL for HTTP/browser
  // content?: string;       — content to write
  // command?: string;       — structured command (NOT arbitrary shell)
  // args?: string[];        — structured arguments
  // credentialRef?: string; — opaque credential reference (cred_01J...)
  // selector?: string;      — CSS/XPath selector for browser
  // value?: string;         — value to type/select
  // method?: string;        — HTTP method
  // headers?: Record<string, string>; — HTTP headers (no auth headers)
  // body?: unknown;         — HTTP body
  // recipient?: string;     — email/message recipient
  // subject?: string;       — email subject
  // messageBody?: string;   — email/message body
}

// ---------------------------------------------------------------------------
// HumanAction — the authorized, validated action
// ---------------------------------------------------------------------------

/**
 * The fully-specified action after policy evaluation and authorization.
 * This is what gets passed to the executor.
 */
export interface HumanAction {
  actionId: string;                    // unique action ID
  intentId: string;                    // links back to the intent
  goalId: string;
  actor: string;
  authorizedBy: string;                // who/what authorized this
  category: ActionCategory;
  capability: string;
  operation: string;
  target: string;
  parameters: ActionParameters;
  risk: RiskLevel;                     // R0-R5, mapped from category+operation
  riskLabel: ActionRiskLabel;          // LOW/MEDIUM/HIGH/CRITICAL
  reversibility: Reversibility;        // is this reversible?
  authorizationScope: AuthorizationScope;
  authorizationMode: AuthorizationMode;
  dependencies: string[];              // action IDs that must complete first
  expectedResult: string;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  rollbackStrategy: RollbackStrategy;
  verificationStrategy: VerificationStrategy;
  state: ActionState;
  createdAt: string;
  startedAt?: string;
  completedAt?: string;
}

export type ActionRiskLabel = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';

export type Reversibility =
  | 'REVERSIBLE'         // can be undone (e.g. file modification with backup)
  | 'PARTIALLY_REVERSIBLE' // can be partially undone
  | 'IRREVERSIBLE'        // cannot be undone (e.g. deletion without backup)
  | 'UNKNOWN';            // reversibility not determined

export type AuthorizationMode =
  | 'autonomous'           // HEIDI can do this without human approval
  | 'policy_authorized'    // allowed by explicit policy rule
  | 'human_required'       // requires human authorization
  | 'prohibited';          // never allowed

export interface RetryPolicy {
  maxAttempts: number;
  cooldownMs: number;
  backoffMultiplier: number;     // exponential backoff
  retryableErrors: string[];     // error patterns that warrant retry
}

export interface RollbackStrategy {
  type: 'backup_restore' | 'undo_operation' | 'recreate' | 'not_possible' | 'manual';
  description: string;
  backupPath?: string;            // for backup_restore
  undoAction?: string;            // for undo_operation (e.g. "delete created file")
  manualSteps?: string[];         // for manual rollback
}

export interface VerificationStrategy {
  type: 'state_check' | 'output_check' | 'health_check' | 'api_response' | 'file_exists' | 'process_running' | 'url_accessible' | 'custom';
  description: string;
  checkParams?: Record<string, unknown>;
  expectedValue?: unknown;
  timeoutMs?: number;
}

// ---------------------------------------------------------------------------
// HumanActionResult — the verified outcome
// ---------------------------------------------------------------------------

export interface HumanActionResult {
  actionId: string;
  state: ActionState;
  executed: boolean;
  verified: boolean;
  outcome: 'success' | 'failure' | 'denied' | 'blocked' | 'timeout' | 'rolled_back' | 'pending_human';
  result: unknown;                    // safe result data (NO secrets)
  error: string | null;
  evidence: ActionEvidence[];         // evidence chain
  durationMs: number;
  rollbackResult?: RollbackResult;
  recoveryAttempted?: boolean;
  recoveryResult?: string;
  timestamp: string;
}

export interface ActionEvidence {
  check: string;                      // e.g. "file_exists", "exit_code", "http_status"
  status: 'pass' | 'fail' | 'warn' | 'skip';
  value: string;                      // e.g. "HTTP 200", "exit code 0", "file created"
  detail?: string;
  checkedAt: string;
}

export interface RollbackResult {
  attempted: boolean;
  succeeded: boolean;
  evidence: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Human Intervention Protocol
// ---------------------------------------------------------------------------

export interface HumanInterventionRequest {
  requestId: string;
  actionId: string;
  goalId: string;
  reason: string;                     // why human intervention is needed
  whatWasAttempted: string;           // what HYDI tried
  whatSucceeded: string;              // what worked
  whatFailed: string;                 // what didn't work
  whyCannotContinue: string;          // why HYDI can't continue
  requiredHumanAction: string;        // EXACT action the human must take
  whatHappensAfter: string;           // what HYDI will do after human acts
  interventionType: InterventionType;
  timestamp: string;
}

export type InterventionType =
  | 'MFA_REQUIRED'           // multi-factor authentication
  | 'CAPTCHA_REQUIRED'       // CAPTCHA challenge
  | 'BIOMETRIC_REQUIRED'     // biometric prompt
  | 'SECURITY_KEY_REQUIRED'  // hardware security key
  | 'MANUAL_CREDENTIAL_ENTRY' // human must enter credentials
  | 'POLICY_AUTHORIZATION'   // human must authorize a high-risk action
  | 'UNSUPPORTED_OPERATION'  // HYDI cannot perform this operation
  | 'DESTRUCTIVE_CONFIRMATION' // human must confirm destructive action
  | 'EXTERNAL_ACCOUNT_ACCESS' // human must log in to external account
  | 'UNKNOWN';               // unknown intervention needed

// ---------------------------------------------------------------------------
// Goal Decomposition
// ---------------------------------------------------------------------------

export interface HumanGoal {
  goalId: string;
  statedBy: string;                   // who stated the goal (e.g. "user:owner")
  statement: string;                  // natural language goal
  context?: string;                   // additional context
  createdAt: string;
  state: 'pending' | 'planning' | 'executing' | 'blocked' | 'completed' | 'failed' | 'abandoned';
  actionGraph?: ActionGraph;          // populated after decomposition
  summary?: string;                   // final summary of what happened
}

export interface ActionGraph {
  goalId: string;
  nodes: ActionGraphNode[];
  edges: ActionGraphEdge[];
  executionOrder: string[];           // topologically sorted action IDs
}

export interface ActionGraphNode {
  actionId: string;
  intent: HumanActionIntent;
  status: 'pending' | 'ready' | 'executing' | 'completed' | 'failed' | 'blocked' | 'skipped';
  dependsOn: string[];
}

export interface ActionGraphEdge {
  from: string;                       // action ID
  to: string;                         // action ID
  type: 'dependency' | 'rollback' | 'verification';
}

// ---------------------------------------------------------------------------
// Action Journal Entry — persistent audit trail
// ---------------------------------------------------------------------------

export interface ActionJournalEntry {
  entryId: string;
  actionId: string;
  goalId: string;
  actor: string;
  authorizedBy: string;
  timestamp: string;
  category: ActionCategory;
  capability: string;
  operation: string;
  target: string;
  parametersRedacted: Record<string, unknown>; // secrets redacted
  state: ActionState;
  result: HumanActionResult | null;
  verificationResult: string | null;
  rollbackResult: RollbackResult | null;
  failure: string | null;
  recovery: string | null;
  finalState: ActionState;
  interventionRequest: HumanInterventionRequest | null;
}

// ---------------------------------------------------------------------------
// Capability Descriptor for the Action Capability Registry
// ---------------------------------------------------------------------------

export interface ActionCapabilityDescriptor {
  capabilityId: string;               // e.g. "filesystem.write_file"
  category: ActionCategory;
  name: string;
  description: string;
  risk: RiskLevel;
  riskLabel: ActionRiskLabel;
  authorizationScope: AuthorizationScope;
  authorizationMode: AuthorizationMode;
  reversible: Reversibility;
  allowedTargets: TargetPattern[];    // patterns for valid targets
  requiresHumanApproval: boolean;
  verificationRequirements: string;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
  rollbackStrategyTemplate: RollbackStrategy;
  verificationStrategyTemplate: VerificationStrategy;
  adapterId: string;                  // which adapter handles this
  lifecycleCapability: LifecycleCapability;
  status: ActionCapabilityStatus;
  healthNote: string | null;
}

export type ActionCapabilityStatus =
  | 'AVAILABLE'
  | 'DEGRADED'
  | 'BLOCKED'
  | 'DISABLED'
  | 'REQUIRES_AUTHORIZATION'
  | 'UNSUPPORTED';

export interface TargetPattern {
  type: 'glob' | 'regex' | 'exact' | 'prefix' | 'url_pattern' | 'module_id' | 'any';
  pattern: string;
  description: string;
}

// ---------------------------------------------------------------------------
// Adapter Interface — pluggable action adapters
// ---------------------------------------------------------------------------

/**
 * Each adapter implements this interface. The HumanActionEngine dispatches
 * authorized actions to the appropriate adapter based on the capability.
 */
export interface ActionAdapter {
  adapterId: string;                   // e.g. "filesystem", "browser", "http"
  category: ActionCategory;
  capabilities: string[];              // capability IDs this adapter handles

  /**
   * Execute an authorized action.
   * Must NEVER receive secret material directly — use credential refs.
   */
  execute(
    action: HumanAction,
    context: ActionExecutionContext,
  ): Promise<ActionExecutionResult>;

  /**
   * Verify that an action produced the expected result.
   */
  verify(
    action: HumanAction,
    executionResult: ActionExecutionResult,
    context: ActionExecutionContext,
  ): Promise<ActionVerificationResult>;

  /**
   * Rollback an action if possible.
   */
  rollback(
    action: HumanAction,
    executionResult: ActionExecutionResult,
    context: ActionExecutionContext,
  ): Promise<RollbackResult>;

  /**
   * Check if this adapter is currently available.
   */
  isAvailable(): { available: boolean; reason: string | null };

  /**
   * Observe the current state of a target before acting.
   */
  observe?(
    target: string,
    context: ActionExecutionContext,
  ): Promise<ActionObservation>;
}

export interface ActionExecutionContext {
  sessionId: string;
  actorId: string;
  authorizationMode: AuthorizationMode;
  authorizationScope: AuthorizationScope;
  auditTrail: ActionJournalEntry[];
  /** Resolve a credential reference to material — ONLY available in executor context */
  resolveCredential?: (credentialRef: string) => Promise<string | null>;
  /** Record a human intervention request */
  requestHumanIntervention?: (request: HumanInterventionRequest) => void;
}

export interface ActionExecutionResult {
  executed: boolean;
  output: unknown;                     // safe output (NO secrets)
  error: string | null;
  evidence: ActionEvidence[];
  durationMs: number;
  /** State snapshot for rollback */
  preExecutionState?: ActionObservation;
  postExecutionState?: ActionObservation;
}

export interface ActionVerificationResult {
  verified: boolean;
  evidence: ActionEvidence[];
  reason: string;
}

export interface ActionObservation {
  target: string;
  exists: boolean;
  state: string;                       // human-readable state description
  properties: Record<string, unknown>; // safe properties (NO secrets)
  observedAt: string;
}

// ---------------------------------------------------------------------------
// Policy Evaluation Result for Human Actions
// ---------------------------------------------------------------------------

export interface ActionPolicyEvaluation {
  intentId: string;
  allowed: boolean;
  risk: RiskLevel;
  riskLabel: ActionRiskLabel;
  authorizationMode: AuthorizationMode;
  authorizationScope: AuthorizationScope;
  reason: string;
  conditions: { met: string[]; failed: string[] };
  requiresHumanApproval: boolean;
  rollbackStrategy: RollbackStrategy;
  verificationStrategy: VerificationStrategy;
  timeoutMs: number;
  retryPolicy: RetryPolicy;
}
