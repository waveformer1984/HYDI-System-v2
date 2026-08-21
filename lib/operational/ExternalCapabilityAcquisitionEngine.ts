/**
 * External Capability Acquisition Engine
 *
 * The core engine that drives HEIDI's autonomous capability acquisition.
 * When a capability is blocked, this engine:
 *
 *   1. DISCOVER — what's missing and why (structured blocker classification)
 *   2. PLAN — determine how to obtain it (declarative acquisition plan)
 *   3. AUTHORIZE — check governance policy (is HEIDI allowed to do this?)
 *   4. ACQUIRE — execute permitted steps (autonomous only; human steps escalated)
 *   5. PROVISION — securely store credentials (metadata, not plaintext)
 *   6. CONFIGURE — apply configuration, restart affected services
 *   7. VERIFY — call the real provider API to confirm capability works
 *   8. QUALIFY — record the full lifecycle with evidence
 *   9. RECORD — persist audit trail to heidi_events
 *
 * Governance is NEVER bypassed:
 *   - R0/R1 steps (observation, config, restart) execute autonomously
 *   - R2 steps (resource creation) require owner authorization
 *   - R3 steps (account creation, financial, legal) require human action
 *   - R5 steps are refused
 *
 * The engine operates through HEIDI's existing decision pipeline via the
 * ExecutionBridge, not as an independent automation daemon.
 */

import type {
  CapabilityAcquisitionState,
  CapabilityBlocker,
  CapabilityAcquisitionPlan,
  AcquisitionLifecycle,
  AcquisitionAuditRecord,
  AcquisitionAuditEventType,
  PolicyDecision,
  StateTransition,
  FailureClass,
  RetryPolicy,
  OwnerAuthorization,
  AcquisitionSafetyLimits,
  CredentialState,
} from './CapabilityAcquisitionTypes';
import { DEFAULT_SAFETY_LIMITS } from './CapabilityAcquisitionTypes';
import { getProviderAdapterRegistry, type ProviderAdapter, type AccountStateResult, type VerificationResult } from './ProviderAdapters';
import { getAcquisitionGovernancePolicy } from './AcquisitionGovernancePolicy';
import { getSecretManager } from './SecretManager';
import { getDurableAcquisitionStore, type DurableAcquisitionStore } from './DurableAcquisitionStore';
import { getOperationalMemoryStore } from './OperationalMemoryStore';

// ─── Retry / Backoff ──────────────────────────────────────────────────────

const DEFAULT_RETRY_POLICY: RetryPolicy = {
  maxAttempts: 3,
  initialDelayMs: 1000,
  maxDelayMs: 30000,
  backoffMultiplier: 2,
  nonRetryableFailures: ['AUTHORIZATION_FAILURE', 'CREDENTIAL_FAILURE', 'CONFIGURATION_FAILURE'],
};

function computeBackoffDelay(attempt: number, policy: RetryPolicy): number {
  const base = policy.initialDelayMs * Math.pow(policy.backoffMultiplier, attempt - 1);
  const capped = Math.min(base, policy.maxDelayMs);
  // Add jitter: ±25% of the capped delay
  const jitter = capped * 0.25 * (Math.random() * 2 - 1);
  return Math.max(0, Math.round(capped + jitter));
}

function shouldRetry(failureClass: FailureClass, attempt: number, policy: RetryPolicy): boolean {
  if (attempt >= policy.maxAttempts) return false;
  if (policy.nonRetryableFailures.includes(failureClass)) return false;
  return true;
}

// ─── Acquisition Engine ───────────────────────────────────────────────────

export interface AcquisitionEngineOptions {
  ownerAuthorizations?: OwnerAuthorization[];
  safetyLimits?: AcquisitionSafetyLimits;
  onStateChange?: (lifecycle: AcquisitionLifecycle) => void;
  onAuditEvent?: (record: AcquisitionAuditRecord) => void;
}

export class ExternalCapabilityAcquisitionEngine {
  private providerRegistry = getProviderAdapterRegistry();
  private governancePolicy = getAcquisitionGovernancePolicy();
  private secretManager = getSecretManager();
  private durableStore: DurableAcquisitionStore;
  private ownerAuthorizations: OwnerAuthorization[];
  private safetyLimits: AcquisitionSafetyLimits;
  private lifecycles: Map<string, AcquisitionLifecycle> = new Map();
  private onStateChange?: (lifecycle: AcquisitionLifecycle) => void;
  private onAuditEvent?: (record: AcquisitionAuditRecord) => void;
  private activeAcquisitions: Set<string> = new Set();
  private retryCounts: Map<string, number> = new Map();
  private lastAttemptTime: Map<string, number> = new Map();
  private circuitBreakerTripped: Set<string> = new Set();
  private consecutiveFailures: Map<string, number> = new Map();

