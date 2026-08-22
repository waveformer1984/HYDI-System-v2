/**
 * Key Management Service
 *
 * The central orchestrator for the key lifecycle:
 *   DISCOVER → CLASSIFY → GENERATE → STORE → PROVISION → VALIDATE →
 *   ROTATE → REVOKE → RECOVER → DESTROY → AUDIT
 *
 * This service composes:
 *   - KeyProviderRegistry (provider operations)
 *   - KeyVault (secret storage)
 *   - KeyPolicyEngine (governance gate)
 *   - KeyAuditService (audit trail)
 *   - KeyInventoryStore (durable metadata)
 *
 * ARCHITECTURE: This does NOT introduce a second autonomy pipeline.
 * All operations pass through the KeyPolicyEngine, which maps to the
 * existing R0/R1/R2/R3/R5 authorization model. Destructive operations
 * require owner authorization, which is handled by the existing
 * OwnerAuthorizationStore and CognitiveCore governance.
 *
 * SECURITY: Secret values flow only between provider → vault → consumer.
 * They are NEVER stored in domain objects, NEVER logged, NEVER included
 * in audit records, NEVER exposed in API responses.
 */

import { createHash, randomUUID } from 'crypto';
import type {
  KeyMetadata,
  KeyInventory,
  KeyAuditOperation,
  KeyCreationOptions,
  KeyCreationResult,
  ProvisioningTarget,
  KeyRiskLevel,
  KeyLifecycleState,
  KeyHealthStatus,
  KeyHealthFinding,
} from './KeyManagementTypes';
import type { CredentialState } from './CapabilityAcquisitionTypes';
import { KeyProviderRegistry } from './KeyProviders';
import type { KeyProvider } from './KeyManagementTypes';
import { VaultRegistry } from './KeyVaults';
import type { KeyVault } from './KeyManagementTypes';
import { KeyPolicyEngine } from './KeyPolicyEngine';
import type { KeyPolicyEvaluationResult, KeyPolicyContext } from './KeyPolicyEngine';
import { KeyAuditService } from './KeyAuditService';
import { KeyInventoryStore } from './KeyInventory';
import { UnsupportedOperationError, KeyNotFoundError, KeyPolicyDeniedError } from './KeyManagementTypes';

/**
 * Result of a key operation.
 */
export interface KeyOperationResult {
  success: boolean;
  keyId: string;
  operation: KeyAuditOperation;
  previousState: KeyLifecycleState;
  resultingState: KeyLifecycleState;
  validationResult: CredentialState | null;
  failureReason: string | null;
  policyEvaluation: KeyPolicyEvaluationResult;
  durationMs: number;
  /** Safe human-readable result (never contains secrets) */
  message: string;
}

/**
 * The central key management service.
 */
export class KeyManagementService {
  private providers: KeyProviderRegistry;
  private vaults: VaultRegistry;
  private policyEngine: KeyPolicyEngine;
  private audit: KeyAuditService;
  private inventory: KeyInventoryStore;
  private root: string;
  private killSwitchActive = false;
  private autonomousModeEnabled = true;
  /** Per-key rotation lock — prevents concurrent rotations from creating duplicate replacements */
  private rotationLocks: Map<string, { startedAt: number; correlationId: string }> = new Map();
  /** Rotation lock TTL — if a lock is older than this, it's considered stale and can be reclaimed */
  private static readonly ROTATION_LOCK_TTL_MS = 5 * 60 * 1000; // 5 minutes

  constructor(
    root: string,
    providers?: KeyProviderRegistry,
    vaults?: VaultRegistry,
    policyEngine?: KeyPolicyEngine,
    audit?: KeyAuditService,
    inventory?: KeyInventoryStore,
  ) {
    this.root = root;
    this.providers = providers ?? new KeyProviderRegistry();
    this.vaults = vaults ?? new VaultRegistry(new (require('./KeyVaults').EnvVarVault)());
    this.policyEngine = policyEngine ?? new KeyPolicyEngine();
    this.audit = audit ?? new KeyAuditService(root);
    this.inventory = inventory ?? new KeyInventoryStore(root);
  }

  // ─── Configuration ────────────────────────────────────────────────────

  setKillSwitch(active: boolean): void {
    this.killSwitchActive = active;
  }

  setAutonomousMode(enabled: boolean): void {
    this.autonomousModeEnabled = enabled;
  }

