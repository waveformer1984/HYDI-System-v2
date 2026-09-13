/**
 * HYDI Human Action Engine
 *
 * The main engine that orchestrates the full action lifecycle:
 *   INTENT → POLICY EVALUATION → AUTHORIZATION → OBSERVE →
 *   EXECUTE → OBSERVE → VERIFY → ROLLBACK (if needed) → RECORD
 *
 * This engine integrates with the existing HEIDI governed-autonomy
 * architecture through the ExecutionBridge. It does NOT create a
 * competing execution architecture.
 *
 * Safety boundary:
 *   - The reasoning layer (LLM/HEIDI) proposes intents
 *   - The policy engine evaluates and authorizes
 *   - The adapter executor performs the actual action
 *   - The verifier confirms the result
 *   - The journal records everything
 *   - Secret material NEVER crosses these boundaries
 */

import { randomUUID } from 'crypto';
import type {
  ActionAdapter,
  ActionExecutionContext,
  ActionExecutionResult,
  ActionGraph,
  ActionJournalEntry,
  ActionObservation,
  ActionPolicyEvaluation,
  ActionVerificationResult,
  AuthorizationMode,
  AuthorizationScope,
  HumanAction,
  HumanActionIntent,
  HumanActionResult,
  HumanGoal,
  HumanInterventionRequest,
  RollbackResult,
} from './HumanActionTypes';
import { ActionCapabilityRegistry } from './ActionCapabilityRegistry';
import { AuthorityManager, type DelegatedAuthority } from './AuthorityManager';
import { ActionJournal, redactParameters } from './ActionJournal';

// ---------------------------------------------------------------------------
// Risk mapping: R0-R5 → LOW/MEDIUM/HIGH/CRITICAL
// ---------------------------------------------------------------------------

export function riskLevelToLabel(risk: string): 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL' {
  switch (risk) {
    case 'R0': case 'R1': return 'LOW';
    case 'R2': return 'MEDIUM';
    case 'R3': case 'R4': return 'HIGH';
    case 'R5': return 'CRITICAL';
    default: return 'LOW';
  }
}

// ---------------------------------------------------------------------------
// Human Action Engine Configuration
// ---------------------------------------------------------------------------

export interface HumanActionEngineOptions {
  registry: ActionCapabilityRegistry;
  authorityManager: AuthorityManager;
  journal: ActionJournal;
  defaultAuthorityId?: string;
  /** Resolve credential reference to material — for executor context only */
  resolveCredential?: (credentialRef: string) => Promise<string | null>;
  /** Callback when human intervention is needed */
  onHumanIntervention?: (request: HumanInterventionRequest) => void;
  /** Max concurrent actions */
  maxConcurrent?: number;
}

// ---------------------------------------------------------------------------
// Human Action Engine
// ---------------------------------------------------------------------------

export class HumanActionEngine {
  private registry: ActionCapabilityRegistry;
  private authorityManager: AuthorityManager;
  private journal: ActionJournal;
  private adapters: Map<string, ActionAdapter> = new Map();
  private defaultAuthorityId: string | null;
  private resolveCredentialFn?: (credentialRef: string) => Promise<string | null>;
  private onHumanInterventionFn?: (request: HumanInterventionRequest) => void;
  private maxConcurrent: number;
  private activeActions: Set<string> = new Set();
  private goals: Map<string, HumanGoal> = new Map();

  constructor(opts: HumanActionEngineOptions) {
    this.registry = opts.registry;
    this.authorityManager = opts.authorityManager;
    this.journal = opts.journal;
    this.defaultAuthorityId = opts.defaultAuthorityId ?? null;
    this.resolveCredentialFn = opts.resolveCredential;
    this.onHumanInterventionFn = opts.onHumanIntervention;
    this.maxConcurrent = opts.maxConcurrent ?? 5;
  }

  // -----------------------------------------------------------------------
  // Adapter registration (PHASE 20 — pluggable adapters)
  // -----------------------------------------------------------------------

  registerAdapter(adapter: ActionAdapter): void {
    this.adapters.set(adapter.adapterId, adapter);
    // Update capability statuses based on adapter availability
    const available = adapter.isAvailable();
    this.registry.updateAdapterStatus(adapter.adapterId, available.available, available.reason);
  }