  constructor(options: AcquisitionEngineOptions = {}) {
    this.ownerAuthorizations = options.ownerAuthorizations || [];
    this.safetyLimits = options.safetyLimits || DEFAULT_SAFETY_LIMITS;
    this.onStateChange = options.onStateChange;
    this.onAuditEvent = options.onAuditEvent;
    this.durableStore = getDurableAcquisitionStore();

    // Restore in-progress acquisitions from durable storage on startup
    this.restoreFromDurableStore();
  }

  /**
   * Restore in-progress acquisitions from durable storage after daemon restart.
   * This prevents HEIDI from forgetting what it was doing.
   */
  private restoreFromDurableStore(): void {
    const inProgress = this.durableStore.getInProgressAcquisitions();
    for (const record of inProgress) {
      // Reconstruct a lifecycle from the durable record
      const lifecycle: AcquisitionLifecycle = {
        id: record.lifecycleId,
        capabilityId: record.capabilityId,
        provider: record.provider,
        currentState: record.currentState,
        blocker: record.blocker,
        plan: null,
        policyDecision: record.policyDecision,
        startedAt: record.startedAt,
        completedAt: record.completedAt,
        transitions: record.transitions.slice(-20), // keep recent transitions
        auditRecords: [],
        retryCount: record.retryCount,
        lastError: record.lastError,
        credentialFingerprints: record.credentialFingerprints,
      };
      this.lifecycles.set(record.capabilityId, lifecycle);
      this.retryCounts.set(record.capabilityId, record.retryCount);
    }
  }

  /**
   * Update owner authorizations (e.g., when the owner grants new permissions).
   */
  setOwnerAuthorizations(authorizations: OwnerAuthorization[]): void {
    this.ownerAuthorizations = authorizations;
  }

  /**
   * Refresh owner authorizations from the durable store.
   * This is called at the start of each daemon cycle so HEIDI notices
   * when the owner grants authorization without requiring a daemon restart.
   */
  refreshAuthorizationsFromStore(): void {
    try {
      const { getOwnerAuthorizationStore } = require('./OwnerAuthorizationStore');
      const store = getOwnerAuthorizationStore();
      store.cleanupExpired();
      const active = store.getActiveAuthorizations();
      // Convert to OwnerAuthorization format
      this.ownerAuthorizations = active.map((req: any) => ({
        provider: req.provider,
        commitmentTypes: req.requestedCommitments,
        grantedAt: req.decidedAt || req.requestedAt,
        grantedBy: req.decidedBy || 'owner',
        expiresAt: req.expiresAt,
        scope: {
          capabilityId: req.capabilityId,
          financialLimitCents: req.estimatedFinancialExposureCents,
        },
      }));
    } catch {
      // Store failure must not block the engine
    }
  }

  /**
   * Update safety limits (e.g., when the kill switch is activated).
   */
  setSafetyLimits(limits: AcquisitionSafetyLimits): void {
    this.safetyLimits = limits;
  }

