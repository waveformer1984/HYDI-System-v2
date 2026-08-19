/**
 * HYDI Bounded Recovery Engine
 *
 * Implements bounded, observable, evidence-driven recovery.
 *
 * Every recovery action has:
 *   1. precondition  — what must be true before acting
 *   2. action         — the specific permitted action
 *   3. maxAttempts    — retry budget (never infinite)
 *   4. cooldown       — minimum time between attempts
 *   5. postcondition  — what must be true after acting (verified, not assumed)
 *   6. escalation     — what happens if all attempts fail
 *
 * Recovery is causal — it operates from the dependency graph.
 * If Ollama fails, Postgres/ProtoForge/Heidi are NOT restarted
 * unless dependency analysis proves it's necessary.
 *
 * Recovery is idempotent — if the component is already healthy,
 * recover() verifies state and returns safely without restarting.
 *
 * A recovery action is NOT successful because the command succeeded.
 * Success requires: process healthy + listener correct + endpoint responding
 * + dependency graph healthy + functional probe succeeds.
 */

import { randomUUID } from 'crypto';
import { spawn, execSync, ChildProcess } from 'child_process';
import path from 'path';
import fs from 'fs';
import type {
  RecoveryAction,
  RecoveryAttempt,
  RecoveryRecord,
  ComponentState,
  HealthEvidence,
  RecoveryOutcome,
  RecoveryFailureClassification,
  RetryDecision,
  EscalationRecord,
  OperationalEvent,
  AllowedCommand,
} from './types';
import type { SystemStateModel } from './SystemStateModel';
import type { DependencyGraph } from './types';
import type { HealthProvenanceChecker } from './HealthProvenanceChecker';
import type { CapabilityAuthorizer } from './CapabilityAuthorizer';
import type { AutonomyPolicyModel } from './AutonomyPolicyModel';
import type { RecoveryBudgetManager } from './RecoveryBudget';
import type { RecoveryLockManager } from './RecoveryLock';
import type { EscalationManager } from './EscalationManager';
import type { PolicyDecisionRecordStore } from './PolicyDecisionRecord';
import type { ActionRegistry as ActionRegistryType } from './ActionRegistry';
import { ActionRegistry as ActionRegistryClass, actionRegistry as defaultActionRegistry } from './ActionRegistry';
import { classifyRecoveryOutcome, classifyFailure, decideRetry } from './RecoveryOutcomeClassifier';

interface BootConfigModule {
  id: string;
  type: 'process' | 'module';
  enabled?: boolean;
  required?: boolean;
  command?: string;
  args?: string[];
  argsProd?: string[];
  env?: Record<string, string>;
  port?: number;
  health?: { url: string; graceMs?: number; intervalMs?: number };
  dependsOn?: string[];
}

interface BootConfig {
  modules: BootConfigModule[];
}

export interface RecoveryOptions {
  maxAttempts?: number;
  cooldownMs?: number;
  graceMs?: number;
}

const DEFAULT_RECOVERY_ACTION: RecoveryAction = {
  type: 'restart_process',
  target: '',
  maxAttempts: 3,
  cooldownMs: 5000,
  postcondition: 'component state is HEALTHY with evidence chain',
  escalationPath: 'escalate to human operator — all recovery attempts exhausted',
};

export class RecoveryEngine {
  private root: string;
  private stateModel: SystemStateModel;
  private graph: DependencyGraph;
  private healthChecker: HealthProvenanceChecker;
  private authorizer: CapabilityAuthorizer;
  private bootConfig: BootConfig;
  private activeRecoveries = new Map<string, string>(); // component -> correlationId
  private recoveryHistory: RecoveryRecord[] = [];
  private spawnedProcesses = new Map<string, ChildProcess>();
  private lockHolderIds = new Map<string, string>(); // component -> lock holderId (Phase 7)

  // Phase 4 optional dependencies (null = Phase 3 behavior)
  private policyModel: AutonomyPolicyModel | null;
  private budgetManager: RecoveryBudgetManager | null;
  private lockManager: RecoveryLockManager | null;
  private escalationManager: EscalationManager | null;
  private decisionStore: PolicyDecisionRecordStore | null;

  // Phase 5: Action registry — enforces that only registered actions can execute
  private actionRegistry: ActionRegistryClass;

  constructor(
    root: string,
    stateModel: SystemStateModel,
    graph: DependencyGraph,
    healthChecker: HealthProvenanceChecker,
    authorizer: CapabilityAuthorizer,
    // Phase 4 optional dependencies
    policyModel?: AutonomyPolicyModel,
    budgetManager?: RecoveryBudgetManager,
    lockManager?: RecoveryLockManager,
    escalationManager?: EscalationManager,
    decisionStore?: PolicyDecisionRecordStore,
  ) {
    this.root = root;
    this.stateModel = stateModel;
    this.graph = graph;
    this.healthChecker = healthChecker;
    this.authorizer = authorizer;
    this.bootConfig = this.loadBootConfig();
    this.policyModel = policyModel ?? null;
    this.budgetManager = budgetManager ?? null;
    this.lockManager = lockManager ?? null;
    this.escalationManager = escalationManager ?? null;
    this.decisionStore = decisionStore ?? null;
    this.actionRegistry = defaultActionRegistry;
  }

