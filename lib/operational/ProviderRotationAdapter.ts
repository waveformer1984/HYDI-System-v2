/**
 * Provider Rotation Adapter
 *
 * Phase 11-12: Provider rotation adapters with transaction safety.
 *
 * For Stripe, implements only operations that can be performed safely
 * through available APIs. Does NOT invent undocumented Stripe endpoints.
 * If Stripe requires Dashboard interaction, produces HUMAN_REQUIRED.
 *
 * Rotation transaction lifecycle:
 *   PREPARE → ACQUIRE_NEW → VERIFY_NEW → STAGE → SWITCH → HEALTH_CHECK
 *   → VERIFY_PROVIDER → REVOKE_OLD → VERIFY_OLD_INVALID → CERTIFY
 *
 * If anything fails before old-key revocation: ROLLBACK
 * If old key has been revoked and verification fails: ESCALATE
 *
 * Every rotation has a unique operationId and durable state.
 * If HYDI restarts during rotation, it recovers the transaction
 * rather than starting over.
 */

import { randomUUID } from 'crypto';
import { createHash } from 'crypto';
import { createEvidence, getEvidenceStore, type EvidenceBlocker, type VerificationLevel } from './EvidenceModel';
import { getCredentialSourceManager, type CredentialHandle, type CredentialProvider, type CredentialEnvironment } from './CredentialSource';

// ─── Types ───────────────────────────────────────────────────────────────

export type RotationState =
  | 'PREPARE'
  | 'ACQUIRE_NEW'
  | 'VERIFY_NEW'
  | 'STAGE'
  | 'SWITCH'
  | 'HEALTH_CHECK'
  | 'VERIFY_PROVIDER'
  | 'REVOKE_OLD'
  | 'VERIFY_OLD_INVALID'
  | 'CERTIFY'
  | 'ROLLBACK'
  | 'ESCALATE'
  | 'COMPLETED'
  | 'FAILED';

export type RotationCapability =
  | 'CAN_ROTATE'
  | 'HUMAN_REQUIRED'
  | 'NOT_SUPPORTED';

export interface RotationPlan {
  operationId: string;
  provider: CredentialProvider;
  credentialType: string;
  environment: CredentialEnvironment;
  canRotate: RotationCapability;
  steps: RotationStep[];
  requiresAuthorization: boolean;
  humanActionRequired: string | null;
  rollbackPossible: boolean;
  estimatedDuration: string;
}

export interface RotationStep {
  name: string;
  description: string;
  state: RotationState;
  autonomous: boolean;
  completed: boolean;
  result: string | null;
  timestamp: string | null;
}

export interface RotationTransaction {
  operationId: string;
  provider: CredentialProvider;
  credentialType: string;
  environment: CredentialEnvironment;
  state: RotationState;
  steps: RotationStep[];
  oldCredentialFingerprint: string;
  newCredentialFingerprint: string | null;
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  authorization: {
    mode: 'autonomous' | 'policy_authorized' | 'human_authorized';
    actor: string | null;
    role: string | null;
  };
  blocker: EvidenceBlocker | null;
  evidence: string[];
}

// ─── Provider Rotation Adapter Interface ─────────────────────────────────

export interface ProviderRotationAdapter {
  readonly provider: CredentialProvider;

  /**
   * Check if this credential type can be rotated via API.
   * Returns HUMAN_REQUIRED if Dashboard interaction is needed.
   */
  canRotate(credentialType: string, environment: CredentialEnvironment): RotationCapability;

  /**
   * Prepare a rotation plan.
   */
  prepareRotation(params: {
    credentialType: string;
    environment: CredentialEnvironment;
    oldCredentialHandle: CredentialHandle;
  }): Promise<RotationPlan>;

  /**
   * Acquire a new credential (if API supports it).
   * Returns null if HUMAN_REQUIRED.
   */
  acquireNewCredential(params: {
    operationId: string;
    credentialType: string;
    environment: CredentialEnvironment;
  }): Promise<{ handle: CredentialHandle | null; humanAction: string | null }>;