  /**
   * Main entry point: attempt to resolve a blocked capability.
   * Returns the final state and lifecycle record.
   * Implements bounded retry with exponential backoff and circuit breaker.
   */
  async resolveCapability(capabilityId: string): Promise<AcquisitionLifecycle> {
    // Check kill switch
    if (this.safetyLimits.killSwitchActive) {
      return this.createBlockedLifecycle(capabilityId, 'POLICY_NOT_AUTHORIZED', 'Kill switch is active — all acquisition denied');
    }

    // Check circuit breaker
    if (this.circuitBreakerTripped.has(capabilityId)) {
      const lifecycle = this.lifecycles.get(capabilityId);
      if (lifecycle) {
        this.recordAudit(lifecycle, 'CIRCUIT_BREAKER_TRIPPED', `Circuit breaker tripped for ${capabilityId} — not retrying`);
        return lifecycle;
      }
      return this.createBlockedLifecycle(capabilityId, 'UNKNOWN', 'Circuit breaker tripped');
    }

    // Check concurrency limit
    if (this.activeAcquisitions.size >= this.safetyLimits.maxConcurrentAcquisitions) {
      return this.createBlockedLifecycle(capabilityId, 'UNKNOWN', 'Maximum concurrent acquisitions reached');
    }

    // Check if already in progress
    if (this.activeAcquisitions.has(capabilityId)) {
      const existing = this.lifecycles.get(capabilityId);
      if (existing) return existing;
    }

    // Get the provider adapter
    const adapter = this.providerRegistry.getAdapter(capabilityId);
    if (!adapter) {
      return this.createBlockedLifecycle(capabilityId, 'UNKNOWN', `No provider adapter registered for ${capabilityId}`);
    }

    // Start the lifecycle
    const lifecycleId = `acq-${capabilityId}-${Date.now()}`;
    const lifecycle: AcquisitionLifecycle = {
      id: lifecycleId,
      capabilityId,
      provider: adapter.providerId,
      currentState: 'DISCOVERING',
      blocker: null,
      plan: null,
      policyDecision: null,
      startedAt: new Date().toISOString(),
      completedAt: null,
      transitions: [],
      auditRecords: [],
      retryCount: this.retryCounts.get(capabilityId) || 0,
      lastError: null,
      credentialFingerprints: {},
    };

    this.lifecycles.set(capabilityId, lifecycle);
    this.activeAcquisitions.add(capabilityId);

    try {
      // Phase 1: DISCOVER
      await this.discover(lifecycle, adapter);

      // If already ready, we're done
      if (lifecycle.currentState === 'READY') {
        return lifecycle;
      }

      // If blocked with a credential issue, proceed to planning
      if (lifecycle.currentState === 'BLOCKED') {
        // Phase 2: PLAN
        await this.plan(lifecycle, adapter);

        // Phase 3: AUTHORIZE
        await this.authorize(lifecycle, adapter);

        // If policy denies, stop
        if (lifecycle.policyDecision === 'DENY' || (lifecycle.currentState as string) === 'POLICY_BLOCKED') {
          return lifecycle;
        }

        // If policy requires owner authorization and we don't have it, escalate
        if (lifecycle.policyDecision === 'REQUIRES_OWNER_AUTHORIZATION') {
          this.recordAudit(lifecycle, 'AUTHORIZATION_DENIED', `Owner authorization required for ${adapter.providerId} — not granted`);
          lifecycle.currentState = 'POLICY_BLOCKED';
          this.transition(lifecycle, 'AUTHORIZING', 'POLICY_BLOCKED', 'Owner authorization not granted');
          return lifecycle;
        }

        // Phase 4: ACQUIRE (autonomous steps only)
        await this.acquire(lifecycle, adapter);

        // If acquire returned to BLOCKED (credentials still missing), stop
        if ((lifecycle.currentState as string) === 'BLOCKED') {
          return lifecycle;
        }

        // Phase 5: PROVISION
        await this.provision(lifecycle, adapter);

        // Phase 6: CONFIGURE
        await this.configure(lifecycle, adapter);

        // Phase 7: VERIFY
        await this.verify(lifecycle, adapter);

        // If verification failed, do NOT proceed to qualify — no fake readiness
        if ((lifecycle.currentState as string) === 'VERIFICATION_FAILED' ||
            (lifecycle.currentState as string) === 'PROVISIONING_FAILED' ||
            (lifecycle.currentState as string) === 'ACQUISITION_FAILED') {
          return lifecycle;
        }

        // Phase 8: QUALIFY
        await this.qualify(lifecycle, adapter);
      }

      return lifecycle;
    } catch (error) {
      lifecycle.lastError = error instanceof Error ? error.message : 'unknown error';
      this.recordAudit(lifecycle, 'ACQUISITION_FAILED', `Acquisition failed: ${lifecycle.lastError}`);
      this.transition(lifecycle, lifecycle.currentState, 'ACQUISITION_FAILED', lifecycle.lastError);

      // Circuit breaker: trip after 3 consecutive failures
      const failures = (this.consecutiveFailures.get(capabilityId) || 0) + 1;
      this.consecutiveFailures.set(capabilityId, failures);
      if (failures >= DEFAULT_RETRY_POLICY.maxAttempts) {
        this.circuitBreakerTripped.add(capabilityId);
        this.recordAudit(lifecycle, 'CIRCUIT_BREAKER_TRIPPED', `Circuit breaker tripped after ${failures} consecutive failures`);
      }

      // Schedule retry with exponential backoff if retryable
      const failureClass = this.classifyFailureFromError(lifecycle.lastError);
      const attempt = this.retryCounts.get(capabilityId) || 0;
      this.retryCounts.set(capabilityId, attempt + 1);
      if (shouldRetry(failureClass, attempt + 1, DEFAULT_RETRY_POLICY)) {
        const delay = computeBackoffDelay(attempt + 1, DEFAULT_RETRY_POLICY);
        this.recordAudit(lifecycle, 'RETRY_SCHEDULED', `Retry scheduled in ${delay}ms (attempt ${attempt + 1}/${DEFAULT_RETRY_POLICY.maxAttempts})`);
        // Note: actual retry is driven by the daemon's next cycle, not a timer here.
        // This prevents uncontrolled parallel retries.
      }

      return lifecycle;
    } finally {
      this.activeAcquisitions.delete(capabilityId);
      lifecycle.completedAt = new Date().toISOString();
      this.onStateChange?.(lifecycle);
    }
  }