  private loadBootConfig(): BootConfig {
    const configPath = path.resolve(this.root, 'boot.config.json');
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  /**
   * Attempt to recover a component. This is the main entry point.
   *
   * Steps:
   *   1. Check if already healthy (idempotent — no unnecessary restart)
   *   2. Check if recovery already in progress (prevent concurrent recovery)
   *   3. Authorize the recovery action via capability system
   *   4. Determine recovery strategy from dependency graph
   *   5. Execute bounded recovery with retry budget
   *   6. Verify postcondition with functional probe
   *   7. Record evidence
   *   8. Escalate if all attempts fail
   */
  async recover(component: string, cause: string, options: RecoveryOptions = {}): Promise<RecoveryRecord> {
    const correlationId = randomUUID();
    const startedAt = new Date().toISOString();

    // 1. Idempotent check — if already healthy, verify and return
    const currentState = this.stateModel.getState(component).state;
    if (currentState === 'HEALTHY') {
      return this.createNoOpRecord(component, correlationId, cause, 'already healthy');
    }

    // 2. Prevent concurrent recovery (Phase 3: in-process map, Phase 4: recovery lock)
    if (this.activeRecoveries.has(component)) {
      return this.createNoOpRecord(component, correlationId, cause, 'recovery already in progress');
    }

    // Phase 4: Check recovery lock if available
    if (this.lockManager) {
      const lease = this.lockManager.acquire(component);
      if (!lease) {
        return this.createNoOpRecord(component, correlationId, cause, 'recovery lock held by another instance');
      }
      // Phase 7: Store the holderId so we can properly release the lock later
      this.lockHolderIds.set(component, lease.holderId);
    }

    // Phase 4: Check recovery budget if available
    if (this.budgetManager) {
      const incidentId = correlationId; // use correlation ID as incident ID
      const budgetCheck = this.budgetManager.canRecover(component, incidentId);
      if (!budgetCheck.allowed) {
        this.stateModel.logEvent({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'budget_exhausted',
          component,
          cause: budgetCheck.reason,
          action: 'health.recover',
          actionResult: 'denied',
          correlationId,
        });

        // Release lock if we acquired it
        if (this.lockManager) {
          // Best effort release — we didn't store the holderId, but the lock
          // will expire. In production, we'd store it.
        }

        // Escalate if escalation manager is available
        if (this.escalationManager) {
          this.escalationManager.escalate(
            component,
            incidentId,
            correlationId,
            this.stateModel.getState(component).evidence,
            [],
            budgetCheck.reason,
            'Review component and manually authorize recovery or increase budget',
            'R1',
            [component],
          );
        }

        return {
          component,
          correlationId,
          cause,
          action: { ...DEFAULT_RECOVERY_ACTION, target: component, type: 'escalate' },
          attempts: [],
          finalState: 'ESCALATION_REQUIRED',
          startedAt,
          completedAt: new Date().toISOString(),
        };
      }
    }

    // 3. Authorize
    const auth = this.authorizer.authorize('health.recover', {
      requester: 'recovery-engine',
      target: component,
    });
    if (!auth.authorized) {
      this.stateModel.logEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'recovery_failed',
        component,
        cause,
        action: 'health.recover',
        actionResult: 'denied',
        correlationId,
        detail: { reason: auth.reason },
      });
      return {
        component,
        correlationId,
        cause,
        action: { ...DEFAULT_RECOVERY_ACTION, target: component },
        attempts: [],
        finalState: 'BLOCKED',
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    // 4. Determine strategy from dependency graph
    const node = this.graph.nodes.get(component);
    const actionType = node?.recoveryPolicy ?? 'escalate';
    const action: RecoveryAction = {
      type: actionType,
      target: component,
      maxAttempts: options.maxAttempts ?? DEFAULT_RECOVERY_ACTION.maxAttempts,
      cooldownMs: options.cooldownMs ?? DEFAULT_RECOVERY_ACTION.cooldownMs,
      precondition: `component ${component} is not HEALTHY`,
      postcondition: DEFAULT_RECOVERY_ACTION.postcondition,
      escalationPath: DEFAULT_RECOVERY_ACTION.escalationPath,
    };

    // If the recovery policy is 'no_action' (optional component), return early
    // with a clear result — don't loop 3 times doing nothing and then escalate.
    if (actionType === 'no_action') {
      this.stateModel.logEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'recovery_skipped',
        component,
        cause,
        action: 'no_action',
        actionResult: 'skipped',
        correlationId,
        detail: { reason: 'component is optional — recovery policy is no_action' },
      });
      return {
        component,
        correlationId,
        cause,
        action,
        attempts: [],
        finalState: this.stateModel.getState(component).state,
        startedAt,
        completedAt: new Date().toISOString(),
      };
    }