  getAdapter(adapterId: string): ActionAdapter | null {
    return this.adapters.get(adapterId) ?? null;
  }

  listAdapters(): ActionAdapter[] {
    return Array.from(this.adapters.values());
  }

  // -----------------------------------------------------------------------
  // Capability discovery (PHASE 19)
  // -----------------------------------------------------------------------

  /**
   * Answer "What can you do?" — returns all capabilities with their states.
   */
  describeCapabilities(): ReturnType<ActionCapabilityRegistry['describeCapabilities']> {
    return this.registry.describeCapabilities();
  }

  /**
   * Get capabilities grouped by category.
   */
  describeByCategory(): ReturnType<ActionCapabilityRegistry['describeByCategory']> {
    return this.registry.describeByCategory();
  }

  // -----------------------------------------------------------------------
  // Goal management (PHASE 10)
  // -----------------------------------------------------------------------

  /**
   * Register a goal stated by the user.
   */
  registerGoal(statement: string, statedBy: string, context?: string): HumanGoal {
    const goal: HumanGoal = {
      goalId: randomUUID(),
      statedBy,
      statement,
      context,
      createdAt: new Date().toISOString(),
      state: 'pending',
    };
    this.goals.set(goal.goalId, goal);
    return goal;
  }

  /**
   * Get a goal by ID.
   */
  getGoal(goalId: string): HumanGoal | null {
    return this.goals.get(goalId) ?? null;
  }

  /**
   * Update a goal's state.
   */
  updateGoalState(goalId: string, state: HumanGoal['state'], summary?: string): void {
    const goal = this.goals.get(goalId);
    if (!goal) return;
    goal.state = state;
    if (summary !== undefined) {
      goal.summary = summary;
    }
  }

  /**
   * Decompose a goal into an action graph.
   * The actual decomposition logic is provided by the GoalDecomposer (PHASE 10).
   * This method stores the resulting graph on the goal.
   */
  setGoalActionGraph(goalId: string, graph: ActionGraph): void {
    const goal = this.goals.get(goalId);
    if (!goal) return;
    goal.actionGraph = graph;
    goal.state = 'planning';
  }

  // -----------------------------------------------------------------------
  // Policy evaluation (PHASE 9, 21)
  // -----------------------------------------------------------------------

  /**
   * Evaluate a proposed intent against policy and authorization.
   * This does NOT execute — it only determines if the action is allowed.
   */
  evaluateIntent(intent: HumanActionIntent, authorityId?: string): ActionPolicyEvaluation {
    const authId = authorityId ?? this.defaultAuthorityId;
    if (!authId) {
      return {
        intentId: intent.intentId,
        allowed: false,
        risk: 'R5',
        riskLabel: 'CRITICAL',
        authorizationMode: 'prohibited',
        authorizationScope: 'READ_ONLY',
        reason: 'No authority delegated to HYDI',
        conditions: { met: [], failed: ['no_authority'] },
        requiresHumanApproval: true,
        rollbackStrategy: { type: 'not_possible', description: 'N/A' },
        verificationStrategy: { type: 'state_check', description: 'N/A' },
        timeoutMs: 30000,
        retryPolicy: { maxAttempts: 1, cooldownMs: 1000, backoffMultiplier: 2, retryableErrors: [] },
      };
    }

    // Get the capability descriptor
    const cap = this.registry.get(intent.capability);
    if (!cap) {
      return {
        intentId: intent.intentId,
        allowed: false,
        risk: 'R5',
        riskLabel: 'CRITICAL',
        authorizationMode: 'prohibited',
        authorizationScope: 'READ_ONLY',
        reason: `Capability '${intent.capability}' is not registered — HYDI cannot perform this action`,
        conditions: { met: [], failed: ['capability_not_registered'] },
        requiresHumanApproval: false,
        rollbackStrategy: { type: 'not_possible', description: 'N/A' },
        verificationStrategy: { type: 'state_check', description: 'N/A' },
        timeoutMs: 30000,
        retryPolicy: { maxAttempts: 1, cooldownMs: 1000, backoffMultiplier: 2, retryableErrors: [] },
      };
    }

    // Check capability executability
    const execCheck = this.registry.isExecutable(intent.capability, [cap.authorizationScope]);
    if (!execCheck.executable) {
      return {
        intentId: intent.intentId,
        allowed: false,
        risk: cap.risk,
        riskLabel: cap.riskLabel,
        authorizationMode: 'prohibited',
        authorizationScope: cap.authorizationScope,
        reason: execCheck.reason,
        conditions: { met: [], failed: ['capability_not_executable'] },
        requiresHumanApproval: false,
        rollbackStrategy: cap.rollbackStrategyTemplate,
        verificationStrategy: cap.verificationStrategyTemplate,
        timeoutMs: cap.timeoutMs,
        retryPolicy: cap.retryPolicy,
      };
    }

    // Check authority
    const authCheck = this.authorityManager.checkAuthorization(
      authId,
      cap.authorizationScope,
      cap.risk,
      cap.riskLabel,
      intent.target,
      intent.category,
    );

    return {
      intentId: intent.intentId,
      allowed: authCheck.authorized,
      risk: cap.risk,
      riskLabel: cap.riskLabel,
      authorizationMode: authCheck.mode,
      authorizationScope: cap.authorizationScope,
      reason: authCheck.reason,
      conditions: {
        met: authCheck.authorized ? ['capability_registered', 'authority_valid', 'scope_granted'] : [],
        failed: authCheck.authorized ? [] : [authCheck.reason],
      },
      requiresHumanApproval: authCheck.requiresConfirmation || cap.requiresHumanApproval,
      rollbackStrategy: cap.rollbackStrategyTemplate,
      verificationStrategy: cap.verificationStrategyTemplate,
      timeoutMs: cap.timeoutMs,
      retryPolicy: cap.retryPolicy,
    };
  }