  // ─── Phase implementations ──────────────────────────────────────────────

  private async discover(lifecycle: AcquisitionLifecycle, adapter: ProviderAdapter): Promise<void> {
    this.recordAudit(lifecycle, 'CAPABILITY_DISCOVERED', `Discovering state for ${adapter.providerId}`);
    this.transition(lifecycle, 'DISCOVERING', 'DISCOVERING', 'Starting discovery');

    const state = await adapter.discoverAccountState();

    lifecycle.blocker = state.blocker;

    this.recordAudit(lifecycle, 'BLOCKER_IDENTIFIED', `Blocker: ${state.blocker} — ${state.evidence}`);

    if (state.blocker === 'UNKNOWN' || state.credentialsValid === true) {
      // Might already be ready — verify
      const verification = await adapter.verifyCapability();
      if (verification.verified) {
        this.recordAudit(lifecycle, 'VERIFICATION_PASSED', verification.evidence);
        this.transition(lifecycle, 'DISCOVERING', 'READY', 'Already verified');
        lifecycle.currentState = 'READY';
        return;
      }
    }

    this.transition(lifecycle, 'DISCOVERING', 'BLOCKED', state.evidence);
    lifecycle.currentState = 'BLOCKED';
  }

  private async plan(lifecycle: AcquisitionLifecycle, adapter: ProviderAdapter): Promise<void> {
    this.recordAudit(lifecycle, 'ACQUISITION_PLANNED', `Planning acquisition for ${adapter.providerId}`);
    this.transition(lifecycle, 'BLOCKED', 'PLANNED', 'Acquisition plan created');

    const providerPlan = adapter.getAcquisitionPlan();

    // Build the full acquisition plan from the provider adapter
    const plan: CapabilityAcquisitionPlan = {
      capabilityId: adapter.capabilityId,
      provider: adapter.providerId,
      displayName: adapter.displayName,
      prerequisites: [],
      discovery: [],
      acquisition: [],
      provisioning: [],
      verification: [],
      requiredAuthorization: providerPlan.requiredAuthorization,
      reversible: !providerPlan.financialCommitment,
      financialCommitment: providerPlan.financialCommitment,
      legalAcceptance: providerPlan.legalAcceptance,
      identityVerification: providerPlan.identityVerification,
      secretRequirements: adapter.requiredEnvVars.map((envVar) => ({
        envVar,
        purpose: `Credential for ${adapter.displayName}`,
        provisioningMode: 'human_provided' as const,
        verificationMethod: `Call ${adapter.providerId} API`,
        sensitive: true,
      })),
      envFile: '.env.local',
      consumingServices: ['heidi-daemon'],
      requiresDaemonRestart: true,
    };

    lifecycle.plan = plan;
    lifecycle.currentState = 'PLANNED';
  }