    this.activeRecoveries.set(component, correlationId);

    // 5. Check dependencies first (causal recovery)
    if (node) {
      for (const dep of node.dependencies) {
        const depState = this.stateModel.getState(dep).state;
        if (depState === 'UNAVAILABLE' || depState === 'FAILED') {
          this.stateModel.logEvent({
            id: randomUUID(),
            timestamp: new Date().toISOString(),
            type: 'recovery_started',
            component: dep,
            cause: `dependency of ${component} needs recovery first`,
            action: 'recover_dependency',
            correlationId,
          });
          await this.recover(dep, `dependency of ${component}`, options);
        }
      }
    }

    // 6. Execute bounded recovery with intelligent retry decisions
    const attempts: RecoveryAttempt[] = [];
    let finalState: ComponentState = this.stateModel.getState(component).state;
    let finalOutcome: RecoveryOutcome = 'RECOVERY_NOT_REQUIRED';
    let finalFailureClassification: RecoveryFailureClassification | undefined;
    const incidentId = correlationId; // use correlation ID as incident ID

    // Phase 7: Pre-compute dependencies for outcome classification
    // (node is already declared above at the strategy determination step)
    const dependencies = node?.dependencies ?? [];
    let depStates: Record<string, ComponentState> = {};

    for (let attemptNum = 1; attemptNum <= action.maxAttempts; attemptNum++) {
      const attemptStart = new Date().toISOString();
      const attemptStartMs = Date.now();
      const recoveryId = randomUUID();

      this.stateModel.logEvent({
        id: randomUUID(),
        timestamp: attemptStart,
        type: 'recovery_started',
        component,
        cause,
        action: action.type,
        recoveryAttempt: attemptNum,
        correlationId,
      });

      // Update state to RECOVERING
      this.stateModel.updateState(component, 'RECOVERING', [{
        check: 'recovery-status',
        status: 'warn',
        value: `attempt ${attemptNum}/${action.maxAttempts}`,
        checkedAt: attemptStart,
      }]);

      // Execute the recovery action — track whether it threw
      let executionSucceeded = true;
      let executionError: string | undefined;
      let timedOut = false;
      try {
        await this.executeAction(component, action, attemptNum);
      } catch (e) {
        executionSucceeded = false;
        executionError = e instanceof Error ? e.message : String(e);
        // Check if it was a timeout
        if (executionError.includes('timeout') || executionError.includes('TIMEDOUT')) {
          timedOut = true;
        }
      }

      // Wait for grace period before checking
      const graceMs = options.graceMs ?? this.getGraceMs(component);
      await this.sleep(graceMs);

      // Verify postcondition — re-check health
      await this.healthChecker.checkAll();
      const postState = this.stateModel.getState(component).state;
      const postEvidence = this.stateModel.getState(component).evidence;

      // Phase 7: Check if any dependency is blocking recovery
      depStates = {};
      let dependencyBlocked = false;
      for (const dep of dependencies) {
        const depState = this.stateModel.getState(dep)?.state ?? 'UNKNOWN';
        depStates[dep] = depState;
        if (depState === 'UNAVAILABLE' || depState === 'FAILED') {
          dependencyBlocked = true;
        }
      }

      // Phase 7: Service-level verification (separate from postcondition)
      // The postcondition checks if the component state is HEALTHY.
      // Verification checks if the service actually responds.
      // For containers, verifySupabaseServiceLevel is already called inside
      // restartContainer(). For processes, the health check IS the verification.
      // So verificationSucceeded = (postState === 'HEALTHY') for now.
      // If execution failed, verification definitely failed too.
      const verificationSucceeded = executionSucceeded && postState === 'HEALTHY';

      // Phase 7: Observer uncertainty check
      // If all evidence is 'skip' or there's no evidence, observation is uncertain
      const observerUncertain = postEvidence.length === 0 ||
        postEvidence.every((e) => e.status === 'skip');

      // Phase 7: Classify the recovery outcome
      const outcome = classifyRecoveryOutcome({
        executionSucceeded,
        postconditionState: postState,
        verificationSucceeded,
        dependencyBlocked,
        timedOut,
        observerUncertain,
      });

      const failureClassification = outcome === 'RECOVERY_SUCCESS' || outcome === 'RECOVERY_NOT_REQUIRED'
        ? 'UNKNOWN_PROBLEM' as RecoveryFailureClassification
        : classifyFailure(outcome, postEvidence, dependencies, depStates);

      // Phase 7: Make retry decision
      const budgetRemaining = this.budgetManager
        ? this.budgetManager.canRecover(component, incidentId).allowed
        : attemptNum < action.maxAttempts;

      const retryDecision = decideRetry({
        outcome,
        failureClassification,
        attemptNumber: attemptNum,
        maxAttempts: action.maxAttempts,
        budgetRemaining,
        dependencies,
        depStates,
        cooldownMs: action.cooldownMs,
      });

      const attempt: RecoveryAttempt = {
        action,
        attemptNumber: attemptNum,
        startedAt: attemptStart,
        completedAt: new Date().toISOString(),
        result: outcome === 'RECOVERY_SUCCESS' ? 'success' : 'failure',
        evidence: postEvidence,
        error: outcome !== 'RECOVERY_SUCCESS'
          ? executionError ?? `outcome: ${outcome} (${failureClassification})`
          : undefined,
        // Phase 7: Recovery Failure Intelligence fields
        recoveryId,
        incidentId,
        outcome,
        failureClassification,
        executionSucceeded,
        postconditionSucceeded: postState === 'HEALTHY',
        verificationSucceeded,
        retryDecision,
        durationMs: Date.now() - attemptStartMs,
      };
      attempts.push(attempt);

      this.stateModel.logEvent({
        id: randomUUID(),
        timestamp: attempt.completedAt ?? new Date().toISOString(),
        type: 'recovery_completed',
        component,
        action: action.type,
        actionResult: attempt.result === 'success' ? 'success' : 'failure',
        recoveryAttempt: attemptNum,
        recoveryResult: attempt.result === 'success' ? 'success' : 'failure',
        evidence: postEvidence,
        correlationId,
        detail: {
          error: attempt.error,
          outcome,
          failureClassification,
          executionSucceeded,
          postconditionSucceeded: postState === 'HEALTHY',
          verificationSucceeded,
          retryDecision: retryDecision.nextAction,
          dependencyBlocked,
          durationMs: attempt.durationMs,
        },
      });

      finalState = postState;
      finalOutcome = outcome;
      finalFailureClassification = failureClassification;

      // Phase 4: Record attempt in budget manager
      if (this.budgetManager) {
        this.budgetManager.recordAttempt(component, correlationId, postState === 'HEALTHY');
      }

      // Phase 7: Intelligent retry decision — stop if not retryable
      if (outcome === 'RECOVERY_SUCCESS') {
        break; // success — no more attempts
      }

      // Phase 7: If retry decision says don't retry, break immediately
      if (!retryDecision.shouldRetry) {
        this.stateModel.logEvent({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'recovery_stopped',
          component,
          action: action.type,
          actionResult: 'stopped',
          recoveryAttempt: attemptNum,
          correlationId,
          detail: {
            reason: retryDecision.reason,
            nextAction: retryDecision.nextAction,
            outcome,
            failureClassification,
          },
        });
        break;
      }

      // Cooldown before next attempt
      if (attemptNum < action.maxAttempts && retryDecision.waitMs) {
        await this.sleep(retryDecision.waitMs);
      }
    }