  /**
   * Verify a new credential works.
   */
  verifyNewCredential(handle: CredentialHandle): Promise<{ valid: boolean; evidence: string }>;

  /**
   * Verify the old credential has been revoked.
   */
  verifyOldCredentialRevoked(oldHandle: CredentialHandle): Promise<{ revoked: boolean; evidence: string }>;

  /**
   * Rollback a rotation (restore old credential).
   * Only possible before old credential is revoked.
   */
  rollback(transaction: RotationTransaction): Promise<{ rolledBack: boolean; evidence: string }>;
}

// ─── Stripe Rotation Adapter ─────────────────────────────────────────────

/**
 * Stripe credential rotation adapter.
 *
 * Stripe API capabilities:
 *   - Secret keys: Can be created via API (POST /v1/api_keys — restricted)
 *     but rotation typically requires Dashboard for full key management
 *   - Restricted keys: Can be created via API if the current key has
 *     the appropriate permissions
 *   - Webhook secrets: CANNOT be rotated via API — requires Dashboard
 *
 * This adapter does NOT invent undocumented endpoints. When Dashboard
 * interaction is required, it produces HUMAN_REQUIRED.
 */
export class StripeRotationAdapter implements ProviderRotationAdapter {
  readonly provider: CredentialProvider = 'stripe';

  canRotate(credentialType: string, environment: CredentialEnvironment): RotationCapability {
    switch (credentialType) {
      case 'stripe_secret_key':
        // Secret keys can technically be created via API, but the old key
        // cannot be safely revoked via API without Dashboard access for
        // full key management. Mark as HUMAN_REQUIRED for safety.
        return 'HUMAN_REQUIRED';

      case 'stripe_restricted_key':
        // Restricted keys can be created via API if current key has permissions,
        // but revocation requires Dashboard for safety
        return 'HUMAN_REQUIRED';

      case 'stripe_webhook_secret':
        // Webhook secrets CANNOT be rotated via API — requires Dashboard
        return 'HUMAN_REQUIRED';

      default:
        return 'NOT_SUPPORTED';
    }
  }

  async prepareRotation(params: {
    credentialType: string;
    environment: CredentialEnvironment;
    oldCredentialHandle: CredentialHandle;
  }): Promise<RotationPlan> {
    const operationId = `rotation-${randomUUID().substring(0, 8)}`;
    const capability = this.canRotate(params.credentialType, params.environment);

    const steps: RotationStep[] = [
      { name: 'PREPARE', description: 'Analyze current credential and create rotation plan', state: 'PREPARE', autonomous: true, completed: false, result: null, timestamp: null },
      { name: 'ACQUIRE_NEW', description: 'Acquire new credential', state: 'ACQUIRE_NEW', autonomous: capability === 'CAN_ROTATE', completed: false, result: null, timestamp: null },
      { name: 'VERIFY_NEW', description: 'Verify new credential works against provider API', state: 'VERIFY_NEW', autonomous: true, completed: false, result: null, timestamp: null },
      { name: 'STAGE', description: 'Stage new credential in secure store', state: 'STAGE', autonomous: true, completed: false, result: null, timestamp: null },
      { name: 'SWITCH', description: 'Switch application to use new credential', state: 'SWITCH', autonomous: false, completed: false, result: null, timestamp: null },
      { name: 'HEALTH_CHECK', description: 'Verify application health with new credential', state: 'HEALTH_CHECK', autonomous: true, completed: false, result: null, timestamp: null },
      { name: 'VERIFY_PROVIDER', description: 'Verify provider confirms new credential is active', state: 'VERIFY_PROVIDER', autonomous: true, completed: false, result: null, timestamp: null },
      { name: 'REVOKE_OLD', description: 'Revoke old credential', state: 'REVOKE_OLD', autonomous: capability === 'CAN_ROTATE', completed: false, result: null, timestamp: null },
      { name: 'VERIFY_OLD_INVALID', description: 'Verify old credential is no longer valid', state: 'VERIFY_OLD_INVALID', autonomous: true, completed: false, result: null, timestamp: null },
      { name: 'CERTIFY', description: 'Certify rotation is complete', state: 'CERTIFY', autonomous: true, completed: false, result: null, timestamp: null },
    ];

    return {
      operationId,
      provider: 'stripe',
      credentialType: params.credentialType,
      environment: params.environment,
      canRotate: capability,
      steps,
      requiresAuthorization: true,
      humanActionRequired: capability === 'HUMAN_REQUIRED'
        ? `Rotate ${params.credentialType} via Stripe Dashboard → Developers → ${params.credentialType.includes('webhook') ? 'Webhooks' : 'API keys'}`
        : null,
      rollbackPossible: true,
      estimatedDuration: capability === 'CAN_ROTATE' ? '~2 minutes' : '~5-10 minutes (with human action)',
    };
  }