  private async authorize(lifecycle: AcquisitionLifecycle, adapter: ProviderAdapter): Promise<void> {
    this.transition(lifecycle, 'PLANNED', 'AUTHORIZING', 'Evaluating governance policy');
    lifecycle.currentState = 'AUTHORIZING';

    const providerPlan = adapter.getAcquisitionPlan();

    // Evaluate each commitment type
    let overallDecision: PolicyDecision = 'ALLOW_AUTONOMOUS';

    for (const commitmentType of providerPlan.commitmentTypes) {
      const decision = this.governancePolicy.evaluate(
        { commitmentType, authorizationLevel: providerPlan.requiredAuthorization, provider: adapter.providerId },
        this.ownerAuthorizations,
      );

      this.recordAudit(lifecycle, 'POLICY_EVALUATED', `Policy for ${commitmentType}: ${decision}`);

      if (decision === 'DENY') {
        overallDecision = 'DENY';
        break;
      }
      if (decision === 'REQUIRES_OWNER_AUTHORIZATION' && (overallDecision as string) !== 'DENY') {
        overallDecision = 'REQUIRES_OWNER_AUTHORIZATION';
      }
    }

    lifecycle.policyDecision = overallDecision;

    if (overallDecision === 'ALLOW_AUTONOMOUS') {
      this.recordAudit(lifecycle, 'AUTHORIZATION_GRANTED', 'All steps authorized for autonomous execution');
    } else if (overallDecision === 'REQUIRES_OWNER_AUTHORIZATION') {
      // Check if we have owner authorization
      const hasAuth = providerPlan.commitmentTypes.every((ct) =>
        this.governancePolicy.checkOwnerAuthorization(adapter.providerId, ct, this.ownerAuthorizations),
      );

      if (hasAuth) {
        this.recordAudit(lifecycle, 'AUTHORIZATION_GRANTED', 'Owner authorization verified');
        lifecycle.policyDecision = 'ALLOW_WITH_POLICY';
      } else {
        // Create a pending authorization request for the owner
        await this.createAuthorizationRequest(lifecycle, adapter, providerPlan);
        this.recordAudit(lifecycle, 'AUTHORIZATION_DENIED', 'Owner authorization required but not granted — pending request created');
        this.transition(lifecycle, 'AUTHORIZING', 'POLICY_BLOCKED', 'Owner authorization not granted — pending request created');
        lifecycle.currentState = 'POLICY_BLOCKED';
        return;
      }
    } else if (overallDecision === 'DENY') {
      this.recordAudit(lifecycle, 'AUTHORIZATION_DENIED', 'Policy denies this acquisition');
      this.transition(lifecycle, 'AUTHORIZING', 'POLICY_BLOCKED', 'Policy denied');
      lifecycle.currentState = 'POLICY_BLOCKED';
      return;
    }

    this.transition(lifecycle, 'AUTHORIZING', 'ACQUIRING', 'Authorized');
    lifecycle.currentState = 'ACQUIRING';
  }

  private async acquire(lifecycle: AcquisitionLifecycle, adapter: ProviderAdapter): Promise<void> {
    const providerPlan = adapter.getAcquisitionPlan();

    // Execute autonomous steps only
    // Human-required steps are escalated, not bypassed
    if (providerPlan.humanRequiredSteps.length > 0 && lifecycle.blocker === 'MISSING_CREDENTIAL') {
      // Credentials need to be human-provided — we can't acquire them autonomously
      this.recordAudit(lifecycle, 'ACQUISITION_STARTED', `Waiting for human to provide credentials for ${adapter.providerId}`);

      // Check if credentials have appeared since discovery
      const missing = adapter.discoverMissingCredentials();
      if (missing.length > 0) {
        // Still missing — escalate with runbook
        lifecycle.lastError = `Human action required: ${providerPlan.humanRequiredSteps.join('; ')}`;
        this.recordAudit(lifecycle, 'ACQUISITION_FAILED', `Credentials still missing: ${missing.join(', ')}`);
        this.transition(lifecycle, 'ACQUIRING', 'BLOCKED', 'Waiting for human-provided credentials');
        lifecycle.currentState = 'BLOCKED';
        lifecycle.blocker = 'MISSING_CREDENTIAL';
        return;
      }
    }

    // Credentials are present — proceed to provisioning
    this.recordAudit(lifecycle, 'ACQUISITION_STARTED', `Credentials present for ${adapter.providerId}`);
    this.transition(lifecycle, 'ACQUIRING', 'PROVISIONING', 'Credentials acquired');
    lifecycle.currentState = 'PROVISIONING';
  }

  private async provision(lifecycle: AcquisitionLifecycle, adapter: ProviderAdapter): Promise<void> {
    this.recordAudit(lifecycle, 'CREDENTIAL_PROVISIONED', `Provisioning credentials for ${adapter.providerId}`);

    // Record credential fingerprints (metadata only, never values)
    for (const envVar of adapter.requiredEnvVars) {
      if (process.env[envVar]) {
        const metadata = this.secretManager.getCredentialMetadata(envVar);
        lifecycle.credentialFingerprints[envVar] = metadata.fingerprint || 'unknown';
        this.secretManager.recordVerification(envVar, 'PRESENT');
        this.recordAudit(lifecycle, 'CREDENTIAL_PROVISIONED', `Credential ${envVar} provisioned (fingerprint: ${metadata.fingerprint})`);
      }
    }

    this.transition(lifecycle, 'PROVISIONING', 'CONFIGURING', 'Credentials provisioned');
    lifecycle.currentState = 'CONFIGURING';
  }