    // 7. Escalate if all attempts failed or recovery was stopped
    if (finalState !== 'HEALTHY') {
      // Determine the final outcome — if we exhausted all attempts, it's RECOVERY_EXHAUSTED
      if (attempts.length >= action.maxAttempts && finalOutcome !== 'RECOVERY_DEPENDENCY_BLOCKED') {
        finalOutcome = 'RECOVERY_EXHAUSTED';
      }

      this.stateModel.logEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'recovery_failed',
        component,
        cause,
        action: action.type,
        actionResult: 'failure',
        correlationId,
        detail: {
          escalation: action.escalationPath,
          attempts: attempts.length,
          finalOutcome,
          failureClassification: finalFailureClassification,
        },
      });
      finalState = 'FAILED';
      this.stateModel.updateState(component, 'FAILED', [{
        check: 'recovery-exhausted',
        status: 'fail',
        value: `${attempts.length} attempt(s) failed — outcome: ${finalOutcome}`,
        detail: `failureClassification: ${finalFailureClassification ?? 'unknown'}`,
        checkedAt: new Date().toISOString(),
      }]);

      // Phase 7: Create structured escalation record
      const lastAttempt = attempts[attempts.length - 1];
      const escalationRecord: EscalationRecord = {
        escalationId: randomUUID(),
        incidentId,
        target: component,
        failureClassification: finalFailureClassification ?? 'UNKNOWN_PROBLEM',
        attemptCount: attempts.length,
        lastRecoveryAction: action.type,
        lastFailureReason: lastAttempt?.error ?? `recovery exhausted after ${attempts.length} attempts`,
        remainingEvidence: lastAttempt?.evidence ?? [],
        risk: 'R2',
        reasonForEscalation: `recovery stopped: ${finalOutcome} (${finalFailureClassification})`,
        recommendedNextAction: this.getRecommendedNextAction(finalFailureClassification, component, dependencies, depStates),
        timestamp: new Date().toISOString(),
        attemptHistory: attempts.map((a) => ({
          attemptNumber: a.attemptNumber,
          action: a.action.type,
          outcome: a.outcome ?? 'RECOVERY_EXHAUSTED',
          failureClassification: a.failureClassification,
          error: a.error,
          timestamp: a.startedAt,
        })),
      };

      // Escalate if escalation manager is available
      if (this.escalationManager) {
        this.escalationManager.escalate(
          component,
          incidentId,
          correlationId,
          lastAttempt?.evidence ?? [],
          attempts.map((a) => ({
            action: a.action.type,
            result: a.result,
            timestamp: a.startedAt,
            error: a.error,
          })),
          escalationRecord.reasonForEscalation,
          escalationRecord.recommendedNextAction,
          'R2',
          [component, ...dependencies],
        );
      }

      const record: RecoveryRecord = {
        component,
        correlationId,
        cause,
        action,
        attempts,
        finalState,
        startedAt,
        completedAt: new Date().toISOString(),
        incidentId,
        finalOutcome,
        failureClassification: finalFailureClassification,
        escalationRecord,
      };
      this.recoveryHistory.push(record);
      this.activeRecoveries.delete(component);
      this.releaseLock(component);
      return record;
    }

    this.activeRecoveries.delete(component);

    // Phase 7: Release recovery lock properly
    this.releaseLock(component);

    // Phase 4: Reset budget on success
    if (this.budgetManager && finalState === 'HEALTHY') {
      this.budgetManager.resetComponentRetries(component);
    }

    const record: RecoveryRecord = {
      component,
      correlationId,
      cause,
      action,
      attempts,
      finalState,
      startedAt,
      completedAt: new Date().toISOString(),
      incidentId,
      finalOutcome,
      failureClassification: finalFailureClassification,
    };
    this.recoveryHistory.push(record);

    return record;
  }

  /**
   * Phase 7: Release the recovery lock for a component using the stored holderId.
   */
  private releaseLock(component: string): void {
    if (this.lockManager) {
      const holderId = this.lockHolderIds.get(component);
      if (holderId) {
        this.lockManager.release(component, holderId);
        this.lockHolderIds.delete(component);
      }
    }
  }

  /**
   * Phase 7: Get a recommended next action based on the failure classification.
   */
  private getRecommendedNextAction(
    classification: RecoveryFailureClassification | undefined,
    component: string,
    dependencies: string[],
    depStates: Record<string, ComponentState>,
  ): string {
    if (!classification) return 'Review component state and manually intervene';

    switch (classification) {
      case 'DEPENDENCY_PROBLEM': {
        const failedDep = dependencies.find((d) => {
          const s = depStates[d];
          return s === 'UNAVAILABLE' || s === 'FAILED';
        });
        return `Recover dependency '${failedDep ?? 'unknown'}' first, then retry recovery for ${component}`;
      }
      case 'TARGET_PROBLEM':
        return `Review ${component} logs and configuration — the target itself remains unhealthy after restart`;
      case 'RECOVERY_MECHANISM_PROBLEM':
        return `Check if the recovery command is valid and the runtime (Docker/PM2) is operational — the restart action itself failed`;
      case 'VERIFICATION_PROBLEM':
        return `Container may be running but service-level verification failed — check ${component} health endpoint and logs`;
      case 'OBSERVER_PROBLEM':
        return `Observation is uncertain — verify monitoring is functional before attempting further recovery`;
      case 'POLICY_PROBLEM':
        return `Recovery is not authorized by policy — review autonomy policy for ${component}`;
      case 'TIMEOUT_PROBLEM':
        return `Recovery action timed out — check if ${component} is taking too long to start and increase timeout if needed`;
      default:
        return `Review ${component} state and manually intervene or authorize further recovery attempts`;
    }
  }

  /**
   * Execute a single recovery action. Actions are structural — never
   * arbitrary shell commands.
   *
   * Phase 5: Every action is validated against the ActionRegistry before
   * execution. Unregistered actions are refused and logged.
   */
  private async executeAction(component: string, action: RecoveryAction, attempt: number): Promise<void> {
    // Phase 5: ActionRegistry enforcement — verify the action is registered
    const registryEntries = this.actionRegistry.getForComponent(component);
    const matchingEntry = registryEntries.find(
      (e) => e.actionType === action.type || e.targetComponent === '*',
    );

    if (action.type !== 'no_action' && action.type !== 'wait_for_dependency' && !matchingEntry) {
      this.stateModel.logEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'recovery_failed',
        component,
        cause: `action type '${action.type}' is not registered in ActionRegistry for component '${component}'`,
        action: action.type,
        actionResult: 'denied',
        recoveryAttempt: attempt,
        detail: { reason: 'unregistered action blocked by ActionRegistry enforcement' },
      });
      throw new Error(`Action '${action.type}' for '${component}' is not registered — blocked by ActionRegistry`);
    }

    // Phase 5: Enforce timeout from registry entry if available
    const timeoutMs = matchingEntry?.timeoutMs ?? 30000;

    switch (action.type) {
      case 'restart_process':
        await this.restartProcess(component);
        break;
      case 'restart_container':
        await this.restartContainer(component);
        break;
      case 'restart_ollama':
        await this.restartOllama();
        break;
      case 'recover_database':
        await this.recoverDatabase(component);
        break;
      case 'restart_bridge':
        await this.restartBridge(component);
        break;
      case 'wait_for_dependency':
        // Do nothing locally — the dependency recovery handles it
        this.stateModel.logEvent({
          id: randomUUID(),
          timestamp: new Date().toISOString(),
          type: 'recovery_step',
          component,
          action: 'wait_for_dependency',
          recoveryAttempt: attempt,
          detail: { message: 'waiting for upstream dependency to recover' },
        });
        break;
      case 'escalate':
      case 'no_action':
        // No action to take
        break;
    }
  }

  /**
   * Restart a Docker container by name.
   * Uses `docker restart <name>` — bounded, no arbitrary commands.
   */
  private async restartContainer(containerName: string): Promise<void> {
    // Map component IDs to container names if needed
    const containerMap: Record<string, string> = {
      'supabase_db': 'supabase_db_HYDI-System-v2',
      'supabase_rest': 'supabase_rest_HYDI-System-v2',
      'supabase_auth': 'supabase_auth_HYDI-System-v2',
      'supabase_realtime': 'supabase_realtime_HYDI-System-v2',
      'supabase_storage': 'supabase_storage_HYDI-System-v2',
      'supabase_kong': 'supabase_kong_HYDI-System-v2',
      'supabase_studio': 'supabase_studio_HYDI-System-v2',
    };
    const container = containerMap[containerName] || containerName;

    // Resolve Docker CLI path deterministically (shared resolver)
    const dockerCmd = this.resolveDockerCmd();

    try {
      if (!dockerCmd) {
        throw new Error('Docker CLI not available — cannot restart container');
      }
      execSync(`${dockerCmd} restart ${container}`, { timeout: 30000, stdio: 'pipe', windowsHide: true } as any);
      this.stateModel.logEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'recovery_step',
        component: containerName,
        action: 'container_restarted',
        actionResult: 'success',
        detail: { container },
      });

      // Service-level verification: container running ≠ service healthy.
      // For Supabase containers, verify REST API responds through Kong gateway.
      // This is the Phase 6 requirement: verification must be stronger than execution.
      if (containerName.startsWith('supabase_')) {
        await this.verifySupabaseServiceLevel(containerName);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.stateModel.logEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'recovery_step',
        component: containerName,
        action: 'container_restart',
        actionResult: 'failure',
        detail: { error: msg, container },
      });
      throw new Error(`Container restart failed for ${container}: ${msg}`);
    }
  }

  /**
   * Restart the local Ollama AI service.
   * On Windows, Ollama runs as a background process — we try to restart it.
   */
  private async restartOllama(): Promise<void> {
    try {
      if (process.platform === 'win32') {
        // Kill existing Ollama process, then start a new one
        try {
          execSync('taskkill /IM ollama.exe /F', { timeout: 5000, stdio: 'pipe', windowsHide: true } as any);
        } catch { /* may not be running */ }
        // Start Ollama in detached mode
        const child = spawn('ollama', ['serve'], {
          cwd: this.root,
          env: process.env,
          shell: true,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        } as any);
        child.unref();
      } else {
        try {
          execSync('pkill -f ollama', { timeout: 5000, stdio: 'pipe', windowsHide: true } as any);
        } catch { /* may not be running */ }
        const child = spawn('ollama', ['serve'], {
          cwd: this.root,
          env: process.env,
          shell: true,
          detached: true,
          stdio: 'ignore',
          windowsHide: true,
        } as any);
        child.unref();
      }

      // Wait for Ollama to come up (max 15s)
      await this.waitForService('http://127.0.0.1:11434/api/tags', 15000);

      this.stateModel.logEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'recovery_step',
        component: 'ollama',
        action: 'ollama_restarted',
        actionResult: 'success',
        detail: { pid: 'detached' },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.stateModel.logEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'recovery_step',
        component: 'ollama',
        action: 'ollama_restart',
        actionResult: 'failure',
        detail: { error: msg },
      });
      throw new Error(`Ollama restart failed: ${msg}`);
    }
  }

  /**
   * Recover database connectivity.
   * For local Supabase: try to restart the DB container.
   * For cloud: wait with bounded timeout (don't restart cloud infra).
   */
  private async recoverDatabase(component: string): Promise<void> {
    this.stateModel.logEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'recovery_step',
      component,
      action: 'database_recovery_attempt',
      detail: { strategy: 'local container restart' },
    });

    // Try restarting the local Supabase DB container
    try {
      const dockerCmd = this.resolveDockerCmd();
      if (!dockerCmd) {
        throw new Error('Docker CLI not available — cannot restart DB container');
      }
      const containerName = 'supabase_db_HYDI-System-v2';
      execSync(`${dockerCmd} restart ${containerName}`, { timeout: 30000, stdio: 'pipe', windowsHide: true } as any);

      // Wait for the DB to accept connections (max 20s)
      await this.waitForService('http://127.0.0.1:54321', 20000);

      this.stateModel.logEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'recovery_step',
        component,
        action: 'database_recovered',
        actionResult: 'success',
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.stateModel.logEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'recovery_step',
        component,
        action: 'database_recovery',
        actionResult: 'failure',
        detail: { error: msg },
      });
      // Don't throw — database recovery is best-effort for local;
      // if it fails, the retry loop will try again or escalate.
    }
  }

  /**
   * Restart a bridge component.
   * Bridges are typically processes that connect HEIDI to external systems.
   * If the bridge is a boot.config.json process, use restartProcess.
   * Otherwise, log and escalate.
   */
  private async restartBridge(component: string): Promise<void> {
    // Check if the bridge is a registered process module
    const mod = this.bootConfig.modules.find((m) => m.id === component);
    if (mod && mod.type === 'process') {
      await this.restartProcess(component);
      return;
    }

    // If not a process module, we can't restart it autonomously
    this.stateModel.logEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'recovery_step',
      component,
      action: 'bridge_restart',
      actionResult: 'failure',
      detail: { reason: 'bridge is not a restartable process module — escalation required' },
    });
    throw new Error(`Bridge ${component} is not a restartable process — requires manual intervention`);
  }

  /**
   * Verify Supabase service-level health after container restart.
   * Container running ≠ service healthy. This probes the REST API
   * through the Kong gateway to prove both DB connectivity and REST
   * functionality.
   *
   * Phase 6: Verification must be stronger than execution.
   */
  private async verifySupabaseServiceLevel(containerName: string): Promise<void> {
    const kongUrl = 'http://127.0.0.1:54321';
    const maxWaitMs = 20000;
    const started = Date.now();

    try {
      // Wait for Kong gateway to respond (it proxies to REST API)
      await this.waitForService(kongUrl, maxWaitMs);

      // Additional check: REST API root endpoint returns OpenAPI doc
      const restUrl = `${kongUrl}/rest/v1/`;
      const restStart = Date.now();
      const { ok, statusCode } = await this.httpGet(restUrl, 5000);

      this.stateModel.logEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'recovery_step',
        component: containerName,
        action: 'service_level_verification',
        actionResult: ok ? 'success' : 'failure',
        detail: {
          kongUrl,
          restUrl,
          statusCode,
          latencyMs: Date.now() - restStart,
          totalWaitMs: Date.now() - started,
          verified: ok,
        },
      });

      if (!ok) {
        throw new Error(`Service-level verification failed for ${containerName}: REST API returned ${statusCode}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.stateModel.logEvent({
        id: randomUUID(),
        timestamp: new Date().toISOString(),
        type: 'recovery_step',
        component: containerName,
        action: 'service_level_verification',
        actionResult: 'failure',
        detail: { error: msg, elapsedMs: Date.now() - started },
      });
      // Don't throw — the recovery loop's healthChecker.checkAll() will
      // catch this as a failed postcondition. But we log the evidence.
    }
  }

  /**
   * Simple HTTP GET helper with timeout.
   */
  private async httpGet(url: string, timeoutMs: number): Promise<{ ok: boolean; statusCode: number }> {
    const http = require('http');
    const https = require('https');
    const lib = url.startsWith('https:') ? https : http;

    return new Promise((resolve) => {
      const req = lib.get(url, { timeout: timeoutMs }, (res: any) => {
        res.resume();
        resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, statusCode: res.statusCode });
      });
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, statusCode: 0 }); });
      req.on('error', () => resolve({ ok: false, statusCode: 0 }));
    });
  }

  /**
   * Wait for a service to respond with a bounded timeout.
   * Polls every 1s until the service responds or timeout is reached.
   */
  private async waitForService(url: string, timeoutMs: number): Promise<void> {
    const http = require('http');
    const https = require('https');
    const lib = url.startsWith('https:') ? https : http;
    const start = Date.now();

    return new Promise((resolve, reject) => {
      const check = () => {
        if (Date.now() - start > timeoutMs) {
          reject(new Error(`Service at ${url} did not respond within ${timeoutMs}ms`));
          return;
        }
        const req = lib.get(url, { timeout: 3000 }, (res: any) => {
          res.resume();
          if (res.statusCode >= 200 && res.statusCode < 500) {
            resolve();
          } else {
            setTimeout(check, 1000);
          }
        });
        req.on('error', () => setTimeout(check, 1000));
        req.on('timeout', () => { req.destroy(); setTimeout(check, 1000); });
      };
      check();
    });
  }

  /**
   * Restart a process module from boot.config.json.
   * This is the ONLY way the recovery engine starts processes —
   * it reads the command from boot.config.json, never from user input.
   */
  private async restartProcess(component: string): Promise<void> {
    const mod = this.bootConfig.modules.find((m) => m.id === component);
    if (!mod || mod.type !== 'process') {
      throw new Error(`Cannot restart ${component}: not a process module`);
    }

    // Kill existing process on the port if any
    if (mod.port) {
      await this.killProcessOnPort(mod.port);
    }

    // Kill any previously spawned process for this component
    const existing = this.spawnedProcesses.get(component);
    if (existing) {
      try { existing.kill('SIGTERM'); } catch { /* already dead */ }
      this.spawnedProcesses.delete(component);
    }

    // Spawn new process from boot.config.json command.
    // Processes are spawned DETACHED so they survive the CLI exit —
    // otherwise `hydi:recover` would kill the recovered process when it
    // calls destroy(), making recovery transient and useless.
    // Detached processes are NOT tracked in spawnedProcesses (so destroy()
    // won't kill them). Only attached (test) processes are tracked.
    const command = mod.command || 'node';
    const args = mod.args || [];
    const env = { ...process.env, ...mod.env };

    const child = spawn(command, args, {
      cwd: this.root,
      env,
      shell: true,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    } as any);

    // unref() so the parent CLI process can exit without waiting for the child
    child.unref();

    this.stateModel.logEvent({
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      type: 'recovery_step',
      component,
      action: 'process_spawned',
      actionResult: 'success',
      detail: { pid: child.pid, detached: true, command: `${command} ${args.join(' ')}` },
    });
  }

  /**
   * Kill any process listening on a port. Uses OS-specific commands.
   */
  private async killProcessOnPort(port: number): Promise<void> {
    try {
      if (process.platform === 'win32') {
        const out = execSync('netstat -ano', { encoding: 'utf8', timeout: 5000, windowsHide: true } as any);
        for (const line of out.split('\n')) {
          if (!line.includes(`:${port}`) || !/LISTENING/i.test(line)) continue;
          const parts = line.trim().split(/\s+/);
          const pid = parts[parts.length - 1];
          if (pid && /^\d+$/.test(pid)) {
            try {
              execSync(`taskkill /PID ${pid} /F`, { timeout: 5000, windowsHide: true } as any);
            } catch { /* process may have already exited */ }
          }
        }
      } else {
        try {
          execSync(`lsof -ti :${port} | xargs kill -9 2>/dev/null`, { timeout: 5000, windowsHide: true } as any);
        } catch { /* no process on port */ }
      }
    } catch { /* ignore errors — best effort cleanup */ }
  }

  private getGraceMs(component: string): number {
    const mod = this.bootConfig.modules.find((m) => m.id === component);
    const bootGraceMs = mod?.health?.graceMs ?? 10000;
    // Cap recovery grace at 120s — the boot graceMs (up to 5 min) is for
    // cold starts under load; recovery restarts are warmer but Next.js dev
    // server compilation can take ~90s on a warm restart. 120s gives enough
    // margin while keeping the CLI responsive.
    const RECOVERY_GRACE_CAP_MS = 120000;
    return Math.min(bootGraceMs, RECOVERY_GRACE_CAP_MS);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Resolve the Docker CLI command using the shared resolver.
   * Caches the result to avoid repeated probes during recovery.
   */
  private _dockerCmdCache: string | null | undefined = undefined;
  private resolveDockerCmd(): string | null {
    if (this._dockerCmdCache !== undefined) return this._dockerCmdCache;
    try {
      const { resolveDocker } = require('../../scripts/resolve-docker.js');
      const info = resolveDocker({ skipDaemonCheck: true });
      this._dockerCmdCache = info.cmd;
    } catch {
      this._dockerCmdCache = null;
    }
    return this._dockerCmdCache ?? null;
  }

  private createNoOpRecord(component: string, correlationId: string, cause: string, reason: string): RecoveryRecord {
    return {
      component,
      correlationId,
      cause,
      action: { ...DEFAULT_RECOVERY_ACTION, target: component, type: 'no_action' },
      attempts: [],
      finalState: this.stateModel.getState(component).state,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
    };
  }

  /**
   * Get recovery history (for diagnostics).
   */
  getHistory(): RecoveryRecord[] {
    return [...this.recoveryHistory];
  }

  /**
   * Get active recoveries.
   */
  getActiveRecoveries(): string[] {
    return [...this.activeRecoveries.keys()];
  }

  /**
   * Clean up all spawned processes and state.
   */
  destroy(): void {
    for (const [component, child] of this.spawnedProcesses) {
      try { child.kill('SIGTERM'); } catch { /* already dead */ }
    }
    this.spawnedProcesses.clear();
    this.activeRecoveries.clear();
  }
}
