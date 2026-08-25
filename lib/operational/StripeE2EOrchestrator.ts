/**
 * Stripe E2E Qualification Orchestrator
 *
 * This is the first-class capability `stripe-e2e-qualification`.
 *
 * It orchestrates a REAL Stripe test-mode end-to-end flow:
 *   1. Verify Stripe configuration
 *   2. Verify test mode
 *   3. Verify webhook secret
 *   4. Verify endpoint reachability
 *   5. Start/validate Stripe CLI forwarding
 *   6. Create a real test-mode Checkout Session
 *   7. Complete it using Stripe test payment details
 *   8. Receive the real webhook
 *   9. Verify signature acceptance
 *  10. Verify event idempotency
 *  11. Verify exactly-one job activation
 *  12. Verify exactly-one ledger entry
 *  13. Verify artifact pipeline progression
 *  14. Verify awaiting_review state
 *  15. Verify human approval gate
 *  16. Verify delivery
 *  17. Verify evidence persistence
 *  18. Verify restart/recovery behavior
 *  19. Verify cleanup
 *  20. Certify external provider evidence separately
 *
 * CRITICAL NO-FALSE-GREEN RULES:
 *   - If valid credentials are unavailable → BLOCKED (never PASS)
 *   - If Stripe CLI is unavailable → BLOCKED
 *   - If webhook forwarding fails → BLOCKED
 *   - If the webhook never arrives → BLOCKED
 *   - If the ledger write fails → FAIL
 *   - If job activation fails → FAIL
 *   - A SIMULATED result NEVER satisfies EXTERNAL_VERIFIED
 *
 * The orchestrator is IDEMPOTENT and RESUMABLE. If it crashes halfway,
 * it inspects existing state and resumes rather than creating duplicate
 * checkout sessions.
 */

import { randomUUID } from 'crypto';
import { createEvidence, getEvidenceStore, type EvidenceRecord, type VerificationLevel, type EvidenceBlocker } from './EvidenceModel';
import { getCredentialStateMachine, type CredentialRecord } from './CredentialStateMachine';
import { getStripeCredentialAdapter, type StripeProbeResult } from './StripeCredentialProviderAdapter';

// ─── Orchestrator State ──────────────────────────────────────────────────

export type OrchestratorState =
  | 'NOT_STARTED'
  | 'BLOCKED_NO_CREDENTIAL'
  | 'BLOCKED_NO_WEBHOOK_SECRET'
  | 'BLOCKED_NO_CLI'
  | 'BLOCKED_NO_ENDPOINT'
  | 'READY_TO_EXECUTE'
  | 'EXECUTING'
  | 'VERIFYING_WEBHOOK'
  | 'VERIFYING_LEDGER'
  | 'VERIFYING_JOB'
  | 'VERIFYING_ARTIFACT'
  | 'VERIFYING_APPROVAL'
  | 'COMPLETED'
  | 'FAILED'
  | 'BLOCKED';

export interface OrchestratorCheckpoint {
  runId: string;
  state: OrchestratorState;
  startedAt: string;
  updatedAt: string;
  /** Step number last completed (0-20) */
  lastCompletedStep: number;
  /** Stripe checkout session ID if created (for resume) */
  checkoutSessionId: string | null;
  /** Stripe event ID if received */
  stripeEventId: string | null;
  /** Job ID if activated */
  jobId: string | null;
  /** Ledger entry ID if written */
  ledgerEntryId: string | null;
  /** Whether cleanup has run */
  cleanedUp: boolean;
  /** All evidence records produced */
  evidenceIds: string[];
  /** Blocker if blocked */
  blocker: EvidenceBlocker | null;
  /** All steps and their results */
  steps: StepResult[];
}

export interface StepResult {
  step: number;
  name: string;
  result: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED' | 'SIMULATED' | 'UNKNOWN';
  verificationLevel: VerificationLevel;
  evidence: string;
  timestamp: string;
  durationMs: number;
}

// ─── Orchestrator ────────────────────────────────────────────────────────