  private async configure(lifecycle: AcquisitionLifecycle, adapter: ProviderAdapter): Promise<void> {
    this.recordAudit(lifecycle, 'CONFIGURATION_APPLIED', `Configuration applied for ${adapter.providerId}`);

    // Execute dependency-aware restart if needed
    // This uses the existing boot.config.json dependency graph and
    // the CapabilityAuthorizer's RESTARTABLE_MODULES set
    try {
      const { getRestartExecutor } = await import('./DependencyAwareRestartExecutor');
      const restartExecutor = getRestartExecutor();

      if (restartExecutor.isRestartable('heidi-web')) {
        const dependents = restartExecutor.getDependentServices(adapter.capabilityId);
        if (dependents.length > 0) {
          this.recordAudit(lifecycle, 'CONFIGURATION_APPLIED', `Dependency-aware restart for ${dependents.join(', ')} (triggered by ${adapter.capabilityId})`);

          const results = await restartExecutor.executeDependencyAwareRestart(
            adapter.capabilityId,
            `Credential provisioning for ${adapter.providerId}`,
          );

          for (const result of results) {
            if (result.healthy) {
              this.recordAudit(lifecycle, 'SERVICE_RESTARTED', `${result.target}: ${result.evidence}`);
            } else {
              this.recordAudit(lifecycle, 'ACQUISITION_FAILED', `${result.target} restart failed: ${result.error || result.evidence}`);
              this.transition(lifecycle, 'CONFIGURING', 'PROVISIONING_FAILED', `Restart of ${result.target} failed`);
              lifecycle.currentState = 'PROVISIONING_FAILED';
              lifecycle.lastError = `Service restart failed: ${result.error}`;
              return;
            }
          }
        }
      }
    } catch (restartError) {
      // Restart executor failure must not block acquisition —
      // the credentials are provisioned, we just couldn't restart services.
      // Verification will determine if the capability is actually working.
      this.recordAudit(lifecycle, 'CONFIGURATION_APPLIED', `Restart executor unavailable: ${restartError instanceof Error ? restartError.message : 'unknown'} — proceeding to verification`);
    }

    this.transition(lifecycle, 'CONFIGURING', 'VERIFYING', 'Configuration applied');
    lifecycle.currentState = 'VERIFYING';
  }

  private async verify(lifecycle: AcquisitionLifecycle, adapter: ProviderAdapter): Promise<void> {
    this.recordAudit(lifecycle, 'VERIFICATION_STARTED', `Verifying ${adapter.providerId} capability against real API`);

    const result = await adapter.verifyCapability();

    if (result.verified) {
      this.recordAudit(lifecycle, 'VERIFICATION_PASSED', result.evidence, result.latencyMs);

      // Record credential states as valid
      for (const envVar of adapter.requiredEnvVars) {
        if (process.env[envVar]) {
          this.secretManager.recordVerification(envVar, 'VALID');
        }
      }

      this.transition(lifecycle, 'VERIFYING', 'QUALIFYING', 'Verification passed');
      lifecycle.currentState = 'QUALIFYING';
    } else {
      this.recordAudit(lifecycle, 'VERIFICATION_FAILED', result.error || result.evidence, result.latencyMs);

      // Classify the failure
      const failureClass = this.classifyFailure(result);
      this.recordAudit(lifecycle, 'ACQUISITION_FAILED', `Verification failed: ${failureClass}`);

      this.transition(lifecycle, 'VERIFYING', 'VERIFICATION_FAILED', result.error || 'Verification failed');
      lifecycle.currentState = 'VERIFICATION_FAILED';
      lifecycle.lastError = result.error || result.evidence;
    }
  }