  // -----------------------------------------------------------------------
  // Action execution (PHASE 11 — OBSERVE → EXECUTE → OBSERVE → VERIFY)
  // -----------------------------------------------------------------------

  /**
   * Execute a single action intent through the full governed lifecycle.
   *
   * Lifecycle:
   *   1. Evaluate intent against policy
   *   2. Authorize through delegated authority
   *   3. If human approval required → pause and request intervention
   *   4. Observe target before action
   *   5. Execute through adapter
   *   6. Observe target after action
   *   7. Verify result
   *   8. If verification fails and rollback is possible → rollback
   *   9. Record in journal
   *   10. Return result
   */
  async executeAction(
    intent: HumanActionIntent,
    authorityId?: string,
    options?: { dryRun?: boolean; forceAuthorize?: boolean },
  ): Promise<HumanActionResult> {
    const authId = authorityId ?? this.defaultAuthorityId;
    const actionId = randomUUID();
    const createdAt = new Date().toISOString();

    // Step 1: Evaluate intent
    const evaluation = this.evaluateIntent(intent, authId ?? undefined);

    // Build the HumanAction object
    const action: HumanAction = {
      actionId,
      intentId: intent.intentId,
      goalId: intent.goalId,
      actor: intent.actor,
      authorizedBy: authId ?? 'none',
      category: intent.category,
      capability: intent.capability,
      operation: intent.operation,
      target: intent.target,
      parameters: intent.parameters,
      risk: evaluation.risk,
      riskLabel: evaluation.riskLabel,
      reversibility: this.registry.get(intent.capability)?.reversible ?? 'UNKNOWN',
      authorizationScope: evaluation.authorizationScope,
      authorizationMode: evaluation.authorizationMode,
      dependencies: intent.dependencies ?? [],
      expectedResult: intent.expectedResult,
      timeoutMs: evaluation.timeoutMs,
      retryPolicy: evaluation.retryPolicy,
      rollbackStrategy: evaluation.rollbackStrategy,
      verificationStrategy: evaluation.verificationStrategy,
      state: 'POLICY_EVALUATED',
      createdAt,
    };

    // Dry run — return the evaluation without executing
    if (options?.dryRun) {
      action.state = 'PROPOSED';
      const result: HumanActionResult = {
        actionId,
        state: 'PROPOSED',
        executed: false,
        verified: false,
        outcome: 'denied',
        result: {
          dryRun: true,
          evaluation: {
            allowed: evaluation.allowed,
            risk: evaluation.risk,
            riskLabel: evaluation.riskLabel,
            authorizationMode: evaluation.authorizationMode,
            requiresHumanApproval: evaluation.requiresHumanApproval,
            reason: evaluation.reason,
          },
        },
        error: null,
        evidence: [{
          check: 'dry_run',
          status: 'pass',
          value: 'Dry run — no execution performed',
          checkedAt: new Date().toISOString(),
        }],
        durationMs: 0,
        timestamp: new Date().toISOString(),
      };
      this.journal.record(action, result, { verificationResult: 'dry-run' });
      return result;
    }

    // Step 2: Check authorization
    if (!evaluation.allowed && !options?.forceAuthorize) {
      // Distinguish between "denied by policy" and "blocked because capability unavailable"
      const cap = this.registry.get(intent.capability);
      const isBlocked = cap && (cap.status === 'BLOCKED' || cap.status === 'UNSUPPORTED' || cap.status === 'DISABLED');
      action.state = isBlocked ? 'BLOCKED' : 'DENIED';
      const result: HumanActionResult = {
        actionId,
        state: action.state,
        executed: false,
        verified: false,
        outcome: isBlocked ? 'blocked' : 'denied',
        result: { reason: evaluation.reason },
        error: evaluation.reason,
        evidence: [{
          check: 'policy_evaluation',
          status: 'fail',
          value: evaluation.reason,
          checkedAt: new Date().toISOString(),
        }],
        durationMs: 0,
        timestamp: new Date().toISOString(),
      };
      this.journal.record(action, result, { failure: evaluation.reason });
      return result;
    }

    // Step 3: Check if human approval is required
    if (evaluation.requiresHumanApproval && !options?.forceAuthorize) {
      action.state = 'PENDING_HUMAN';
      const intervention: HumanInterventionRequest = {
        requestId: randomUUID(),
        actionId,
        goalId: intent.goalId,
        reason: `Action requires human authorization: ${intent.capability} on ${intent.target}`,
        whatWasAttempted: `Proposed action: ${intent.capability} (${intent.operation}) on ${intent.target}`,
        whatSucceeded: 'Policy evaluation completed',
        whatFailed: 'Authorization requires human confirmation',
        whyCannotContinue: `This action is classified as ${evaluation.riskLabel} risk (${evaluation.risk}) and requires explicit human authorization`,
        requiredHumanAction: `Authorize action: ${intent.capability} on ${intent.target}. Reason: ${intent.reason}`,
        whatHappensAfter: 'HYDI will execute the action and verify the result',
        interventionType: 'POLICY_AUTHORIZATION',
        timestamp: new Date().toISOString(),
      };
      if (this.onHumanInterventionFn) {
        this.onHumanInterventionFn(intervention);
      }
      const result: HumanActionResult = {
        actionId,
        state: 'PENDING_HUMAN',
        executed: false,
        verified: false,
        outcome: 'pending_human',
        result: { intervention },
        error: null,
        evidence: [{
          check: 'human_authorization_required',
          status: 'warn',
          value: 'Action pending human authorization',
          checkedAt: new Date().toISOString(),
        }],
        durationMs: 0,
        timestamp: new Date().toISOString(),
      };
      this.journal.record(action, result, { interventionRequest: intervention });
      return result;
    }

    // Step 4: Get the adapter
    const cap = this.registry.get(intent.capability);
    if (!cap) {
      action.state = 'BLOCKED';
      const result: HumanActionResult = {
        actionId, state: 'BLOCKED', executed: false, verified: false,
        outcome: 'blocked', result: null,
        error: `Capability '${intent.capability}' not registered`,
        evidence: [], durationMs: 0, timestamp: new Date().toISOString(),
      };
      this.journal.record(action, result, { failure: 'capability_not_registered' });
      return result;
    }

    const adapter = this.adapters.get(cap.adapterId);
    if (!adapter) {
      action.state = 'BLOCKED';
      const result: HumanActionResult = {
        actionId, state: 'BLOCKED', executed: false, verified: false,
        outcome: 'blocked', result: null,
        error: `Adapter '${cap.adapterId}' not registered`,
        evidence: [], durationMs: 0, timestamp: new Date().toISOString(),
      };
      this.journal.record(action, result, { failure: 'adapter_not_registered' });
      return result;
    }

    // Check concurrency limit
    if (this.activeActions.size >= this.maxConcurrent) {
      action.state = 'BLOCKED';
      const result: HumanActionResult = {
        actionId, state: 'BLOCKED', executed: false, verified: false,
        outcome: 'blocked', result: null,
        error: `Max concurrent actions (${this.maxConcurrent}) reached`,
        evidence: [], durationMs: 0, timestamp: new Date().toISOString(),
      };
      this.journal.record(action, result, { failure: 'concurrency_limit' });
      return result;
    }

    // Step 5: Execute
    this.activeActions.add(actionId);
    action.state = 'EXECUTING';
    action.startedAt = new Date().toISOString();

    const context: ActionExecutionContext = {
      sessionId: `action-${actionId}`,
      actorId: intent.actor,
      authorizationMode: action.authorizationMode,
      authorizationScope: action.authorizationScope,
      auditTrail: this.journal.getRecentEntries(100),
      resolveCredential: this.resolveCredentialFn,
      requestHumanIntervention: this.onHumanInterventionFn
        ? (req: HumanInterventionRequest) => this.onHumanInterventionFn!(req)
        : undefined,
    };

    let executionResult: ActionExecutionResult;
    let interventionRequest: HumanInterventionRequest | null = null;

    // Set up intervention capture
    const originalRequestIntervention = context.requestHumanIntervention;
    context.requestHumanIntervention = (req: HumanInterventionRequest) => {
      interventionRequest = req;
      if (originalRequestIntervention) originalRequestIntervention(req);
    };

    try {
      executionResult = await adapter.execute(action, context);
    } catch (error) {
      this.activeActions.delete(actionId);
      action.state = 'EXECUTION_FAILED';
      action.completedAt = new Date().toISOString();
      const result: HumanActionResult = {
        actionId, state: 'EXECUTION_FAILED', executed: false, verified: false,
        outcome: 'failure', result: null,
        error: error instanceof Error ? error.message : 'Unknown error',
        evidence: [{
          check: 'execution_threw',
          status: 'fail',
          value: error instanceof Error ? error.message : 'Unknown error',
          checkedAt: new Date().toISOString(),
        }],
        durationMs: 0, timestamp: new Date().toISOString(),
      };
      this.journal.record(action, result, { failure: result.error ?? undefined, interventionRequest });
      return result;
    }

    // Handle human intervention during execution
    if (interventionRequest) {
      this.activeActions.delete(actionId);
      action.state = 'PAUSED';
      action.completedAt = new Date().toISOString();
      const result: HumanActionResult = {
        actionId, state: 'PAUSED', executed: executionResult.executed, verified: false,
        outcome: 'pending_human', result: executionResult.output,
        error: null,
        evidence: executionResult.evidence,
        durationMs: executionResult.durationMs, timestamp: new Date().toISOString(),
      };
      this.journal.record(action, result, { interventionRequest });
      return result;
    }

    if (!executionResult.executed) {
      this.activeActions.delete(actionId);
      action.state = 'EXECUTION_FAILED';
      action.completedAt = new Date().toISOString();
      const result: HumanActionResult = {
        actionId, state: 'EXECUTION_FAILED', executed: false, verified: false,
        outcome: 'failure', result: executionResult.output,
        error: executionResult.error,
        evidence: executionResult.evidence,
        durationMs: executionResult.durationMs, timestamp: new Date().toISOString(),
      };
      this.journal.record(action, result, { failure: executionResult.error ?? undefined });
      return result;
    }

    // Step 6: Verify
    action.state = 'EXECUTED';
    let verification: ActionVerificationResult;
    try {
      verification = await adapter.verify(action, executionResult, context);
    } catch (error) {
      verification = {
        verified: false,
        evidence: [{
          check: 'verification_error',
          status: 'fail',
          value: error instanceof Error ? error.message : 'Unknown error',
          checkedAt: new Date().toISOString(),
        }],
        reason: 'Verification threw an error',
      };
    }

    if (!verification.verified) {
      // Step 7: Attempt rollback if verification failed
      action.state = 'VERIFICATION_FAILED';
      let rollbackResult: RollbackResult | undefined;
      try {
        rollbackResult = await adapter.rollback(action, executionResult, context);
        if (rollbackResult.succeeded) {
          action.state = 'ROLLED_BACK';
        } else {
          action.state = 'ROLLBACK_FAILED';
        }
      } catch (error) {
        rollbackResult = {
          attempted: true, succeeded: false,
          evidence: 'Rollback threw an error',
          error: error instanceof Error ? error.message : 'Unknown error',
        };
        action.state = 'ROLLBACK_FAILED';
      }

      this.activeActions.delete(actionId);
      action.completedAt = new Date().toISOString();
      const result: HumanActionResult = {
        actionId,
        state: action.state,
        executed: true, verified: false,
        outcome: action.state === 'ROLLED_BACK' ? 'rolled_back' : 'failure',
        result: executionResult.output,
        error: verification.reason,
        evidence: [...executionResult.evidence, ...verification.evidence],
        durationMs: executionResult.durationMs,
        rollbackResult,
        timestamp: new Date().toISOString(),
      };
      this.journal.record(action, result, {
        verificationResult: verification.reason,
        rollbackResult,
        failure: verification.reason,
      });
      return result;
    }

    // Success!
    this.activeActions.delete(actionId);
    action.state = 'VERIFIED';
    action.completedAt = new Date().toISOString();
    const result: HumanActionResult = {
      actionId, state: 'VERIFIED', executed: true, verified: true,
      outcome: 'success', result: executionResult.output,
      error: null,
      evidence: [...executionResult.evidence, ...verification.evidence],
      durationMs: executionResult.durationMs,
      timestamp: new Date().toISOString(),
    };
    this.journal.record(action, result, { verificationResult: 'verified' });
    return result;
  }