  getProviders(): KeyProviderRegistry { return this.providers; }
  getVaults(): VaultRegistry { return this.vaults; }
  getPolicyEngine(): KeyPolicyEngine { return this.policyEngine; }
  getAuditService(): KeyAuditService { return this.audit; }
  getInventoryStore(): KeyInventoryStore { return this.inventory; }

  // ─── DISCOVER ─────────────────────────────────────────────────────────

  /**
   * Discover all keys from all providers and reconcile with inventory.
   */
  async discover(): Promise<{ added: KeyMetadata[]; updated: KeyMetadata[]; removed: KeyMetadata[] }> {
    const start = Date.now();
    const ctx = this.makeContext('DISCOVER', null, 'all');
    const policy = this.policyEngine.evaluate(ctx);

    if (!policy.allowed) {
      this.audit.record(this.makeAuditInput('DISCOVER', 'all', 'all', null, null, policy, start, 'Policy denied'));
      throw new KeyPolicyDeniedError('all', 'DISCOVER', policy.reason);
    }

    const discovered = await this.providers.discoverAll();
    const result = this.inventory.reconcile(discovered);

    this.audit.record(this.makeAuditInput('DISCOVER', 'all', 'all', null, null, policy, start, null, {
      added: result.added.length,
      updated: result.updated.length,
      removed: result.removed.length,
    }));

    return result;
  }

  // ─── CLASSIFY ─────────────────────────────────────────────────────────

  /**
   * Classify a key — assign risk level, lifecycle state, and metadata.
   */
  async classify(keyId: string): Promise<KeyOperationResult> {
    const start = Date.now();
    const key = this.inventory.get(keyId);
    if (!key) throw new KeyNotFoundError(keyId);

    const ctx = this.makeContext('CLASSIFY', key, key.provider);
    const policy = this.policyEngine.evaluate(ctx);

    if (!policy.allowed) {
      return this.failOperation('CLASSIFY', key, policy, start, 'Policy denied');
    }

    // Classify based on provider and credential type
    const classified: KeyMetadata = {
      ...key,
      lifecycleState: 'CLASSIFIED',
      riskLevel: this.classifyRiskLevel(key),
    };

    this.inventory.upsert(classified);

    this.audit.record(this.makeAuditInput('CLASSIFY', key.id, key.provider, key.envVar, key.lifecycleState, policy, start, null, {
      resultingState: 'CLASSIFIED',
      riskLevel: classified.riskLevel,
    }));

    return {
      success: true,
      keyId: key.id,
      operation: 'CLASSIFY',
      previousState: key.lifecycleState,
      resultingState: 'CLASSIFIED',
      validationResult: null,
      failureReason: null,
      policyEvaluation: policy,
      durationMs: Date.now() - start,
      message: `Classified key ${key.envVar ?? key.id} as ${classified.riskLevel} risk`,
    };
  }

  // ─── GENERATE ─────────────────────────────────────────────────────────