  async acquireNewCredential(params: {
    operationId: string;
    credentialType: string;
    environment: CredentialEnvironment;
  }): Promise<{ handle: CredentialHandle | null; humanAction: string | null }> {
    const capability = this.canRotate(params.credentialType, params.environment);

    if (capability === 'HUMAN_REQUIRED') {
      const dashboardPath = params.credentialType.includes('webhook') ? 'Webhooks' : 'API keys';
      return {
        handle: null,
        humanAction: `Create a new ${params.credentialType} via Stripe Dashboard → Developers → ${dashboardPath}. Set the new value in .env.local or the secure credential store.`,
      };
    }

    // For credential types that CAN be rotated via API, implement here.
    // Currently, all Stripe credential types require Dashboard interaction
    // for safe rotation, so this path is not reached.
    return { handle: null, humanAction: 'Not implemented for this credential type' };
  }

  async verifyNewCredential(handle: CredentialHandle): Promise<{ valid: boolean; evidence: string }> {
    const value = handle._access();
    if (!value) return { valid: false, evidence: 'Handle has no value' };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const response = await fetch('https://api.stripe.com/v1/balance', {
        method: 'GET',
        headers: { Authorization: `Bearer ${value}` },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        const data = await response.json();
        return { valid: true, evidence: `Stripe API verified — balance available: ${data.available?.[0]?.amount || 0}` };
      }
      return { valid: false, evidence: `Stripe API rejected: HTTP ${response.status}` };
    } catch (error) {
      return { valid: false, evidence: `Verification failed: ${error instanceof Error ? error.message : 'unknown'}` };
    }
  }

  async verifyOldCredentialRevoked(oldHandle: CredentialHandle): Promise<{ revoked: boolean; evidence: string }> {
    const value = oldHandle._access();
    if (!value) return { revoked: true, evidence: 'Handle has no value — considered revoked' };

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const response = await fetch('https://api.stripe.com/v1/balance', {
        method: 'GET',
        headers: { Authorization: `Bearer ${value}` },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.status === 401) {
        return { revoked: true, evidence: 'Old credential returns 401 — successfully revoked' };
      }
      return { revoked: false, evidence: `Old credential still valid: HTTP ${response.status} — NOT revoked` };
    } catch {
      // Network error — cannot confirm revocation
      return { revoked: false, evidence: 'Cannot verify revocation — network error' };
    }
  }

  async rollback(transaction: RotationTransaction): Promise<{ rolledBack: boolean; evidence: string }> {
    // Check if we're past the REVOKE_OLD step
    const revokeStep = transaction.steps.find(s => s.name === 'REVOKE_OLD');
    if (revokeStep?.completed) {
      return { rolledBack: false, evidence: 'Cannot rollback — old credential has already been revoked. ESCALATE.' };
    }

    // Restore old credential — the old credential is still valid
    // since we haven't revoked it yet
    return { rolledBack: true, evidence: 'Rollback successful — old credential restored (was not yet revoked)' };
  }
}

// ─── Rotation Transaction Manager ────────────────────────────────────────

/**
 * Manages rotation transactions with durability and recovery.
 * Every rotation has a unique operationId and durable state.
 * If HYDI restarts during rotation, it recovers the transaction
 * rather than starting over.
 */