  /**
   * Execute a graph of actions in dependency order.
   */
  async executeActionGraph(
    graph: ActionGraph,
    authorityId?: string,
    options?: { dryRun?: boolean },
  ): Promise<Array<HumanActionResult>> {
    const results: HumanActionResult[] = [];
    const completed = new Set<string>();
    const failed = new Set<string>();

    // Execute in topological order
    for (const actionId of graph.executionOrder) {
      const node = graph.nodes.find((n) => n.actionId === actionId);
      if (!node) continue;

      // Check dependencies
      const depsMet = node.dependsOn.every((dep) => completed.has(dep));
      if (!depsMet) {
        const failedDep = node.dependsOn.find((dep) => failed.has(dep));
        if (failedDep) {
          // Skip this action — dependency failed
          node.status = 'skipped';
          results.push({
            actionId, state: 'BLOCKED', executed: false, verified: false,
            outcome: 'blocked', result: null,
            error: `Dependency ${failedDep} failed`,
            evidence: [], durationMs: 0, timestamp: new Date().toISOString(),
          });
          failed.add(actionId);
          continue;
        }
        // Dependencies not yet completed — this shouldn't happen with proper topo sort
        continue;
      }

      node.status = 'executing';
      const result = await this.executeAction(node.intent, authorityId, options);
      results.push(result);

      if (result.verified) {
        completed.add(actionId);
        node.status = 'completed';
      } else {
        failed.add(actionId);
        node.status = 'failed';
      }
    }

    return results;
  }

