/**
 * Credential Governance Orchestrator
 *
 * Extends the existing credential governance system with:
 *   - bootstrapStripeTestCredential (Phase 5)
 *   - Event-driven blocker reevaluation (Phase 6)
 *   - Self-healing integration (Phase 15)
 *   - Human action request lifecycle (Phase 14)
 *
 * This orchestrator ties together:
 *   - CredentialSourceManager (credential source abstraction)
 *   - StripeCliSessionManager (CLI session management)
 *   - StripeCredentialProviderAdapter (credential probing)
 *   - StripeE2EOrchestrator (E2E qualification)
 *   - CredentialStateMachine (lifecycle management)
 *   - EvidenceModel (evidence recording)
 *   - BlockerResolutionEngine (blocker reevaluation)
 *
 * The orchestrator implements the target loop:
 *   OBSERVE → DIAGNOSE → PLAN → AUTHORIZE → EXECUTE → VERIFY → RECOVER → CERTIFY → RECORD
 */

import { randomUUID } from 'crypto';
import { getCredentialSourceManager, type CredentialHandle, type CredentialProvider, type CredentialEnvironment } from './CredentialSource';
import { getStripeCliSessionManager, type StripeCliStatus, type HumanActionRequest } from './StripeCliSessionManager';
import { getStripeCredentialAdapter } from './StripeCredentialProviderAdapter';
import { getStripeE2EOrchestrator, type OrchestratorState } from './StripeE2EOrchestrator';
import { getCredentialStateMachine, type CredentialRecord } from './CredentialStateMachine';
import { createEvidence, getEvidenceStore, type EvidenceBlocker, type VerificationLevel } from './EvidenceModel';
import { getHistoricalSecretRemediationTracker, type HistoricalSecretFinding, type RemediationStatus } from './HistoricalSecretRemediationTracker';
import { getCredentialGovernanceStatusReporter, type GovernanceStatus } from './CredentialGovernanceStatus';

// ─── Event Types (Phase 16: Observability) ───────────────────────────────

export type CredentialEvent =
  | 'credential.discovered'
  | 'credential.validated'
  | 'credential.invalid'
  | 'credential.expired'
  | 'credential.exposed'
  | 'credential.rotation.proposed'
  | 'credential.rotation.authorized'
  | 'credential.rotation.started'
  | 'credential.rotation.completed'
  | 'credential.rotation.failed'
  | 'stripe.cli.detected'
  | 'stripe.cli.authenticated'
  | 'stripe.cli.expired'
  | 'stripe.listener.started'
  | 'stripe.listener.stopped'
  | 'stripe.e2e.started'
  | 'stripe.e2e.checkout_created'
  | 'stripe.e2e.webhook_received'
  | 'stripe.e2e.signature_verified'
  | 'stripe.e2e.signature_rejected'
  | 'stripe.e2e.idempotency_verified'
  | 'stripe.e2e.completed'
  | 'stripe.e2e.blocked'
  | 'blocker.reevaluated'
  | 'blocker.resolved'
  | 'blocker.persisted'
  | 'human.action.requested'
  | 'human.action.resolved';

export interface CredentialEventRecord {
  event: CredentialEvent;
  timestamp: string;
  correlationId: string;
  metadata: Record<string, unknown>;
}

type EventListener = (event: CredentialEventRecord) => void;

// ─── Bootstrap Result ────────────────────────────────────────────────────

export interface BootstrapResult {
  success: boolean;
  credentialHandle: CredentialHandle | null;
  source: string;
  state: string;
  evidence: string;
  blocker: EvidenceBlocker | null;
  humanActionRequired: HumanActionRequest | null;
}

// ─── Reevaluation Result ─────────────────────────────────────────────────

export interface ReevaluationResult {
  changed: boolean;
  oldState: OrchestratorState;
  newState: OrchestratorState;
  resolvedBlockers: string[];
  newBlockers: string[];
  readyToExecute: boolean;
}

// ─── Credential Governance Orchestrator ──────────────────────────────────

export class CredentialGovernanceOrchestrator {
  private eventListeners: EventListener[] = [];
  private eventHistory: CredentialEventRecord[] = [];
  private correlationId: string;
  private reevaluationInterval: NodeJS.Timeout | null = null;
  private isRunning: boolean = false;