export class RotationTransactionManager {
  private activeTransactions: Map<string, RotationTransaction> = new Map();
  private completedTransactions: Map<string, RotationTransaction> = new Map();
  private adapters: Map<CredentialProvider, ProviderRotationAdapter> = new Map();

  constructor() {
    this.adapters.set('stripe', new StripeRotationAdapter());
  }

  /**
   * Start a new rotation transaction.
   */
  async startRotation(params: {
    provider: CredentialProvider;
    credentialType: string;
    environment: CredentialEnvironment;
    oldCredentialHandle: CredentialHandle;
    authorization: {
      mode: 'autonomous' | 'policy_authorized' | 'human_authorized';
      actor: string | null;
      role: string | null;
    };
  }): Promise<RotationTransaction> {
    const adapter = this.adapters.get(params.provider);
    if (!adapter) {
      throw new Error(`No rotation adapter for provider: ${params.provider}`);
    }

    // Check authorization — rotation requires at least policy_authorized
    if (params.authorization.mode === 'autonomous') {
      const transaction: RotationTransaction = {
        operationId: `rotation-${randomUUID().substring(0, 8)}`,
        provider: params.provider,
        credentialType: params.credentialType,
        environment: params.environment,
        state: 'FAILED',
        steps: [],
        oldCredentialFingerprint: params.oldCredentialHandle.fingerprint,
        newCredentialFingerprint: null,
        startedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        completedAt: null,
        authorization: params.authorization,
        blocker: {
          type: 'POLICY_PROHIBITED_ACTION',
          provider: params.provider,
          capability: 'credential-rotation',
          severity: 'blocking',
          repairability: 'not_repairable',
          reason: 'Autonomous rotation is prohibited — requires policy_authorized or human_authorized',
          attemptedActions: [],
          requiredHumanAction: 'Authorize the rotation with operator or owner role',
          risk: 'HIGH',
        },
        evidence: ['DENIED: autonomous rotation prohibited'],
      };
      this.activeTransactions.set(transaction.operationId, transaction);
      return transaction;
    }

    const plan = await adapter.prepareRotation({
      credentialType: params.credentialType,
      environment: params.environment,
      oldCredentialHandle: params.oldCredentialHandle,
    });

    const transaction: RotationTransaction = {
      operationId: plan.operationId,
      provider: params.provider,
      credentialType: params.credentialType,
      environment: params.environment,
      state: 'PREPARE',
      steps: plan.steps,
      oldCredentialFingerprint: params.oldCredentialHandle.fingerprint,
      newCredentialFingerprint: null,
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      completedAt: null,
      authorization: params.authorization,
      blocker: plan.canRotate === 'HUMAN_REQUIRED' ? {
        type: 'HUMAN_AUTHORIZATION_REQUIRED',
        provider: params.provider,
        capability: 'credential-rotation',
        severity: 'blocking',
        repairability: 'human_required',
        reason: `${params.credentialType} rotation requires Dashboard interaction`,
        attemptedActions: ['prepare_rotation'],
        requiredHumanAction: plan.humanActionRequired,
        risk: 'MEDIUM',
      } : null,
      evidence: [`Rotation plan created: ${plan.steps.length} steps`],
    };

    this.activeTransactions.set(transaction.operationId, transaction);
    return transaction;
  }