  // -----------------------------------------------------------------------
  // Journal access (PHASE 17)
  // -----------------------------------------------------------------------

  getJournal(): ActionJournal {
    return this.journal;
  }

  getJournalEntriesForGoal(goalId: string): ActionJournalEntry[] {
    return this.journal.getEntriesForGoal(goalId);
  }

  getRecentJournalEntries(count: number = 50): ActionJournalEntry[] {
    return this.journal.getRecentEntries(count);
  }

  // -----------------------------------------------------------------------
  // Human intervention (PHASE 18)
  // -----------------------------------------------------------------------

  /**
   * Resume an action that was paused for human intervention.
   */
  async resumeAction(actionId: string, authorityId?: string): Promise<HumanActionResult | null> {
    const entries = this.journal.getEntriesForAction(actionId);
    if (entries.length === 0) return null;

    const lastEntry = entries[entries.length - 1];
    if (lastEntry.state !== 'PAUSED' && lastEntry.state !== 'PENDING_HUMAN') {
      return null;
    }

    // Re-read the original action from the journal and re-execute
    // with forceAuthorize since the human has now authorized it
    const originalEntry = entries[0];
    const intent: HumanActionIntent = {
      intentId: originalEntry.entryId,
      goalId: originalEntry.goalId,
      actor: originalEntry.actor,
      category: originalEntry.category,
      capability: originalEntry.capability,
      operation: originalEntry.operation,
      target: originalEntry.target,
      parameters: originalEntry.parametersRedacted as Record<string, unknown>,
      reason: 'Resumed after human intervention',
      expectedResult: 'Action completes successfully',
    };

    return this.executeAction(intent, authorityId, { forceAuthorize: true });
  }