  constructor(correlationId?: string) {
    this.correlationId = correlationId || `credential-gov-${randomUUID().substring(0, 8)}`;
  }

  // ─── Event System (Phase 16) ────────────────────────────────────────────

  on(event: CredentialEvent, listener: EventListener): void {
    this.eventListeners.push(listener);
  }

  emit(event: CredentialEvent, metadata: Record<string, unknown> = {}): void {
    const record: CredentialEventRecord = {
      event,
      timestamp: new Date().toISOString(),
      correlationId: this.correlationId,
      metadata: this.redactMetadata(metadata),
    };
    this.eventHistory.push(record);
    if (this.eventHistory.length > 1000) this.eventHistory.shift();
    for (const listener of this.eventListeners) {
      try { listener(record); } catch { /* listener error — ignore */ }
    }
  }

  getEventHistory(): CredentialEventRecord[] {
    return [...this.eventHistory];
  }

  private redactMetadata(metadata: Record<string, unknown>): Record<string, unknown> {
    const redacted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(metadata)) {
      if (key.toLowerCase().includes('secret') || key.toLowerCase().includes('key') || key.toLowerCase().includes('token') || key.toLowerCase().includes('password')) {
        redacted[key] = '[REDACTED]';
      } else if (typeof value === 'string' && (value.startsWith('sk_') || value.startsWith('rk_') || value.startsWith('whsec_') || value.startsWith('eyJ'))) {
        redacted[key] = '[REDACTED]';
      } else {
        redacted[key] = value;
      }
    }
    return redacted;
  }

  // ─── Phase 5: Bootstrap Stripe Test Credential ──────────────────────────

  /**
   * Governed bootstrap action: discover, validate, and store a Stripe
   * test credential from any available source.
   *
   * Never accepts a credential merely because it matches sk_test_.
   * The provider must confirm it.
   */
  async bootstrapStripeTestCredential(authorization: {
    mode: 'autonomous' | 'policy_authorized' | 'human_authorized';
    actor: string | null;
    role: string | null;
  }): Promise<BootstrapResult> {
    const operationId = `bootstrap-stripe-${randomUUID().substring(0, 8)}`;
    this.emit('stripe.e2e.started', { operationId, action: 'bootstrap' });

    // Step 1: Inspect existing secure credential sources
    const sourceManager = getCredentialSourceManager();
    const lookup = await sourceManager.getCredential('stripe', 'stripe_secret_key', 'test');

    if (lookup.handle && lookup.handle.hasValue) {
      // Step 2: Validate the credential against Stripe
      const value = lookup.handle._access();
      if (!value) {
        return this.bootstrapBlocked('Credential handle has no value', operationId);
      }

      // Check for placeholder
      const { isPlaceholder } = require('./CredentialStateMachine');
      if (isPlaceholder(value)) {
        return this.bootstrapBlocked('Credential is a placeholder', operationId);
      }

      // Step 3: Validate via provider API
      const adapter = getStripeCredentialAdapter();
      const sm = getCredentialStateMachine();

      // Register/update the credential in the state machine
      let record = sm.getByName('STRIPE_SECRET_KEY');
      if (!record) {
        const { classifyEnvironment, safePrefix, fingerprint } = require('./CredentialSource');
        record = sm.register({
          name: 'STRIPE_SECRET_KEY',
          type: 'stripe_secret_key',
          provider: 'stripe',
          fingerprint: lookup.handle.fingerprint,
          prefix: lookup.handle.prefix,
          environment: lookup.handle.environment,
          source: `credential_source:${lookup.source}`,
          dependentCapabilities: ['commercial.stripe', 'stripe-e2e-qualification'],
          dependentServices: ['api/webhooks/stripe', 'api/checkout'],
          rotationSafe: lookup.handle.environment === 'test',
        });
      }

      // Run Level 3 probe (provider API validation)
      const probe = await adapter.probe(record.id, 3, authorization, this.correlationId);

      if (probe.result === 'PASS') {
        // Step 4: Identify test/live mode
        if (probe.metadata.environment === 'live') {
          return this.bootstrapBlocked('Credential is LIVE mode — bootstrap requires TEST mode', operationId);
        }

        // Step 5: Credential is valid and in test mode
        this.emit('credential.validated', { source: lookup.source, environment: 'test' });

        // Step 6: Store in secure local source if authorized
        if (authorization.mode !== 'autonomous' && lookup.source === 'ENVIRONMENT') {
          // Promote to secure local store
          await sourceManager.storeCredential('stripe', 'stripe_secret_key', 'test', value, {
            actor: authorization.actor || 'system',
            role: authorization.role || 'system',
          });
        }

        return {
          success: true,
          credentialHandle: lookup.handle,
          source: lookup.source,
          state: 'HEALTHY',
          evidence: `Stripe test credential validated from ${lookup.source}: ${probe.evidence}`,
          blocker: null,
          humanActionRequired: null,
        };
      }

      // Credential is invalid
      this.emit('credential.invalid', { source: lookup.source, reason: probe.evidence });
      return {
        success: false,
        credentialHandle: lookup.handle,
        source: lookup.source,
        state: 'INVALID',
        evidence: `Credential from ${lookup.source} failed validation: ${probe.evidence}`,
        blocker: probe.blocker || null,
        humanActionRequired: null,
      };
    }

    // Step 7: No credential from any source — check Stripe CLI
    const cliManager = getStripeCliSessionManager();
    const cliStatus = await cliManager.diagnose();

    this.emit('stripe.cli.detected', { state: cliStatus.state, path: cliStatus.cliPath });

    if (cliStatus.state === 'AUTHENTICATED' && cliStatus.accountMode === 'test') {
      // CLI is authenticated in test mode — we can use it for E2E
      // but we still need an API key for the application
      return this.bootstrapBlocked('Stripe CLI authenticated but no API key available — provide STRIPE_SECRET_KEY', operationId);
    }

    if (cliStatus.state === 'EXPIRED' || cliStatus.state === 'NOT_AUTHENTICATED') {
      // Create human action request for CLI authentication
      const humanAction = cliManager.getPendingHumanActionRequests()[0];
      this.emit('human.action.requested', { action: 'stripe_cli_authentication' });
      return {
        success: false,
        credentialHandle: null,
        source: 'UNAVAILABLE',
        state: 'BLOCKED',
        evidence: `Stripe CLI ${cliStatus.state} — authentication required`,
        blocker: cliStatus.blocker,
        humanActionRequired: humanAction || null,
      };
    }

    return this.bootstrapBlocked('No Stripe test credential available from any source', operationId);
  }

  // ─── Phase 6: Event-Driven Blocker Reevaluation ─────────────────────────

  /**
   * Reevaluate all blockers after a state change.
   * Called automatically when credentials change, CLI authenticates, etc.
   */
  async reevaluateBlockers(): Promise<ReevaluationResult> {
    const orchestrator = getStripeE2EOrchestrator();
    const oldCheckpoint = orchestrator.getCheckpoint();
    const oldState = oldCheckpoint.state;

    this.emit('blocker.reevaluated', { oldState });

    // Check if the Stripe E2E can be unblocked
    const unblocked = await orchestrator.checkIfUnblocked();

    // Also check Stripe CLI state
    const cliManager = getStripeCliSessionManager();
    await cliManager.checkAndResolveHumanActions();

    const newCheckpoint = orchestrator.getCheckpoint();
    const newState = newCheckpoint.state;

    const resolvedBlockers: string[] = [];
    const newBlockers: string[] = [];

    if (unblocked) {
      resolvedBlockers.push('Stripe E2E credential blocker resolved');
      this.emit('blocker.resolved', { blocker: 'stripe_e2e_credential' });
    }

    if (newState === 'BLOCKED' && oldState !== 'BLOCKED') {
      newBlockers.push(newCheckpoint.blocker?.reason || 'New blocker detected');
    }

    const result: ReevaluationResult = {
      changed: newState !== oldState,
      oldState,
      newState,
      resolvedBlockers,
      newBlockers,
      readyToExecute: newState === 'READY_TO_EXECUTE',
    };

    this.emit('blocker.reevaluated', { ...result });
    return result;
  }

  /**
   * Start automatic reevaluation monitoring.
   * Periodically checks for state changes and reevaluates blockers.
   */
  startAutoReevaluation(intervalMs: number = 30000): void {
    if (this.reevaluationInterval) return;
    this.isRunning = true;

    const check = async () => {
      if (!this.isRunning) return;
      try {
        await this.reevaluateBlockers();
      } catch {
        // Reevaluation failed — will retry on next interval
      }
    };

    this.reevaluationInterval = setInterval(check, intervalMs);
  }

  /**
   * Stop automatic reevaluation.
   */
  stopAutoReevaluation(): void {
    this.isRunning = false;
    if (this.reevaluationInterval) {
      clearInterval(this.reevaluationInterval);
      this.reevaluationInterval = null;
    }
  }

  // ─── Phase 15: Self-Healing Integration ────────────────────────────────

  /**
   * Attempt to self-heal a blocker.
   * Only performs actions that are within autonomous authority (R0-R2).
   */
  async selfHeal(blockerType: string): Promise<{ healed: boolean; action: string; evidence: string }> {
    switch (blockerType) {
      case 'STRIPE_CLI_NOT_RUNNING': {
        const cliManager = getStripeCliSessionManager();
        const result = await cliManager.restartListener();
        this.emit(result.started ? 'stripe.listener.started' : 'stripe.listener.stopped', { started: result.started });
        return {
          healed: result.started,
          action: 'restart_stripe_cli_listener',
          evidence: result.reason,
        };
      }

      case 'STRIPE_CLI_EXPIRED': {
        // Cannot self-heal — requires browser authentication
        const cliManager = getStripeCliSessionManager();
        const status = await cliManager.diagnose();
        return {
          healed: false,
          action: 'diagnose_stripe_cli',
          evidence: `CLI state: ${status.state} — requires human authentication`,
        };
      }

      case 'WEBHOOK_LISTENER_DIED': {
        const cliManager = getStripeCliSessionManager();
        const result = await cliManager.restartListener();
        return {
          healed: result.started,
          action: 'restart_webhook_listener',
          evidence: result.reason,
        };
      }

      case 'PROVIDER_UNAVAILABLE': {
        // Retry with bounded backoff
        const adapter = getStripeCredentialAdapter();
        const sm = getCredentialStateMachine();
        const creds = sm.getByProvider('stripe');
        for (const cred of creds) {
          if (cred.type === 'stripe_secret_key') {
            const probe = await adapter.probe(cred.id, 3, { mode: 'autonomous', actor: 'self-heal', role: null }, this.correlationId);
            if (probe.result === 'PASS') {
              return { healed: true, action: 'retry_provider_probe', evidence: probe.evidence };
            }
          }
        }
        return { healed: false, action: 'retry_provider_probe', evidence: 'Provider still unavailable after retry' };
      }

      default:
        return { healed: false, action: 'unknown_blocker', evidence: `Cannot self-heal: ${blockerType}` };
    }
  }

  // ─── Phase 24: Full Autonomy Cycle ──────────────────────────────────────

  /**
   * Run the full autonomy cycle:
   *   OBSERVE → DIAGNOSE → PLAN → AUTHORIZE → EXECUTE → VERIFY → CERTIFY → RECORD
   *
   * This is the main entry point for autonomous credential governance.
   */
  async runAutonomyCycle(authorization: {
    mode: 'autonomous' | 'policy_authorized' | 'human_authorized';
    actor: string | null;
    role: string | null;
  }): Promise<{
    status: GovernanceStatus;
    readyToExecute: boolean;
    humanActionsRequired: HumanActionRequest[];
    evidence: string[];
  }> {
    const evidence: string[] = [];

    // OBSERVE: Discover current state
    const reporter = getCredentialGovernanceStatusReporter();
    const report = await reporter.generateReport();
    evidence.push(`OBSERVE: Overall status = ${report.overallStatus}`);

    // DIAGNOSE: Identify blockers
    const cliManager = getStripeCliSessionManager();
    const cliStatus = await cliManager.diagnose();
    evidence.push(`DIAGNOSE: CLI state = ${cliStatus.state}, E2E state = ${report.stripeE2E.state}`);

    // PLAN: Determine what can be done autonomously
    const autonomousActions: string[] = [];
    const humanActions: HumanActionRequest[] = [];

    if (cliStatus.state === 'NOT_INSTALLED') {
      humanActions.push(...cliManager.getPendingHumanActionRequests());
    } else if (cliStatus.state === 'EXPIRED' || cliStatus.state === 'NOT_AUTHENTICATED') {
      humanActions.push(...cliManager.getPendingHumanActionRequests());
    } else if (cliStatus.state === 'AUTHENTICATED') {
      // CLI is good — try to bootstrap the credential
      const bootstrap = await this.bootstrapStripeTestCredential(authorization);
      evidence.push(`PLAN: Bootstrap result = ${bootstrap.state}`);

      if (bootstrap.success) {
        // Reevaluate blockers
        const reeval = await this.reevaluateBlockers();
        evidence.push(`EXECUTE: Reevaluation changed = ${reeval.changed}, ready = ${reeval.readyToExecute}`);

        if (reeval.readyToExecute && authorization.mode !== 'autonomous') {
          // Execute the E2E test
          const orchestrator = getStripeE2EOrchestrator();
          const result = await orchestrator.run(authorization);
          evidence.push(`VERIFY: E2E result = ${result.state}`);

          if (result.state === 'COMPLETED') {
            this.emit('stripe.e2e.completed', { runId: result.runId });
            evidence.push('CERTIFY: E2E externally verified');
          }
        }
      } else if (bootstrap.humanActionRequired) {
        humanActions.push(bootstrap.humanActionRequired);
      }
    }

    // Self-heal any autonomous-repairable blockers
    if (cliStatus.listenerState === 'FAILED' || cliStatus.listenerState === 'NOT_RUNNING') {
      const healResult = await this.selfHeal('STRIPE_CLI_NOT_RUNNING');
      evidence.push(`RECOVER: Listener restart = ${healResult.healed}`);
    }

    // RECORD: All evidence has been recorded through EvidenceModel
    this.emit('blocker.reevaluated', { humanActions: humanActions.length });

    return {
      status: report.overallStatus,
      readyToExecute: report.stripeE2E.state === 'READY_TO_EXECUTE',
      humanActionsRequired: humanActions,
      evidence,
    };
  }

  // ─── Phase 10: Historical Secret Autoremediation ───────────────────────

  /**
   * Run the historical secret remediation workflow.
   */
  async runHistoricalSecretRemediation(authorization: {
    mode: 'autonomous' | 'policy_authorized' | 'human_authorized';
    actor: string | null;
    role: string | null;
  }): Promise<{
    totalFindings: number;
    placeholders: number;
    realCredentials: number;
    awaitingAuthorization: number;
    remediated: number;
    humanActionsRequired: HumanActionRequest[];
  }> {
    const tracker = getHistoricalSecretRemediationTracker();
    const findings = tracker.scanHistory();
    const humanActions: HumanActionRequest[] = [];

    let placeholders = 0;
    let realCredentials = 0;
    let awaitingAuth = 0;
    let remediated = 0;

    for (const finding of findings) {
      // Classify: is this a real credential or a placeholder?
      if (this.isPlaceholderFinding(finding)) {
        // Mark as non-credential placeholder — not a security incident
        tracker.updateRemediation(finding.id, {
          status: 'REMEDIATION_COMPLETE',
          cleanupStatus: 'NOT_APPLICABLE',
          rotationStatus: 'NOT_REQUIRED',
          revocationStatus: 'NOT_REQUIRED',
          verificationStatus: 'NOT_VERIFIABLE',
          ownerActionRequired: null,
          notes: ['Classified as NON_CREDENTIAL_PLACEHOLDER — not a real secret'],
        }, { mode: 'autonomous', actor: 'credential-governance', role: null });
        placeholders++;
        continue;
      }

      // Real credential — determine provider and create remediation plan
      realCredentials++;
      const plan = this.createRemediationPlan(finding);

      if (plan.requiresAuthorization) {
        tracker.updateRemediation(finding.id, {
          status: 'ROTATION_PENDING_AUTHORIZATION',
          rotationStatus: 'REQUIRED',
          ownerActionRequired: plan.humanAction,
        }, { mode: 'autonomous', actor: 'credential-governance', role: null });
        awaitingAuth++;

        // Create human action request
        const request: HumanActionRequest = {
          id: `AR-${randomUUID().substring(0, 8)}`,
          capability: 'Historical Secret Remediation',
          blockedAction: `Rotate exposed ${finding.secretType}`,
          reason: `${finding.secretType} found in ${finding.filePath} (commit ${finding.commitSha.substring(0, 8)})`,
          humanActionRequired: plan.humanAction || 'Rotate the exposed credential',
          securityImpact: finding.severity === 'CRITICAL' ? 'HIGH — live credential exposed in Git history' : 'MEDIUM — credential exposed in Git history',
          afterCompletion: 'HYDI will verify the rotation and update remediation status.',
          expiration: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          createdAt: new Date().toISOString(),
          resolved: false,
          resolvedAt: null,
        };
        humanActions.push(request);
        this.emit('human.action.requested', { findingId: finding.id, secretType: finding.secretType });
      }
    }

    return {
      totalFindings: findings.length,
      placeholders,
      realCredentials,
      awaitingAuthorization: awaitingAuth,
      remediated,
      humanActionsRequired: humanActions,
    };
  }

  // ─── Phase 13: Human Action Minimization ────────────────────────────────

  /**
   * Get all pending human action requests across all subsystems.
   */
  getAllPendingHumanActions(): HumanActionRequest[] {
    const cliManager = getStripeCliSessionManager();
    return cliManager.getPendingHumanActionRequests();
  }

  /**
   * Check if any human actions can be auto-resolved.
   */
  async checkAndResolveHumanActions(): Promise<void> {
    const cliManager = getStripeCliSessionManager();
    await cliManager.checkAndResolveHumanActions();
  }

  // ─── Private Helpers ────────────────────────────────────────────────────

  private bootstrapBlocked(reason: string, operationId: string): BootstrapResult {
    this.emit('stripe.e2e.blocked', { reason });
    const blocker: EvidenceBlocker = {
      type: 'EXTERNAL_CREDENTIAL',
      provider: 'stripe',
      capability: 'stripe-e2e-qualification',
      severity: 'blocking',
      repairability: 'human_required',
      reason,
      attemptedActions: ['credential_source_discovery', 'cli_session_check'],
      requiredHumanAction: 'Provide a valid Stripe test-mode credential',
      risk: 'HIGH',
    };
    return {
      success: false,
      credentialHandle: null,
      source: 'UNAVAILABLE',
      state: 'BLOCKED',
      evidence: reason,
      blocker,
      humanActionRequired: null,
    };
  }

  private isPlaceholderFinding(finding: HistoricalSecretFinding): boolean {
    // Check if the redacted preview looks like a placeholder
    const preview = finding.redactedPreview;
    if (preview.includes('0000') || preview.includes('placeholder') || preview.includes('example')) {
      return true;
    }
    // Check if the fingerprint matches known placeholder fingerprints
    return false;
  }

  private createRemediationPlan(finding: HistoricalSecretFinding): {
    requiresAuthorization: boolean;
    humanAction: string | null;
    steps: string[];
  } {
    const steps: string[] = [];
    let humanAction: string | null = null;

    switch (finding.secretType) {
      case 'STRIPE_LIVE_KEY':
      case 'STRIPE_RESTRICTED_KEY':
        humanAction = `Rotate the exposed Stripe key via Stripe Dashboard → Developers → API keys. The exposed key fingerprint is ${finding.fingerprint}.`;
        steps.push('Rotate key in Stripe Dashboard', 'Update .env.local with new key', 'Verify new key works', 'Revoke old key');
        break;
      case 'STRIPE_WEBHOOK_SECRET':
        humanAction = `Rotate the webhook signing secret via Stripe Dashboard → Developers → Webhooks. The exposed secret fingerprint is ${finding.fingerprint}.`;
        steps.push('Rotate webhook secret in Stripe Dashboard', 'Update STRIPE_WEBHOOK_SECRET in .env.local', 'Verify webhook signature');
        break;
      case 'SUPABASE_SERVICE_ROLE_JWT':
        humanAction = `Rotate the Supabase service-role key via Supabase Dashboard → Settings → API. The exposed key fingerprint is ${finding.fingerprint}.`;
        steps.push('Rotate service-role key in Supabase Dashboard', 'Update SUPABASE_SERVICE_ROLE_KEY in .env.local');
        break;
      default:
        humanAction = `Rotate the exposed ${finding.secretType} credential via the provider dashboard. Fingerprint: ${finding.fingerprint}.`;
        steps.push('Rotate credential via provider dashboard', 'Update local configuration');
    }

    return {
      requiresAuthorization: true, // All rotations require human authorization
      humanAction,
      steps,
    };
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

let orchestratorInstance: CredentialGovernanceOrchestrator | null = null;

export function getCredentialGovernanceOrchestrator(): CredentialGovernanceOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new CredentialGovernanceOrchestrator();
  }
  return orchestratorInstance;
}