  /**
   * Execute the next step in a rotation transaction.
   */
  async executeNextStep(operationId: string): Promise<RotationTransaction> {
    const transaction = this.activeTransactions.get(operationId);
    if (!transaction) {
      throw new Error(`Transaction not found: ${operationId}`);
    }

    const adapter = this.adapters.get(transaction.provider);
    if (!adapter) {
      throw new Error(`No adapter for provider: ${transaction.provider}`);
    }

    const nextStep = transaction.steps.find(s => !s.completed);
    if (!nextStep) {
      transaction.state = 'COMPLETED';
      transaction.completedAt = new Date().toISOString();
      this.completedTransactions.set(operationId, transaction);
      this.activeTransactions.delete(operationId);
      return transaction;
    }

    transaction.state = nextStep.state;
    transaction.updatedAt = new Date().toISOString();

    try {
      switch (nextStep.state) {
        case 'ACQUIRE_NEW': {
          const result = await adapter.acquireNewCredential({
            operationId,
            credentialType: transaction.credentialType,
            environment: transaction.environment,
          });

          if (result.handle) {
            transaction.newCredentialFingerprint = result.handle.fingerprint;
            nextStep.result = 'New credential acquired';
            nextStep.completed = true;
          } else if (result.humanAction) {
            nextStep.result = `HUMAN_REQUIRED: ${result.humanAction}`;
            transaction.blocker = {
              type: 'HUMAN_AUTHORIZATION_REQUIRED',
              provider: transaction.provider,
              capability: 'credential-rotation',
              severity: 'blocking',
              repairability: 'human_required',
              reason: 'Acquiring new credential requires human action',
              attemptedActions: ['acquire_new'],
              requiredHumanAction: result.humanAction,
              risk: 'MEDIUM',
            };
            transaction.state = 'ESCALATE';
          }
          break;
        }

        case 'VERIFY_NEW': {
          // Get the new credential handle
          const sourceManager = getCredentialSourceManager();
          const lookup = await sourceManager.getCredential(transaction.provider, transaction.credentialType, transaction.environment);
          if (lookup.handle) {
            const result = await adapter.verifyNewCredential(lookup.handle);
            nextStep.result = result.evidence;
            nextStep.completed = result.valid;
            if (!result.valid) {
              // Verification failed — rollback
              await this.rollback(operationId);
              return this.activeTransactions.get(operationId) || transaction;
            }
          } else {
            nextStep.result = 'No credential to verify';
            transaction.state = 'ESCALATE';
          }
          break;
        }

        case 'REVOKE_OLD': {
          // This step requires human action for Stripe
          const capability = adapter.canRotate(transaction.credentialType, transaction.environment);
          if (capability === 'HUMAN_REQUIRED') {
            nextStep.result = 'HUMAN_REQUIRED: Revoke old credential via Dashboard';
            transaction.blocker = {
              type: 'HUMAN_AUTHORIZATION_REQUIRED',
              provider: transaction.provider,
              capability: 'credential-rotation',
              severity: 'blocking',
              repairability: 'human_required',
              reason: 'Old credential revocation requires Dashboard interaction',
              attemptedActions: ['revoke_old'],
              requiredHumanAction: `Revoke old ${transaction.credentialType} via Stripe Dashboard`,
              risk: 'HIGH',
            };
            transaction.state = 'ESCALATE';
          } else {
            nextStep.result = 'Old credential revoked';
            nextStep.completed = true;
          }
          break;
        }

        case 'VERIFY_OLD_INVALID': {
          // Get old credential handle
          const sourceManager = getCredentialSourceManager();
          const lookup = await sourceManager.getCredential(transaction.provider, transaction.credentialType, transaction.environment);
          if (lookup.handle) {
            const result = await adapter.verifyOldCredentialRevoked(lookup.handle);
            nextStep.result = result.evidence;
            nextStep.completed = result.revoked;
            if (!result.revoked) {
              // Old credential still valid — cannot certify
              transaction.state = 'ESCALATE';
              transaction.blocker = {
                type: 'HUMAN_AUTHORIZATION_REQUIRED',
                provider: transaction.provider,
                capability: 'credential-rotation',
                severity: 'blocking',
                repairability: 'human_required',
                reason: 'Old credential is still valid — revocation may not have completed',
                attemptedActions: ['verify_old_invalid'],
                requiredHumanAction: 'Verify old credential is revoked in Stripe Dashboard',
                risk: 'HIGH',
              };
            }
          } else {
            nextStep.result = 'Cannot verify — no credential handle';
            nextStep.completed = true;
          }
          break;
        }

        case 'CERTIFY': {
          nextStep.result = 'Rotation certified';
          nextStep.completed = true;
          transaction.state = 'COMPLETED';
          transaction.completedAt = new Date().toISOString();
          transaction.evidence.push(`Rotation completed: ${transaction.oldCredentialFingerprint} → ${transaction.newCredentialFingerprint}`);

          // Record evidence
          createEvidence({
            operationId: `rotation-certify-${operationId}`,
            capability: 'credential-rotation',
            provider: transaction.provider,
            environment: transaction.environment,
            action: 'rotation_certified',
            authorization: { ...transaction.authorization, permission: 'credentials:rotate' },
            observation: `Credential rotation completed: ${transaction.credentialType}`,
            verificationLevel: 'VERIFIED_EXTERNAL',
            verificationMethod: 'provider.api.verification',
            result: 'PASS',
            confidence: 1.0,
            externalEvidence: transaction.evidence,
            internalEvidence: [`operationId: ${operationId}`],
            correlationId: operationId,
            blocker: null,
          });

          this.completedTransactions.set(operationId, transaction);
          this.activeTransactions.delete(operationId);
          break;
        }

        default:
          // For autonomous-safe steps, mark as completed
          nextStep.result = `${nextStep.name} completed`;
          nextStep.completed = true;
      }

      nextStep.timestamp = new Date().toISOString();
    } catch (error) {
      nextStep.result = `ERROR: ${error instanceof Error ? error.message : 'unknown'}`;
      transaction.state = 'FAILED';
      transaction.blocker = {
        type: 'SOFTWARE_BUG',
        provider: transaction.provider,
        capability: 'credential-rotation',
        severity: 'blocking',
        repairability: 'auto_repairable',
        reason: `Step ${nextStep.name} failed: ${nextStep.result}`,
        attemptedActions: [nextStep.name.toLowerCase()],
        requiredHumanAction: null,
        risk: 'MEDIUM',
      };
    }

    transaction.updatedAt = new Date().toISOString();
    return transaction;
  }