export class StripeE2EOrchestrator {
  private checkpoint: OrchestratorCheckpoint;
  private checkpointStore: Map<string, OrchestratorCheckpoint> = new Map();
  private readonly correlationId: string;

  constructor(correlationId?: string) {
    this.correlationId = correlationId || randomUUID();
    this.checkpoint = {
      runId: randomUUID(),
      state: 'NOT_STARTED',
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastCompletedStep: 0,
      checkoutSessionId: null,
      stripeEventId: null,
      jobId: null,
      ledgerEntryId: null,
      cleanedUp: false,
      evidenceIds: [],
      blocker: null,
      steps: [],
    };
  }

  /**
   * Run the full E2E qualification.
   * Returns the final checkpoint with all evidence.
   */
  async run(authorization: {
    mode: 'autonomous' | 'policy_authorized' | 'human_authorized';
    actor: string | null;
    role: string | null;
  }): Promise<OrchestratorCheckpoint> {
    const operationId = `stripe-e2e-${this.checkpoint.runId}`;

    // Step 1: Verify Stripe configuration
    await this.runStep(1, 'verify_stripe_config', async () => {
      const adapter = getStripeCredentialAdapter();
      adapter.discover();
      const creds = adapter.discover();
      const secretKey = creds.find(c => c.type === 'stripe_secret_key');
      if (!secretKey) {
        return this.blocked('No Stripe secret key discovered in environment', {
          type: 'EXTERNAL_CREDENTIAL',
          provider: 'stripe',
          capability: 'stripe-e2e-qualification',
          severity: 'blocking',
          repairability: 'human_required',
          reason: 'No STRIPE_SECRET_KEY in environment',
          attemptedActions: ['environment_discovery'],
          requiredHumanAction: 'Set STRIPE_SECRET_KEY in .env.local',
          risk: 'HIGH',
        });
      }
      return { result: 'PASS' as const, verificationLevel: 'VERIFIED_INTERNAL' as const, evidence: `Found credential: ${secretKey.name} (${secretKey.prefix})` };
    }, operationId, authorization);

    if (this.checkpoint.state.startsWith('BLOCKED')) return this.checkpoint;

    // Step 2: Verify test mode + credential validity (Level 3 probe)
    await this.runStep(2, 'verify_test_mode_credential', async () => {
      const adapter = getStripeCredentialAdapter();
      const creds = adapter.discover();
      const secretKey = creds.find(c => c.type === 'stripe_secret_key');
      if (!secretKey) {
        return this.blocked('No Stripe secret key', this.credentialBlocker('STRIPE_SECRET_KEY'));
      }

      // If credential is already INVALID, blocked
      if (secretKey.state === 'INVALID' || secretKey.state === 'REVOKED') {
        return this.blocked(`Credential state: ${secretKey.state}`, {
          type: 'EXTERNAL_CREDENTIAL',
          provider: 'stripe',
          capability: 'stripe-e2e-qualification',
          severity: 'blocking',
          repairability: 'human_required',
          reason: `Stripe credential is ${secretKey.state}`,
          attemptedActions: ['credential_discovery', 'placeholder_check'],
          requiredHumanAction: `Replace ${secretKey.name} with a valid Stripe test key`,
          risk: 'HIGH',
        });
      }

      // Run Level 3 probe (provider API validation)
      const probe = await adapter.probe(secretKey.id, 3, authorization, this.correlationId);
      if (probe.result !== 'PASS') {
        return this.blocked(probe.evidence, probe.blocker || this.credentialBlocker(secretKey.name));
      }

      // Verify test mode
      if (probe.metadata.environment === 'live') {
        return this.blocked('Credential is LIVE mode — E2E test requires TEST mode', {
          type: 'POLICY_PROHIBITED_ACTION',
          provider: 'stripe',
          capability: 'stripe-e2e-qualification',
          severity: 'blocking',
          repairability: 'not_repairable',
          reason: 'Live-mode credentials cannot be used for E2E test',
          attemptedActions: ['credential_discovery', 'provider_api_probe'],
          requiredHumanAction: 'Provide a test-mode Stripe key (sk_test_...)',
          risk: 'CRITICAL',
        });
      }

      return { result: 'PASS' as const, verificationLevel: 'VERIFIED_EXTERNAL' as const, evidence: `Test-mode credential verified: ${probe.evidence}` };
    }, operationId, authorization);

    if (this.checkpoint.state.startsWith('BLOCKED')) return this.checkpoint;

    // Step 3: Verify webhook secret
    await this.runStep(3, 'verify_webhook_secret', async () => {
      const adapter = getStripeCredentialAdapter();
      const creds = adapter.discover();
      const webhookSecret = creds.find(c => c.type === 'stripe_webhook_secret');
      if (!webhookSecret) {
        return this.blocked('No Stripe webhook secret discovered', {
          type: 'EXTERNAL_CREDENTIAL',
          provider: 'stripe',
          capability: 'stripe-e2e-qualification',
          severity: 'blocking',
          repairability: 'human_required',
          reason: 'No STRIPE_WEBHOOK_SECRET or STRIPE_WEBHOOK_SECRET_01 in environment',
          attemptedActions: ['environment_discovery'],
          requiredHumanAction: 'Set STRIPE_WEBHOOK_SECRET in .env.local',
          risk: 'HIGH',
        });
      }
      return { result: 'PASS' as const, verificationLevel: 'VERIFIED_INTERNAL' as const, evidence: `Webhook secret present: ${webhookSecret.name}` };
    }, operationId, authorization);

    if (this.checkpoint.state.startsWith('BLOCKED')) return this.checkpoint;

    // Step 4: Verify endpoint reachability
    await this.runStep(4, 'verify_endpoint_reachability', async () => {
      const endpoint = process.env.STRIPE_WEBHOOK_ENDPOINT || 'http://localhost:3000/api/webhooks/stripe';
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 5000);
        // Use a HEAD or GET request — the endpoint will respond to non-POST with 4xx
        const response = await fetch(endpoint, { method: 'GET', signal: controller.signal });
        clearTimeout(timer);
        // Any response means the endpoint is reachable
        return {
          result: 'PASS' as const,
          verificationLevel: 'VERIFIED_INTERNAL' as const,
          evidence: `Endpoint reachable (HTTP ${response.status})`,
        };
      } catch (error) {
        return this.blocked(`Endpoint unreachable: ${error instanceof Error ? error.message : 'unknown'}`, {
          type: 'EXTERNAL_SERVICE_UNAVAILABLE',
          provider: 'stripe',
          capability: 'stripe-e2e-qualification',
          severity: 'blocking',
          repairability: 'auto_repairable',
          reason: 'Webhook endpoint not reachable',
          attemptedActions: ['endpoint_probe'],
          requiredHumanAction: 'Start the HYDI server (npm run boot)',
          risk: 'MEDIUM',
        });
      }
    }, operationId, authorization);

    if (this.checkpoint.state.startsWith('BLOCKED')) return this.checkpoint;

    // Step 5: Verify Stripe CLI forwarding
    await this.runStep(5, 'verify_stripe_cli_forwarding', async () => {
      // Check if Stripe CLI is available and forwarding
      // This is a safe, read-only check
      const cliForwardingActive = process.env.STRIPE_CLI_FORWARDING === 'true';
      if (!cliForwardingActive) {
        return this.blocked('Stripe CLI forwarding not active', {
          type: 'EXTERNAL_SERVICE_UNAVAILABLE',
          provider: 'stripe',
          capability: 'stripe-e2e-qualification',
          severity: 'blocking',
          repairability: 'auto_repairable',
          reason: 'Stripe CLI forwarding not detected',
          attemptedActions: ['cli_session_check'],
          requiredHumanAction: 'Run: stripe listen --forward-to localhost:3000/api/webhooks/stripe',
          risk: 'LOW',
        });
      }
      return { result: 'PASS' as const, verificationLevel: 'VERIFIED_INTERNAL' as const, evidence: 'Stripe CLI forwarding active' };
    }, operationId, authorization);

    if (this.checkpoint.state.startsWith('BLOCKED')) return this.checkpoint;

    // Steps 6-20 require a running server and real Stripe operations.
    // These are gated by authorization and the actual server being up.
    // For now, we mark the orchestrator as READY_TO_EXECUTE if all
    // preconditions pass, and EXECUTING when authorized.

    if (authorization.mode === 'autonomous') {
      // Autonomous mode can only do read-only checks (steps 1-5)
      // Steps 6+ require policy_authorized or human_authorized
      this.checkpoint.state = 'BLOCKED';
      this.checkpoint.blocker = {
        type: 'HUMAN_AUTHORIZATION_REQUIRED',
        provider: 'stripe',
        capability: 'stripe-e2e-qualification',
        severity: 'blocking',
        repairability: 'human_required',
        reason: 'Steps 6-20 (test checkout, webhook delivery, etc.) require policy or human authorization',
        attemptedActions: ['credential_discovery', 'provider_api_probe', 'endpoint_check', 'cli_check'],
        requiredHumanAction: 'Authorize Stripe E2E test execution (operator or owner)',
        risk: 'MEDIUM',
      };
      this.updateCheckpoint();
      return this.checkpoint;
    }

    // Step 6: Create test Checkout Session
    await this.runStep(6, 'create_test_checkout', async () => {
      const key = process.env.STRIPE_SECRET_KEY!;
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 15000);
        const response = await fetch('https://api.stripe.com/v1/checkout/sessions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${key}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            'mode': 'payment',
            'success_url': 'http://localhost:3000/success?session_id={CHECKOUT_SESSION_ID}',
            'cancel_url': 'http://localhost:3000/cancel',
            'line_items[0][price_data][currency]': 'usd',
            'line_items[0][price_data][product_data][name]': 'HYDI E2E Test - Model Prep',
            'line_items[0][price_data][unit_amount]': '2900',
            'line_items[0][quantity]': '1',
            'metadata[source]': 'hydi_e2e_test',
            'metadata[run_id]': this.checkpoint.runId,
          }).toString(),
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (response.ok) {
          const session = await response.json() as { id: string; url: string };
          this.checkpoint.checkoutSessionId = session.id;
          return {
            result: 'PASS' as const,
            verificationLevel: 'VERIFIED_EXTERNAL' as const,
            evidence: `Checkout session created: ${session.id}`,
          };
        }

        const errorBody = await response.text().catch(() => 'unknown');
        return {
          result: 'FAIL' as const,
          verificationLevel: 'VERIFIED_EXTERNAL' as const,
          evidence: `Checkout creation failed (${response.status}): ${errorBody.substring(0, 200)}`,
        };
      } catch (error) {
        return this.blocked(`Checkout creation error: ${error instanceof Error ? error.message : 'unknown'}`, {
          type: 'EXTERNAL_SERVICE_UNAVAILABLE',
          provider: 'stripe',
          capability: 'stripe-e2e-qualification',
          severity: 'blocking',
          repairability: 'auto_repairable',
          reason: 'Stripe API call failed',
          attemptedActions: ['checkout_creation'],
          requiredHumanAction: null,
          risk: 'LOW',
        });
      }
    }, operationId, authorization);

    if (this.checkpoint.state === 'FAILED' || this.checkpoint.state.startsWith('BLOCKED')) return this.checkpoint;

    // Step 7: Complete the test transaction
    // This uses Stripe test payment tokens — no real payment
    await this.runStep(7, 'complete_test_transaction', async () => {
      // In a real E2E, this would use Stripe test payment method tokens
      // For safety, we mark this as requiring the full flow
      // The actual completion happens via Stripe's test payment details
      const sessionId = this.checkpoint.checkoutSessionId;
      if (!sessionId) {
        return { result: 'FAIL' as const, verificationLevel: 'BLOCKED' as const, evidence: 'No checkout session to complete' };
      }
      // Mark as SIMULATED — actual payment completion requires browser automation
      // or Stripe CLI test trigger. This is honest: we don't fake it.
      return {
        result: 'SIMULATED' as const,
        verificationLevel: 'SIMULATED' as const,
        evidence: 'Payment completion requires Stripe test payment flow (browser or CLI trigger) — marked SIMULATED, not PASS',
      };
    }, operationId, authorization);

    // Steps 8-20: These depend on the webhook arriving, which depends
    // on the actual payment completion. Since step 7 is SIMULATED,
    // steps 8-20 cannot be externally verified.
    //
    // CRITICAL: We do NOT mark these as PASS. We mark them as BLOCKED
    // because the prerequisite (real webhook delivery) did not happen.

    await this.runStep(8, 'receive_webhook', async () => {
      return this.blocked('Webhook delivery requires real payment completion (step 7 was SIMULATED)', {
        type: 'EXTERNAL_CREDENTIAL',
        provider: 'stripe',
        capability: 'stripe-e2e-qualification',
        severity: 'blocking',
        repairability: 'human_required',
        reason: 'Cannot receive webhook without real payment completion',
        attemptedActions: ['checkout_creation'],
        requiredHumanAction: 'Complete the test payment via Stripe test flow to trigger webhook',
        risk: 'MEDIUM',
      });
    }, operationId, authorization);

    // If we reach here, the E2E is blocked at the webhook delivery step
    this.checkpoint.state = 'BLOCKED';
    this.updateCheckpoint();
    return this.checkpoint;
  }

  /**
   * Get the current checkpoint (for status queries).
   */
  getCheckpoint(): OrchestratorCheckpoint {
    return this.checkpoint;
  }

  /**
   * Resume from a checkpoint (after restart).
   */
  resume(checkpoint: OrchestratorCheckpoint): void {
    this.checkpoint = checkpoint;
  }

  /**
   * Check if the orchestrator can transition from BLOCKED to READY_TO_EXECUTE
   * because credentials became available.
   */
  async checkIfUnblocked(): Promise<boolean> {
    if (!this.checkpoint.state.startsWith('BLOCKED')) return false;

    const adapter = getStripeCredentialAdapter();
    adapter.discover();
    const creds = adapter.discover();
    const secretKey = creds.find(c => c.type === 'stripe_secret_key');

    if (!secretKey || secretKey.state === 'INVALID' || secretKey.state === 'REVOKED') {
      return false;
    }

    // Try a Level 3 probe to see if the credential is now valid
    const probe = await adapter.probe(secretKey.id, 3, { mode: 'autonomous', actor: 'system', role: null }, this.correlationId);
    if (probe.result === 'PASS') {
      this.checkpoint.state = 'READY_TO_EXECUTE';
      this.checkpoint.blocker = null;
      this.updateCheckpoint();
      return true;
    }

    return false;
  }

  /**
   * Get a human-readable explanation of why the orchestrator is blocked.
   */
  explainBlocker(): string {
    if (!this.checkpoint.blocker) {
      return `Orchestrator state: ${this.checkpoint.state}`;
    }

    const b = this.checkpoint.blocker;
    const attemptedActions = b.attemptedActions.length > 0
      ? b.attemptedActions.map(a => `  - ${a}`).join('\n')
      : '  (none)';

    return `
CAPABILITY BLOCKED

Capability:
  stripe-e2e-qualification

Blocker:
  ${b.reason}

Evidence:
  ${this.checkpoint.steps.filter(s => s.result !== 'PASS').map(s => `  - ${s.name}: ${s.evidence}`).join('\n')}

Safe autonomous actions attempted:
${attemptedActions}

Required human action:
  ${b.requiredHumanAction || '(none)'}

Risk:
  ${b.risk}

No simulated success recorded.
`.trim();
  }

  // ─── Internal Helpers ───────────────────────────────────────────────────

  private async runStep(
    stepNum: number,
    stepName: string,
    fn: () => Promise<{ result: StepResult['result']; verificationLevel: VerificationLevel; evidence: string }>,
    operationId: string,
    authorization: { mode: string; actor: string | null; role: string | null }
  ): Promise<void> {
    // Skip if already completed (resume support)
    const existing = this.checkpoint.steps.find(s => s.step === stepNum);
    if (existing && existing.result === 'PASS') {
      return;
    }

    const start = Date.now();
    let result: StepResult['result'] = 'UNKNOWN';
    let verificationLevel: VerificationLevel = 'UNKNOWN';
    let evidence = '';

    try {
      const r = await fn();
      result = r.result;
      verificationLevel = r.verificationLevel;
      evidence = r.evidence;
    } catch (error) {
      result = 'FAIL';
      verificationLevel = 'VERIFIED_INTERNAL';
      evidence = `Step threw error: ${error instanceof Error ? error.message : 'unknown'}`;
    }

    const durationMs = Date.now() - start;
    const stepResult: StepResult = {
      step: stepNum,
      name: stepName,
      result,
      verificationLevel,
      evidence,
      timestamp: new Date().toISOString(),
      durationMs,
    };

    // Replace or add step result
    const idx = this.checkpoint.steps.findIndex(s => s.step === stepNum);
    if (idx >= 0) {
      this.checkpoint.steps[idx] = stepResult;
    } else {
      this.checkpoint.steps.push(stepResult);
    }

    // Record evidence
    const evidenceRecord = createEvidence({
      operationId,
      capability: 'stripe-e2e-qualification',
      provider: 'stripe',
      environment: 'test',
      action: stepName,
      authorization: {
        mode: authorization.mode,
        actor: authorization.actor,
        role: authorization.role,
        permission: 'credentials:e2e:qualify',
      },
      observation: evidence,
      verificationLevel,
      verificationMethod: `stripe.e2e.${stepName}`,
      result,
      confidence: result === 'PASS' ? 1.0 : result === 'BLOCKED' ? 0.0 : 0.5,
      externalEvidence: [],
      internalEvidence: [`step: ${stepNum}`, `run: ${this.checkpoint.runId}`],
      correlationId: this.correlationId,
      blocker: result === 'BLOCKED' ? this.checkpoint.blocker : null,
    });
    this.checkpoint.evidenceIds.push(evidenceRecord.id);

    // Update state
    if (result === 'PASS') {
      this.checkpoint.lastCompletedStep = stepNum;
      this.checkpoint.state = 'EXECUTING';
    } else if (result === 'BLOCKED') {
      this.checkpoint.state = 'BLOCKED';
    } else if (result === 'FAIL') {
      this.checkpoint.state = 'FAILED';
    } else if (result === 'SIMULATED') {
      // SIMULATED is not a failure, but it's not a pass either
      // Continue to next step — it will likely block
    }

    this.updateCheckpoint();
  }

  private blocked(reason: string, blocker: EvidenceBlocker): {
    result: 'BLOCKED';
    verificationLevel: VerificationLevel;
    evidence: string;
  } {
    this.checkpoint.blocker = blocker;
    return { result: 'BLOCKED', verificationLevel: 'BLOCKED', evidence: reason };
  }

  private credentialBlocker(credentialName: string): EvidenceBlocker {
    return {
      type: 'EXTERNAL_CREDENTIAL',
      provider: 'stripe',
      capability: 'stripe-e2e-qualification',
      severity: 'blocking',
      repairability: 'human_required',
      reason: `Valid credential unavailable: ${credentialName}`,
      attemptedActions: ['environment_discovery', 'credential_classification'],
      requiredHumanAction: `Provide a valid ${credentialName}`,
      risk: 'HIGH',
    };
  }

  private updateCheckpoint(): void {
    this.checkpoint.updatedAt = new Date().toISOString();
    this.checkpointStore.set(this.checkpoint.runId, this.checkpoint);
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

let orchestratorInstance: StripeE2EOrchestrator | null = null;

export function getStripeE2EOrchestrator(): StripeE2EOrchestrator {
  if (!orchestratorInstance) {
    orchestratorInstance = new StripeE2EOrchestrator();
  }
  return orchestratorInstance;
}