  // -----------------------------------------------------------------------
  // Authority management
  // -----------------------------------------------------------------------

  /**
   * Set the default authority for actions.
   */
  setDefaultAuthority(authorityId: string): void {
    this.defaultAuthorityId = authorityId;
  }

  /**
   * Delegate authority to HYDI.
   */
  delegateAuthority(authority: Omit<DelegatedAuthority, 'authorityId' | 'createdAt' | 'metadata' | 'revokedAt'> & {
    metadata?: Record<string, unknown>;
  }): DelegatedAuthority {
    return this.authorityManager.delegate(authority);
  }

  /**
   * Get active authorities.
   */
  getActiveAuthorities(): DelegatedAuthority[] {
    return this.authorityManager.getActiveAuthorities();
  }

  // -----------------------------------------------------------------------
  // Recovery integration (PHASE 12)
  // -----------------------------------------------------------------------

  /**
   * Register a recovery handler for when actions fail.
   * This integrates with the existing SelfRepairEngine.
   */
  private recoveryHandlers: Map<string, (action: HumanAction, result: HumanActionResult) => Promise<boolean>> = new Map();

  registerRecoveryHandler(
    capability: string,
    handler: (action: HumanAction, result: HumanActionResult) => Promise<boolean>,
  ): void {
    this.recoveryHandlers.set(capability, handler);
  }