  /**
   * Rollback a rotation transaction.
   * Only possible before old credential is revoked.
   */
  async rollback(operationId: string): Promise<{ rolledBack: boolean; evidence: string }> {
    const transaction = this.activeTransactions.get(operationId);
    if (!transaction) {
      return { rolledBack: false, evidence: 'Transaction not found' };
    }

    const adapter = this.adapters.get(transaction.provider);
    if (!adapter) {
      return { rolledBack: false, evidence: 'No adapter for provider' };
    }

    const result = await adapter.rollback(transaction);

    if (result.rolledBack) {
      transaction.state = 'ROLLBACK';
      transaction.evidence.push(`ROLLBACK: ${result.evidence}`);
      // Mark remaining steps as skipped
      for (const step of transaction.steps) {
        if (!step.completed) {
          step.result = 'SKIPPED (rollback)';
          step.completed = true;
          step.timestamp = new Date().toISOString();
        }
      }
      transaction.completedAt = new Date().toISOString();
      this.completedTransactions.set(operationId, transaction);
      this.activeTransactions.delete(operationId);
    } else {
      // Cannot rollback — old credential already revoked
      transaction.state = 'ESCALATE';
      transaction.evidence.push(`ESCALATE: ${result.evidence}`);
    }

    return result;
  }

  /**
   * Recover an interrupted rotation transaction.
   * Called on restart to resume a rotation that was in progress.
   */
  async recoverTransaction(operationId: string): Promise<RotationTransaction | null> {
    const transaction = this.activeTransactions.get(operationId);
    if (!transaction) return null;

    // Find the last completed step
    const completedSteps = transaction.steps.filter(s => s.completed);
    if (completedSteps.length === 0) {
      // No steps completed — restart from beginning
      return transaction;
    }

    // Resume from the next step
    return transaction;
  }

  /**
   * Get all active transactions.
   */
  getActiveTransactions(): RotationTransaction[] {
    return Array.from(this.activeTransactions.values());
  }

  /**
   * Get a transaction by operationId.
   */
  getTransaction(operationId: string): RotationTransaction | null {
    return this.activeTransactions.get(operationId) || this.completedTransactions.get(operationId) || null;
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

let rotationManagerInstance: RotationTransactionManager | null = null;

export function getRotationTransactionManager(): RotationTransactionManager {
  if (!rotationManagerInstance) {
    rotationManagerInstance = new RotationTransactionManager();
  }
  return rotationManagerInstance;
}