  private async qualify(lifecycle: AcquisitionLifecycle, adapter: ProviderAdapter): Promise<void> {
    this.recordAudit(lifecycle, 'CAPABILITY_QUALIFIED', `${adapter.providerId} qualified — ready for production use`);
    this.recordAudit(lifecycle, 'CAPABILITY_READY', `${adapter.providerId} is READY`);
    this.transition(lifecycle, 'QUALIFYING', 'READY', 'Capability qualified');
    lifecycle.currentState = 'READY';

    // Clear retry count on success
    this.retryCounts.delete(lifecycle.capabilityId);
    // Reset circuit breaker on success
    this.circuitBreakerTripped.delete(lifecycle.capabilityId);
    this.consecutiveFailures.delete(lifecycle.capabilityId);
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private transition(lifecycle: AcquisitionLifecycle, from: CapabilityAcquisitionState, to: CapabilityAcquisitionState, reason: string): void {
    const transition: StateTransition = {
      from,
      to,
      timestamp: new Date().toISOString(),
      reason,
      evidence: reason,
    };
    lifecycle.transitions.push(transition);
    // Persist to durable storage so state survives daemon restart
    this.durableStore.updateFromLifecycle(lifecycle);
    this.onStateChange?.(lifecycle);
  }

  private recordAudit(lifecycle: AcquisitionLifecycle, eventType: AcquisitionAuditEventType, description: string, latencyMs?: number): void {
    const record: AcquisitionAuditRecord = {
      timestamp: new Date().toISOString(),
      eventType,
      capabilityId: lifecycle.capabilityId,
      provider: lifecycle.provider,
      lifecycleId: lifecycle.id,
      description,
      latencyMs,
    };
    lifecycle.auditRecords.push(record);
    this.onAuditEvent?.(record);

    // Record to operational memory for long-term history
    try {
      const memory = getOperationalMemoryStore();
      const histEventType = this.mapAuditToHistoryEvent(eventType);
      memory.record({
        capabilityId: lifecycle.capabilityId,
        provider: lifecycle.provider,
        eventType: histEventType,
        state: lifecycle.currentState,
        reason: description,
        evidence: description,
        retryCount: lifecycle.retryCount,
        blocker: lifecycle.blocker || undefined,
      });
    } catch {
      // Operational memory failure must not block the engine
    }
  }

  private mapAuditToHistoryEvent(eventType: AcquisitionAuditEventType): 'OBSERVED' | 'ATTEMPTED' | 'BLOCKED' | 'POLICY_BLOCKED' | 'VERIFIED' | 'FAILED' | 'RECOVERED' | 'ESCALATED' | 'RESTARTED' | 'CIRCUIT_BREAKER_TRIPPED' | 'RETRY_SCHEDULED' {
    switch (eventType) {
      case 'CAPABILITY_DISCOVERED': return 'OBSERVED';
      case 'BLOCKER_IDENTIFIED': return 'BLOCKED';
      case 'ACQUISITION_STARTED': return 'ATTEMPTED';
      case 'AUTHORIZATION_DENIED': return 'POLICY_BLOCKED';
      case 'AUTHORIZATION_GRANTED': return 'ATTEMPTED';
      case 'VERIFICATION_STARTED': return 'ATTEMPTED';
      case 'CAPABILITY_QUALIFIED': return 'VERIFIED';
      case 'CAPABILITY_READY': return 'VERIFIED';
      case 'ACQUISITION_FAILED': return 'FAILED';
      case 'CIRCUIT_BREAKER_TRIPPED': return 'CIRCUIT_BREAKER_TRIPPED';
      case 'RETRY_SCHEDULED': return 'RETRY_SCHEDULED';
      case 'SERVICE_RESTARTED': return 'RESTARTED';
      default: return 'OBSERVED';
    }
  }

  private classifyFailure(result: VerificationResult): FailureClass {
    if (result.error?.includes('401') || result.error?.includes('INVALID')) return 'CREDENTIAL_FAILURE';
    if (result.error?.includes('403') || result.error?.includes('REVOKED')) return 'CREDENTIAL_FAILURE';
    if (result.error?.includes('timed out') || result.error?.includes('unreachable')) return 'PROVIDER_OUTAGE';
    if (result.error?.includes('rate') || result.error?.includes('429')) return 'RATE_LIMITED';
    return 'UNKNOWN_FAILURE';
  }

  private classifyFailureFromError(error: string): FailureClass {
    const lower = error.toLowerCase();
    if (lower.includes('401') || lower.includes('unauthorized') || lower.includes('invalid credential')) return 'CREDENTIAL_FAILURE';
    if (lower.includes('403') || lower.includes('forbidden') || lower.includes('revoked')) return 'CREDENTIAL_FAILURE';
    if (lower.includes('timed out') || lower.includes('timeout') || lower.includes('abort')) return 'PROVIDER_OUTAGE';
    if (lower.includes('unreachable') || lower.includes('econnrefused') || lower.includes('enetunreach')) return 'PROVIDER_OUTAGE';
    if (lower.includes('rate') || lower.includes('429') || lower.includes('too many requests')) return 'RATE_LIMITED';
    if (lower.includes('policy') || lower.includes('not authorized') || lower.includes('denied')) return 'AUTHORIZATION_FAILURE';
    if (lower.includes('config') || lower.includes('configuration')) return 'CONFIGURATION_FAILURE';
    return 'UNKNOWN_FAILURE';
  }

  /**
   * Create a pending authorization request for the owner.
   * This is called when HEIDI hits POLICY_BLOCKED and needs the owner
   * to approve the acquisition.
   */
  private async createAuthorizationRequest(
    lifecycle: AcquisitionLifecycle,
    adapter: ProviderAdapter,
    providerPlan: { commitmentTypes: import('./CapabilityAcquisitionTypes').ExternalCommitmentType[]; financialCommitment: boolean; legalAcceptance: boolean; identityVerification: boolean },
  ): Promise<void> {
    try {
      const { getOwnerAuthorizationStore } = await import('./OwnerAuthorizationStore');
      const store = getOwnerAuthorizationStore();

      // Check if there's already a pending request for this provider
      const existing = store.getPendingRequests().find((r) => r.provider === adapter.providerId);
      if (existing) {
        // Already pending — don't create a duplicate
        return;
      }

      // Check if there's already an active authorization for this provider
      const activeAuth = store.getActiveAuthorizations().find((r) => r.provider === adapter.providerId);
      if (activeAuth) {
        // Already authorized — don't create a new request
        return;
      }

      // Check if there's a denied or revoked request for this provider
      // — don't re-create a request the owner has already decided on
      const allRequests = store.getAllRequests();
      const denied = allRequests.find((r) => r.provider === adapter.providerId && (r.status === 'DENIED' || r.status === 'REVOKED'));
      if (denied) {
        // Owner has already denied this — don't create a new request
        return;
      }

      store.createRequest({
        provider: adapter.providerId,
        capabilityId: adapter.capabilityId,
        requestedCommitments: providerPlan.commitmentTypes,
        requiresLegalAcceptance: providerPlan.legalAcceptance,
        requiresIdentityVerification: providerPlan.identityVerification,
        reason: `Acquisition of ${adapter.displayName} requires owner authorization for: ${providerPlan.commitmentTypes.join(', ')}`,
        expiresAt: null,
      });
    } catch {
      // Authorization store failure must not block the engine
    }
  }

  private createBlockedLifecycle(capabilityId: string, blocker: CapabilityBlocker, reason: string): AcquisitionLifecycle {
    return {
      id: `acq-${capabilityId}-${Date.now()}`,
      capabilityId,
      provider: 'unknown',
      currentState: 'BLOCKED',
      blocker,
      plan: null,
      policyDecision: null,
      startedAt: new Date().toISOString(),
      completedAt: new Date().toISOString(),
      transitions: [],
      auditRecords: [{
        timestamp: new Date().toISOString(),
        eventType: 'AUTHORIZATION_DENIED',
        capabilityId,
        provider: 'unknown',
        lifecycleId: `acq-${capabilityId}-${Date.now()}`,
        description: reason,
      }],
      retryCount: 0,
      lastError: reason,
      credentialFingerprints: {},
    };
  }

  /**
   * Get the lifecycle record for a capability (if one exists).
   */
  getLifecycle(capabilityId: string): AcquisitionLifecycle | null {
    return this.lifecycles.get(capabilityId) || null;
  }

  /**
   * Get all lifecycle records.
   */
  getAllLifecycles(): AcquisitionLifecycle[] {
    return Array.from(this.lifecycles.values());
  }

  /**
   * Get the current state of a capability.
   */
  getCapabilityState(capabilityId: string): CapabilityAcquisitionState {
    const lifecycle = this.lifecycles.get(capabilityId);
    return lifecycle?.currentState || 'UNKNOWN';
  }

  /**
   * Check if a capability is ready (verified against real API).
   */
  isReady(capabilityId: string): boolean {
    return this.getCapabilityState(capabilityId) === 'READY';
  }
}

// ─── Singleton ────────────────────────────────────────────────────────────

let engineInstance: ExternalCapabilityAcquisitionEngine | null = null;

export function getAcquisitionEngine(options?: AcquisitionEngineOptions): ExternalCapabilityAcquisitionEngine {
  if (!engineInstance) {
    engineInstance = new ExternalCapabilityAcquisitionEngine(options);
  }
  return engineInstance;
}