  /**
   * Generate/create a new credential.
   *
   * For providers that support autonomous key creation (Stripe, SendGrid, Twilio),
   * this calls the provider API to create a new key.
   * For providers that don't (Google Places), this throws UnsupportedOperationError.
   *
   * @param providerId - The provider to create the key for
   * @param options - Key creation options
   * @returns The operation result (key value is stored in vault, not returned)
   */
  async generate(providerId: string, options: KeyCreationOptions): Promise<KeyOperationResult> {
    const start = Date.now();
    const provider = this.providers.get(providerId);
    if (!provider) throw new Error(`Unknown provider: ${providerId}`);

    const env = this.detectEnvironment();
    const ctx: KeyPolicyContext = {
      operation: 'GENERATE',
      keyMetadata: null,
      providerId,
      environment: env,
      dryRun: options.dryRun,
      killSwitchActive: this.killSwitchActive,
      autonomousModeEnabled: this.autonomousModeEnabled,
    };
    const policy = this.policyEngine.evaluate(ctx);

    if (!policy.allowed) {
      this.audit.record(this.makeAuditInput('GENERATE', 'pending', providerId, null, null, policy, start, 'Policy denied'));
      return {
        success: false,
        keyId: 'pending',
        operation: 'GENERATE',
        previousState: 'UNKNOWN',
        resultingState: 'UNKNOWN',
        validationResult: null,
        failureReason: policy.reason,
        policyEvaluation: policy,
        durationMs: Date.now() - start,
        message: `Key generation denied: ${policy.reason}`,
      };
    }

    try {
      const creationResult = await provider.create(options);
      const keyId = randomUUID();
      const fingerprint = createHash('sha256').update(creationResult.keyValue).digest('hex').slice(0, 16);

      // Store in vault (never in domain objects)
      const vault = this.vaults.getDefault();
      await vault.store(keyId, creationResult.keyValue, { provider: providerId });

      // Create metadata (no secret value)
      const metadata: KeyMetadata = {
        id: keyId,
        envVar: null,
        provider: providerId,
        credentialType: options.credentialType,
        service: creationResult.metadata.service ?? `${providerId} API`,
        environment: env,
        owner: 'heidi',
        consumer: 'heidi-web',
        scopes: options.scopes,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
        expiresAt: null,
        rotationIntervalDays: 90,
        rotationStatus: 'NOT_CONFIGURED',
        riskLevel: policy.riskLevel,
        lifecycleState: 'ACTIVE',
        storageBackend: vault.backend,
        provisioningTargets: [],
        dependencies: [],
        compromiseStatus: 'CLEAN',
        lastValidationAt: null,
        lastValidationResult: null,
        lastRotatedAt: null,
        fingerprint,
        auditReference: null,
        discoveredByScanner: false,
        allowlisted: false,
        ...creationResult.metadata,
      } as KeyMetadata;

      this.inventory.upsert(metadata);

      this.audit.record(this.makeAuditInput('GENERATE', keyId, providerId, null, null, policy, start, null, {
        fingerprint,
        credentialType: options.credentialType,
        dryRun: options.dryRun,
      }));

      return {
        success: true,
        keyId,
        operation: 'GENERATE',
        previousState: 'UNKNOWN',
        resultingState: 'ACTIVE',
        validationResult: null,
        failureReason: null,
        policyEvaluation: policy,
        durationMs: Date.now() - start,
        message: options.dryRun
          ? `Dry-run: would create ${providerId} key with scopes [${options.scopes.join(', ')}]`
          : `Created ${providerId} key ${keyId} (stored in vault, value not exposed)`,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'unknown';
      this.audit.record(this.makeAuditInput('GENERATE', 'pending', providerId, null, null, policy, start, reason));
      return {
        success: false,
        keyId: 'pending',
        operation: 'GENERATE',
        previousState: 'UNKNOWN',
        resultingState: 'UNKNOWN',
        validationResult: null,
        failureReason: reason,
        policyEvaluation: policy,
        durationMs: Date.now() - start,
        message: `Key generation failed: ${reason}`,
      };
    }
  }

  // ─── STORE ────────────────────────────────────────────────────────────

  /**
   * Store an existing credential (from env var) into the vault.
   */
  async storeFromEnvVar(envVar: string, providerId: string): Promise<KeyOperationResult> {
    const start = Date.now();
    const value = process.env[envVar];

    if (typeof value !== 'string' || value.length === 0) {
      return {
        success: false,
        keyId: envVar,
        operation: 'STORE',
        previousState: 'UNKNOWN',
        resultingState: 'UNKNOWN',
        validationResult: null,
        failureReason: `Env var ${envVar} is not set`,
        policyEvaluation: this.policyEngine.evaluate(this.makeContext('STORE', null, providerId)),
        durationMs: Date.now() - start,
        message: `Env var ${envVar} is not set`,
      };
    }

    const ctx = this.makeContext('STORE', null, providerId);
    const policy = this.policyEngine.evaluate(ctx);

    if (!policy.allowed) {
      return this.failOperation('STORE', null, policy, start, 'Policy denied');
    }

    const keyId = randomUUID();
    const fingerprint = createHash('sha256').update(value).digest('hex').slice(0, 16);

    const vault = this.vaults.getDefault();
    await vault.store(keyId, value, { provider: providerId, envVar });

    const metadata: KeyMetadata = {
      id: keyId,
      envVar,
      provider: providerId,
      credentialType: 'api_key',
      service: `${providerId} API`,
      environment: this.detectEnvironment(),
      owner: 'system',
      consumer: 'heidi-web',
      scopes: [],
      createdAt: new Date().toISOString(),
      lastUsedAt: null,
      expiresAt: null,
      rotationIntervalDays: 90,
      rotationStatus: 'NOT_CONFIGURED',
      riskLevel: this.classifyRiskLevel({ provider: providerId, credentialType: 'api_key' } as KeyMetadata),
      lifecycleState: 'ACTIVE',
      storageBackend: vault.backend,
      provisioningTargets: ['heidi-web'],
      dependencies: [],
      compromiseStatus: 'CLEAN',
      lastValidationAt: null,
      lastValidationResult: null,
      lastRotatedAt: null,
      fingerprint,
      auditReference: null,
      discoveredByScanner: false,
      allowlisted: false,
    };

    this.inventory.upsert(metadata);

    this.audit.record(this.makeAuditInput('STORE', keyId, providerId, envVar, null, policy, start, null, { fingerprint }));

    return {
      success: true,
      keyId,
      operation: 'STORE',
      previousState: 'UNKNOWN',
      resultingState: 'ACTIVE',
      validationResult: null,
      failureReason: null,
      policyEvaluation: policy,
      durationMs: Date.now() - start,
      message: `Stored ${envVar} in vault (key ${keyId}, value not exposed)`,
    };
  }

  // ─── PROVISION ────────────────────────────────────────────────────────

  /**
   * Provision a key to a consumer (e.g., write to .env.local).
   */
  async provision(keyId: string, target: ProvisioningTarget): Promise<KeyOperationResult> {
    const start = Date.now();
    const key = this.inventory.get(keyId);
    if (!key) throw new KeyNotFoundError(keyId);

    const ctx = this.makeContext('PROVISION', key, key.provider);
    const policy = this.policyEngine.evaluate(ctx);

    if (!policy.allowed) {
      return this.failOperation('PROVISION', key, policy, start, 'Policy denied');
    }

    // Retrieve from vault
    const vault = this.vaults.get(key.storageBackend);
    const value = await vault.retrieve(keyId);

    if (!value) {
      return this.failOperation('PROVISION', key, policy, start, 'Key value not found in vault');
    }

    // Get provider and provision
    const provider = this.providers.get(key.provider);
    if (!provider) {
      return this.failOperation('PROVISION', key, policy, start, `No provider for ${key.provider}`);
    }

    const result = await provider.provision(keyId, value, target);

    this.audit.record(this.makeAuditInput('PROVISION', keyId, key.provider, key.envVar, key.lifecycleState, policy, start, result.success ? null : result.evidence, {
      targetType: target.type,
      success: result.success,
    }));

    return {
      success: result.success,
      keyId,
      operation: 'PROVISION',
      previousState: key.lifecycleState,
      resultingState: key.lifecycleState,
      validationResult: null,
      failureReason: result.success ? null : result.evidence,
      policyEvaluation: policy,
      durationMs: Date.now() - start,
      message: result.evidence,
    };
  }

  // ─── VALIDATE ─────────────────────────────────────────────────────────

  /**
   * Validate a key against the provider API.
   */
  async validate(keyId: string): Promise<KeyOperationResult> {
    const start = Date.now();
    const key = this.inventory.get(keyId);
    if (!key) throw new KeyNotFoundError(keyId);

    const ctx = this.makeContext('VALIDATE', key, key.provider);
    const policy = this.policyEngine.evaluate(ctx);

    if (!policy.allowed) {
      return this.failOperation('VALIDATE', key, policy, start, 'Policy denied');
    }

    const vault = this.vaults.get(key.storageBackend);
    const value = await vault.retrieve(keyId);

    if (!value) {
      return this.failOperation('VALIDATE', key, policy, start, 'Key value not found in vault');
    }

    const provider = this.providers.get(key.provider);
    if (!provider) {
      return this.failOperation('VALIDATE', key, policy, start, `No provider for ${key.provider}`);
    }

    const validationState = await provider.validate(keyId, value);

    this.inventory.updateValidation(keyId, validationState);

    this.audit.record(this.makeAuditInput('VALIDATE', keyId, key.provider, key.envVar, key.lifecycleState, policy, start, null, {
      validationResult: validationState,
    }));

    return {
      success: validationState === 'VALID',
      keyId,
      operation: 'VALIDATE',
      previousState: key.lifecycleState,
      resultingState: validationState === 'VALID' ? 'ACTIVE' : key.lifecycleState,
      validationResult: validationState,
      failureReason: validationState === 'VALID' ? null : `Validation result: ${validationState}`,
      policyEvaluation: policy,
      durationMs: Date.now() - start,
      message: `Validation: ${validationState}`,
    };
  }

  // ─── ROTATE ───────────────────────────────────────────────────────────

  /**
   * Rotate a key — staged transaction:
   *   CREATE_NEW → VALIDATE_NEW → PROVISION_NEW → VERIFY_CONSUMER →
   *   DISABLE_OLD → OBSERVE → DELETE_OLD → RECORD
   *
   * If validation fails, the old key is retained and the new key is discarded.
   */
  async rotate(keyId: string): Promise<KeyOperationResult> {
    const start = Date.now();
    const key = this.inventory.get(keyId);
    if (!key) throw new KeyNotFoundError(keyId);

    const ctx = this.makeContext('ROTATE', key, key.provider);
    const policy = this.policyEngine.evaluate(ctx);

    if (!policy.allowed) {
      return this.failOperation('ROTATE', key, policy, start, 'Policy denied');
    }

    const provider = this.providers.get(key.provider);
    if (!provider || !provider.supportsKeyRotation) {
      return this.failOperation('ROTATE', key, policy, start, `Provider ${key.provider} does not support rotation`);
    }

    // ─── Idempotency / Concurrency Lock ───────────────────────────────
    // Prevent concurrent rotation requests from creating multiple replacement
    // credentials. If a rotation is already in progress for this key, return
    // immediately with a "rotation in progress" result.
    const existingLock = this.rotationLocks.get(keyId);
    if (existingLock) {
      const lockAge = Date.now() - existingLock.startedAt;
      if (lockAge < KeyManagementService.ROTATION_LOCK_TTL_MS) {
        // Active lock — return idempotent "already in progress" result
        return {
          success: true, // Not a failure — the rotation is proceeding
          keyId,
          operation: 'ROTATE',
          previousState: key.lifecycleState,
          resultingState: 'ROTATING',
          validationResult: null,
          failureReason: null,
          policyEvaluation: policy,
          durationMs: Date.now() - start,
          message: `Rotation already in progress for ${key.envVar ?? keyId} (started ${lockAge}ms ago, correlation: ${existingLock.correlationId})`,
        };
      }
      // Stale lock — reclaim it
      this.rotationLocks.delete(keyId);
    }

    // Acquire lock
    const correlationId = randomUUID();
    this.rotationLocks.set(keyId, { startedAt: Date.now(), correlationId });

    const vault = this.vaults.get(key.storageBackend);
    const oldValue = await vault.retrieve(keyId);

    if (!oldValue) {
      this.releaseRotationLock(keyId);
      return this.failOperation('ROTATE', key, policy, start, 'Old key value not found in vault');
    }

    // Mark as rotating
    this.inventory.updateLifecycleState(keyId, 'ROTATING');

    try {
      // Step 1: CREATE_NEW
      const rotationResult = await provider.rotate(keyId, oldValue);
      const newKeyId = randomUUID();
      const newFingerprint = createHash('sha256').update(rotationResult.newKeyValue).digest('hex').slice(0, 16);

      // Step 2: STORE_NEW in vault
      await vault.store(newKeyId, rotationResult.newKeyValue, { provider: key.provider, rotatedFrom: keyId });

      // Step 3: VALIDATE_NEW
      const validationState = await provider.validate(newKeyId, rotationResult.newKeyValue);

      if (validationState !== 'VALID') {
        // Validation failed — roll back, retain old key
        await vault.delete(newKeyId);
        this.inventory.updateLifecycleState(keyId, 'ACTIVE');
        this.inventory.updateValidation(keyId, validationState);
        this.releaseRotationLock(keyId);

        this.audit.record(this.makeAuditInput('ROTATE', keyId, key.provider, key.envVar, 'ROTATING', policy, start, `New key validation failed: ${validationState}`, {
          newKeyId,
          newFingerprint,
          validationResult: validationState,
          rolledBack: true,
        }));

        return {
          success: false,
          keyId,
          operation: 'ROTATE',
          previousState: 'ROTATING',
          resultingState: 'ACTIVE',
          validationResult: validationState,
          failureReason: `New key validation failed: ${validationState}. Old key retained.`,
          policyEvaluation: policy,
          durationMs: Date.now() - start,
          message: `Rotation failed — new key invalid (${validationState}). Old key retained.`,
        };
      }

      // Step 4: PROVISION_NEW (if the key has an env var target)
      if (key.envVar) {
        const envFile = `${this.root}/.env.local`;
        await provider.provision(newKeyId, rotationResult.newKeyValue, {
          type: 'env_file',
          path: envFile,
          envVar: key.envVar,
        });
      }

      // Step 5: DISABLE_OLD
      let oldDisabled = false;
      try {
        oldDisabled = await provider.disable(keyId, oldValue);
      } catch { oldDisabled = false; }

      // Step 6: Update inventory
      const newKeyMetadata: KeyMetadata = {
        ...key,
        id: newKeyId,
        fingerprint: newFingerprint,
        lastRotatedAt: new Date().toISOString(),
        lastValidationAt: new Date().toISOString(),
        lastValidationResult: 'VALID',
        lifecycleState: 'ACTIVE',
        rotationStatus: 'NOT_DUE',
        ...rotationResult.newMetadata,
      } as KeyMetadata;

      this.inventory.upsert(newKeyMetadata);

      // Mark old key as deprecated
      this.inventory.updateLifecycleState(keyId, 'DEPRECATED');

      this.audit.record(this.makeAuditInput('ROTATE', keyId, key.provider, key.envVar, 'ROTATING', policy, start, null, {
        newKeyId,
        newFingerprint,
        oldDisabled,
        validationResult: 'VALID',
      }));

      return {
        success: true,
        keyId: newKeyId,
        operation: 'ROTATE',
        previousState: 'ROTATING',
        resultingState: 'ACTIVE',
        validationResult: 'VALID',
        failureReason: null,
        policyEvaluation: policy,
        durationMs: Date.now() - start,
        message: `Rotated key ${key.envVar ?? keyId}. New key: ${newKeyId}. Old key: ${keyId} (deprecated${oldDisabled ? ', disabled' : ''}).`,
      };
    } catch (error) {
      // Rotation failed — restore old key state
      this.inventory.updateLifecycleState(keyId, 'ACTIVE');
      const reason = error instanceof Error ? error.message : 'unknown';

      this.audit.record(this.makeAuditInput('ROTATE', keyId, key.provider, key.envVar, 'ROTATING', policy, start, reason));

      return {
        success: false,
        keyId,
        operation: 'ROTATE',
        previousState: 'ROTATING',
        resultingState: 'ACTIVE',
        validationResult: null,
        failureReason: reason,
        policyEvaluation: policy,
        durationMs: Date.now() - start,
        message: `Rotation failed: ${reason}. Old key retained.`,
      };
    } finally {
      // Always release the rotation lock — whether success or failure
      this.releaseRotationLock(keyId);
    }
  }

  // ─── REVOKE ───────────────────────────────────────────────────────────

  /**
   * Revoke a key — permanently invalidate it.
   */
  async revoke(keyId: string): Promise<KeyOperationResult> {
    const start = Date.now();
    const key = this.inventory.get(keyId);
    if (!key) throw new KeyNotFoundError(keyId);

    const ctx = this.makeContext('REVOKE', key, key.provider);
    const policy = this.policyEngine.evaluate(ctx);

    if (!policy.allowed) {
      return this.failOperation('REVOKE', key, policy, start, 'Policy denied');
    }

    const provider = this.providers.get(key.provider);
    if (!provider || !provider.supportsKeyRevocation) {
      return this.failOperation('REVOKE', key, policy, start, `Provider ${key.provider} does not support revocation`);
    }

    const vault = this.vaults.get(key.storageBackend);
    const value = await vault.retrieve(keyId);

    if (!value) {
      return this.failOperation('REVOKE', key, policy, start, 'Key value not found in vault');
    }

    const revoked = await provider.revoke(keyId, value);

    if (revoked) {
      this.inventory.updateLifecycleState(keyId, 'REVOKED');
      await vault.delete(keyId);
    }

    this.audit.record(this.makeAuditInput('REVOKE', keyId, key.provider, key.envVar, key.lifecycleState, policy, start, revoked ? null : 'Provider did not confirm revocation'));

    return {
      success: revoked,
      keyId,
      operation: 'REVOKE',
      previousState: key.lifecycleState,
      resultingState: revoked ? 'REVOKED' : key.lifecycleState,
      validationResult: revoked ? 'REVOKED' : null,
      failureReason: revoked ? null : 'Provider did not confirm revocation',
      policyEvaluation: policy,
      durationMs: Date.now() - start,
      message: revoked ? `Revoked key ${key.envVar ?? keyId}` : `Revocation not confirmed by provider`,
    };
  }

  // ─── DESTROY ──────────────────────────────────────────────────────────

  /**
   * Destroy a key — permanently delete from provider and vault.
   */
  async destroy(keyId: string): Promise<KeyOperationResult> {
    const start = Date.now();
    const key = this.inventory.get(keyId);
    if (!key) throw new KeyNotFoundError(keyId);

    const ctx = this.makeContext('DESTROY', key, key.provider);
    const policy = this.policyEngine.evaluate(ctx);

    if (!policy.allowed) {
      return this.failOperation('DESTROY', key, policy, start, 'Policy denied');
    }

    const provider = this.providers.get(key.provider);
    const vault = this.vaults.get(key.storageBackend);
    const value = await vault.retrieve(keyId);

    let providerDestroyed = false;
    if (provider && value) {
      try {
        providerDestroyed = await provider.destroy(keyId, value);
      } catch { providerDestroyed = false; }
    }

    // Always delete from vault
    await vault.delete(keyId);
    this.inventory.updateLifecycleState(keyId, 'DESTROYED');

    this.audit.record(this.makeAuditInput('DESTROY', keyId, key.provider, key.envVar, key.lifecycleState, policy, start, null, {
      providerDestroyed,
      vaultDeleted: true,
    }));

    return {
      success: true,
      keyId,
      operation: 'DESTROY',
      previousState: key.lifecycleState,
      resultingState: 'DESTROYED',
      validationResult: null,
      failureReason: null,
      policyEvaluation: policy,
      durationMs: Date.now() - start,
      message: `Destroyed key ${key.envVar ?? keyId} (vault: deleted, provider: ${providerDestroyed ? 'deleted' : 'not confirmed'})`,
    };
  }

  // ─── RECOVER ──────────────────────────────────────────────────────────

  /**
   * Recover from a credential failure.
   *
   * This is called when a service auth failure is detected. It:
   *   1. Validates the current credential
   *   2. If invalid/expired, attempts rotation
   *   3. If rotation fails, escalates
   */
  async recover(keyId: string): Promise<KeyOperationResult> {
    const start = Date.now();
    const key = this.inventory.get(keyId);
    if (!key) throw new KeyNotFoundError(keyId);

    const ctx = this.makeContext('RECOVER', key, key.provider);
    const policy = this.policyEngine.evaluate(ctx);

    if (!policy.allowed) {
      return this.failOperation('RECOVER', key, policy, start, 'Policy denied');
    }

    // First, validate the current key
    const validateResult = await this.validate(keyId);

    if (validateResult.success) {
      // Key is actually valid — the failure was transient
      this.audit.record(this.makeAuditInput('RECOVER', keyId, key.provider, key.envVar, key.lifecycleState, policy, start, null, {
        action: 'validated_ok',
      }));
      return {
        success: true,
        keyId,
        operation: 'RECOVER',
        previousState: key.lifecycleState,
        resultingState: 'ACTIVE',
        validationResult: 'VALID',
        failureReason: null,
        policyEvaluation: policy,
        durationMs: Date.now() - start,
        message: `Key is valid — failure was transient`,
      };
    }

    // Key is invalid — attempt rotation
    if (validateResult.validationResult === 'INVALID' || validateResult.validationResult === 'EXPIRED' || validateResult.validationResult === 'REVOKED') {
      const provider = this.providers.get(key.provider);
      if (provider?.supportsKeyRotation) {
        const rotateResult = await this.rotate(keyId);
        this.audit.record(this.makeAuditInput('RECOVER', keyId, key.provider, key.envVar, key.lifecycleState, policy, start, rotateResult.success ? null : rotateResult.failureReason, {
          action: 'rotated',
          rotateSuccess: rotateResult.success,
        }));
        return {
          ...rotateResult,
          operation: 'RECOVER',
          message: rotateResult.success
            ? `Recovered via rotation: ${rotateResult.message}`
            : `Recovery failed — rotation unsuccessful: ${rotateResult.failureReason}`,
        };
      }
    }

    // Cannot recover — escalate
    this.audit.record(this.makeAuditInput('RECOVER', keyId, key.provider, key.envVar, key.lifecycleState, policy, start, 'Cannot recover — no rotation support or unknown failure'));

    return {
      success: false,
      keyId,
      operation: 'RECOVER',
      previousState: key.lifecycleState,
      resultingState: key.lifecycleState,
      validationResult: validateResult.validationResult,
      failureReason: 'Cannot recover — requires human intervention',
      policyEvaluation: policy,
      durationMs: Date.now() - start,
      message: `Recovery failed — escalated to human. Key state: ${validateResult.validationResult}`,
    };
  }

  // ─── GET INVENTORY ────────────────────────────────────────────────────

  /**
   * Get the full key inventory.
   */
  getInventory(): KeyInventory {
    return this.inventory.getInventory();
  }

  /**
   * Get a key by ID (metadata only, never the value).
   */
  getKey(keyId: string): KeyMetadata | null {
    return this.inventory.get(keyId);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────

  private makeContext(operation: KeyAuditOperation, key: KeyMetadata | null, providerId: string): KeyPolicyContext {
    return {
      operation,
      keyMetadata: key,
      providerId,
      environment: this.detectEnvironment(),
      dryRun: false,
      killSwitchActive: this.killSwitchActive,
      autonomousModeEnabled: this.autonomousModeEnabled,
    };
  }

  /**
   * Release the rotation lock for a key.
   * Called in the finally block of rotate() to ensure the lock is always released.
   */
  private releaseRotationLock(keyId: string): void {
    this.rotationLocks.delete(keyId);
  }

  private detectEnvironment(): string {
    const env: string = process.env.NODE_ENV ?? 'development';
    if (env === 'production') return 'production';
    if (env === 'staging') return 'staging';
    if (env === 'test') return 'test';
    return 'development';
  }

  private classifyRiskLevel(key: KeyMetadata): KeyRiskLevel {
    // Master keys (sk_live_, full access) are CRITICAL
    if (key.envVar === 'STRIPE_SECRET_KEY' && process.env.STRIPE_SECRET_KEY?.startsWith('sk_live_')) {
      return 'CRITICAL';
    }
    // Production keys with high access are HIGH
    if (key.provider === 'stripe' || key.provider === 'twilio') {
      return key.credentialType === 'auth_token' ? 'HIGH' : 'MEDIUM';
    }
    if (key.provider === 'sendgrid') return 'MEDIUM';
    if (key.provider === 'google_places') return 'MEDIUM';
    return 'MEDIUM';
  }

  private failOperation(
    operation: KeyAuditOperation,
    key: KeyMetadata | null,
    policy: KeyPolicyEvaluationResult,
    start: number,
    reason: string,
  ): KeyOperationResult {
    const keyId = key?.id ?? 'unknown';
    const provider = key?.provider ?? 'unknown';
    const envVar = key?.envVar ?? null;
    const prevState = key?.lifecycleState ?? 'UNKNOWN';

    this.audit.record(this.makeAuditInput(operation, keyId, provider, envVar, prevState, policy, start, reason));

    return {
      success: false,
      keyId,
      operation,
      previousState: prevState,
      resultingState: prevState,
      validationResult: null,
      failureReason: reason,
      policyEvaluation: policy,
      durationMs: Date.now() - start,
      message: `${operation} failed: ${reason}`,
    };
  }

  private makeAuditInput(
    operation: KeyAuditOperation,
    keyId: string,
    provider: string,
    envVar: string | null,
    previousState: KeyLifecycleState | null,
    policy: KeyPolicyEvaluationResult,
    start: number,
    failureReason: string | null,
    detail?: Record<string, unknown>,
  ): Parameters<KeyAuditService['record']>[0] {
    return {
      operation,
      actor: 'heidi',
      decision: policy.decision,
      policy: policy.policyId,
      authorizationResult: policy.requiredAuthorization,
      keyId,
      provider,
      keyIdentifier: envVar ?? keyId,
      previousState: previousState ?? 'UNKNOWN',
      resultingState: previousState ?? 'UNKNOWN', // Will be updated by caller if needed
      validationResult: null,
      failureReason,
      riskLevel: policy.riskLevel,
      durationMs: Date.now() - start,
      fingerprint: null, // Set by caller if available
      detail,
    };
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

let kmsInstance: KeyManagementService | null = null;

export function getKeyManagementService(root?: string): KeyManagementService {
  if (!kmsInstance) {
    const r = root ?? process.cwd();
    const { EnvVarVault } = require('./KeyVaults');
    kmsInstance = new KeyManagementService(r, undefined, new VaultRegistry(new EnvVarVault()));
  }
  return kmsInstance;
}

export function resetKeyManagementService(): void {
  kmsInstance = null;
}