  /**
   * Attempt recovery for a failed action.
   */
  async attemptRecovery(action: HumanAction, result: HumanActionResult): Promise<boolean> {
    const handler = this.recoveryHandlers.get(action.capability);
    if (!handler) return false;
    try {
      return await handler(action, result);
    } catch {
      return false;
    }
  }

  // -----------------------------------------------------------------------
  // Cleanup
  // -----------------------------------------------------------------------

  async close(): Promise<void> {
    await this.journal.flush();
  }
}

// ---------------------------------------------------------------------------
// Factory function
// ---------------------------------------------------------------------------

export function createHumanActionEngine(opts: {
  rootDir?: string;
  resolveCredential?: (credentialRef: string) => Promise<string | null>;
  onHumanIntervention?: (request: HumanInterventionRequest) => void;
}): HumanActionEngine {
  const root = opts.rootDir ?? process.cwd();
  const registry = new (require('./ActionCapabilityRegistry').createDefaultActionCapabilityRegistry)();
  const authorityManager = new (require('./AuthorityManager').AuthorityManager)();
  const journal = new (require('./ActionJournal').createActionJournal)(root);

  // Create default owner authority
  const defaultAuth = authorityManager.delegate({
    delegatedBy: 'user:owner',
    delegatedTo: 'heidi',
    scopes: ['READ_ONLY', 'LOCAL_WRITE', 'SERVICE_OPERATION'],
    riskLimit: 'HIGH',
    riskLevelLimit: 'R4',
    resourcePatterns: [{ type: 'any', pattern: '*', description: 'All resources' }],
    timeConstraint: { type: 'session_bounded', sessionId: 'default' },
    requiresConfirmation: require('./AuthorityManager').STRICT_CONFIRMATION,
    purpose: 'Default HYDI operation authority',
  });

  return new HumanActionEngine({
    registry,
    authorityManager,
    journal,
    defaultAuthorityId: defaultAuth.authorityId,
    resolveCredential: opts.resolveCredential,
    onHumanIntervention: opts.onHumanIntervention,
  });
}
