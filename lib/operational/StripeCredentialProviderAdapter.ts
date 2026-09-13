/**
 * Stripe Credential Provider Adapter
 *
 * Extends the existing StripeAdapter in ProviderAdapters.ts with the
 * credential governance state machine, evidence model, and layered
 * probe framework required for autonomous credential lifecycle management.
 *
 * This adapter does NOT replace StripeAdapter — it composes with it.
 * StripeAdapter remains the simple capability-health probe used by
 * CapabilityHealthManager. This adapter adds:
 *   - Credential state machine transitions
 *   - Evidence-backed verification levels
 *   - Placeholder detection
 *   - Test/live mode classification
 *   - Webhook secret lifecycle (separate from API key)
 *   - Stripe CLI session state (separate from API key)
 *   - Rotation planning with authorization boundaries
 *
 * SECURITY: This adapter NEVER stores, logs, or persists raw credential
 * values. Only safe metadata (type, provider, fingerprint, prefix,
 * state, timestamps) is recorded.
 */

import { createHash } from 'crypto';
import {
  CredentialStateMachine,
  getCredentialStateMachine,
  isPlaceholder,
  isMalformed,
  type CredentialRecord,
  type CredentialState,
} from './CredentialStateMachine';
import {
  createEvidence,
  getEvidenceStore,
  type EvidenceRecord,
  type VerificationLevel,
  type EvidenceBlocker,
} from './EvidenceModel';

// ─── Stripe Credential Types ─────────────────────────────────────────────

export type StripeCredentialType =
  | 'stripe_secret_key'        // sk_test_... or sk_live_...
  | 'stripe_restricted_key'    // rk_test_... or rk_live_...
  | 'stripe_webhook_secret'    // whsec_...
  | 'stripe_cli_session';      // Stripe CLI authentication (separate)

export type StripeEnvironment = 'test' | 'live' | 'unknown';

export interface StripeCredentialClassification {
  type: StripeCredentialType;
  environment: StripeEnvironment;
  isPlaceholder: boolean;
  isMalformed: boolean;
  prefix: string;
  /** Safe fingerprint (SHA-256 of value, first 16 chars) */
  fingerprint: string;
  /** Whether the value looks like a test or live credential */
  mode: StripeEnvironment;
}

export interface StripeProbeResult {
  level: number;               // 0-5
  levelName: string;
  result: 'PASS' | 'FAIL' | 'BLOCKED' | 'SKIPPED' | 'SIMULATED' | 'UNKNOWN';
  verificationLevel: VerificationLevel;
  evidence: string;
  latencyMs: number;
  apiResponseCode?: number;
  /** Safe metadata only */
  metadata: {
    environment: StripeEnvironment;
    credentialType: StripeCredentialType;
    fingerprint: string;
  };
  blocker?: EvidenceBlocker;
}

// ─── Stripe Credential Provider Adapter ──────────────────────────────────

export class StripeCredentialProviderAdapter {
  readonly providerId = 'stripe';
  readonly displayName = 'Stripe';
  readonly stateMachine: CredentialStateMachine;

  constructor(stateMachine?: CredentialStateMachine) {
    this.stateMachine = stateMachine || getCredentialStateMachine();
  }

  // ─── Classification ─────────────────────────────────────────────────────

  /**
   * Classify a Stripe credential value.
   * SECURITY: The raw value is received, classified, and immediately
   * discarded. Only safe metadata is returned.
   */
  classify(value: string, source: string): StripeCredentialClassification {
    const fingerprint = this.fingerprint(value);
    const prefix = this.safePrefix(value);

    let type: StripeCredentialType;
    let environment: StripeEnvironment = 'unknown';

    if (value.startsWith('sk_live_')) {
      type = 'stripe_secret_key';
      environment = 'live';
    } else if (value.startsWith('sk_test_')) {
      type = 'stripe_secret_key';
      environment = 'test';
    } else if (value.startsWith('rk_live_')) {
      type = 'stripe_restricted_key';
      environment = 'live';
    } else if (value.startsWith('rk_test_')) {
      type = 'stripe_restricted_key';
      environment = 'test';
    } else if (value.startsWith('whsec_')) {
      type = 'stripe_webhook_secret';
      // Webhook secrets don't encode test/live in the prefix
      environment = 'unknown';
    } else if (source.includes('cli') || source.includes('CLI')) {
      type = 'stripe_cli_session';
    } else {
      type = 'stripe_secret_key'; // default assumption
    }

    return {
      type,
      environment,
      isPlaceholder: isPlaceholder(value),
      isMalformed: isMalformed(value, this.expectedPrefix(type)),
      prefix,
      fingerprint,
      mode: environment,
    };
  }

  // ─── Discovery ──────────────────────────────────────────────────────────

  /**
   * Discover Stripe credentials from the environment.
   * Returns metadata only — never raw values.
   */
  discover(): CredentialRecord[] {
    const discovered: CredentialRecord[] = [];
    const envVars = [
      { name: 'STRIPE_SECRET_KEY', type: 'stripe_secret_key' as StripeCredentialType, source: 'process.env.STRIPE_SECRET_KEY' },
      { name: 'STRIPE_RESTRICTED_KEY', type: 'stripe_restricted_key' as StripeCredentialType, source: 'process.env.STRIPE_RESTRICTED_KEY' },
      { name: 'STRIPE_WEBHOOK_SECRET', type: 'stripe_webhook_secret' as StripeCredentialType, source: 'process.env.STRIPE_WEBHOOK_SECRET' },
      { name: 'STRIPE_WEBHOOK_SECRET_01', type: 'stripe_webhook_secret' as StripeCredentialType, source: 'process.env.STRIPE_WEBHOOK_SECRET_01' },
      { name: 'STRIPE_CLI_SESSION', type: 'stripe_cli_session' as StripeCredentialType, source: 'process.env.STRIPE_CLI_SESSION' },
    ];

    for (const envVar of envVars) {
      const value = process.env[envVar.name];
      if (!value) continue;

      const classification = this.classify(value, envVar.source);
      const existing = this.stateMachine.getByName(envVar.name);

      if (existing) {
        discovered.push(existing);
        continue;
      }

      const record = this.stateMachine.register({
        name: envVar.name,
        type: classification.type,
        provider: 'stripe',
        fingerprint: classification.fingerprint,
        prefix: classification.prefix,
        environment: classification.environment,
        source: envVar.source,
        dependentCapabilities: this.dependentCapabilities(classification.type),
        dependentServices: this.dependentServices(classification.type),
        rotationSafe: this.isRotationSafe(classification.type, classification.environment),
      });

      // Transition to CLASSIFIED
      this.stateMachine.transition(record.id, 'CLASSIFIED', {
        reason: `Discovered in ${envVar.source}`,
        authorization: { mode: 'system', actor: 'credential-governance', role: null },
        evidence: {
          verificationLevel: 'VERIFIED_INTERNAL',
          source: 'environment_discovery',
          details: `Type: ${classification.type}, Environment: ${classification.environment}, Placeholder: ${classification.isPlaceholder}`,
        },
      });

      // If placeholder, transition to INVALID immediately
      if (classification.isPlaceholder) {
        this.stateMachine.transition(record.id, 'INVALID', {
          reason: 'Credential value matches placeholder pattern',
          authorization: { mode: 'system', actor: 'credential-governance', role: null },
          evidence: {
            verificationLevel: 'VERIFIED_INTERNAL',
            source: 'placeholder_detection',
            details: 'Value matched known placeholder pattern (e.g., trailing zeros, example value)',
          },
        });
      }

      discovered.push(record);
    }

    return discovered;
  }

  // ─── Layered Probes ─────────────────────────────────────────────────────

  /**
   * Run a layered credential health probe.
   * Level 0-3 are safe and autonomous.
   * Level 4-5 require explicit authorization.
   */
  async probe(
    credentialId: string,
    requestedLevel: number,
    authorization: { mode: string; actor: string | null; role: string | null },
    correlationId: string
  ): Promise<StripeProbeResult> {
    const record = this.stateMachine.get(credentialId);
    if (!record) {
      return {
        level: 0,
        levelName: 'presence',
        result: 'BLOCKED',
        verificationLevel: 'BLOCKED',
        evidence: 'Credential not found in state machine',
        latencyMs: 0,
        metadata: { environment: 'unknown', credentialType: 'stripe_secret_key', fingerprint: '' },
        blocker: {
          type: 'INTERNAL_ERROR',
          provider: 'stripe',
          capability: 'credential-governance',
          severity: 'blocking',
          repairability: 'not_repairable',
          reason: 'Credential record not found',
          attemptedActions: [],
          requiredHumanAction: null,
          risk: 'LOW',
        },
      };
    }

    const start = Date.now();
    const value = this.getCredentialValue(record);
    const operationId = `stripe-probe-${credentialId}-${Date.now()}`;

    // Level 0: Presence
    if (requestedLevel >= 0) {
      const level0 = this.probeLevel0Presence(record, value);
      this.recordProbeEvidence(operationId, record, level0, authorization, correlationId);
      if (level0.result !== 'PASS') return level0;
    }

    // Level 1: Format/Classification
    if (requestedLevel >= 1) {
      const level1 = this.probeLevel1Format(record, value);
      this.recordProbeEvidence(operationId, record, level1, authorization, correlationId);
      if (level1.result !== 'PASS') return level1;
    }

    // Level 2: Local configuration
    if (requestedLevel >= 2) {
      const level2 = this.probeLevel2LocalConfig(record);
      this.recordProbeEvidence(operationId, record, level2, authorization, correlationId);
      if (level2.result !== 'PASS') return level2;
    }

    // Level 3: Provider API validation
    if (requestedLevel >= 3) {
      // Authorization check for API calls
      if (authorization.mode === 'autonomous' && record.environment === 'live') {
        const blocked: StripeProbeResult = {
          level: 3,
          levelName: 'provider_api',
          result: 'BLOCKED',
          verificationLevel: 'BLOCKED',
          evidence: 'Live-mode API probe requires authorization (not autonomous)',
          latencyMs: Date.now() - start,
          metadata: {
            environment: record.environment as StripeEnvironment,
            credentialType: record.type as StripeCredentialType,
            fingerprint: record.fingerprint,
          },
          blocker: {
            type: 'HUMAN_AUTHORIZATION_REQUIRED',
            provider: 'stripe',
            capability: 'credential-governance',
            severity: 'blocking',
            repairability: 'human_required',
            reason: 'Live-mode Stripe API probe requires operator/owner authorization',
            attemptedActions: ['presence', 'format', 'local_config'],
            requiredHumanAction: 'Authorize live-mode credential probe',
            risk: 'MEDIUM',
          },
        };
        this.recordProbeEvidence(operationId, record, blocked, authorization, correlationId);
        return blocked;
      }

      const level3 = await this.probeLevel3ProviderAPI(record, value);
      this.recordProbeEvidence(operationId, record, level3, authorization, correlationId);
      if (level3.result !== 'PASS') return level3;
    }

    // Level 4: Controlled test operation
    if (requestedLevel >= 4) {
      if (authorization.mode === 'autonomous') {
        const blocked: StripeProbeResult = {
          level: 4,
          levelName: 'controlled_test',
          result: 'BLOCKED',
          verificationLevel: 'BLOCKED',
          evidence: 'Level 4 probe requires policy authorization',
          latencyMs: Date.now() - start,
          metadata: {
            environment: record.environment as StripeEnvironment,
            credentialType: record.type as StripeCredentialType,
            fingerprint: record.fingerprint,
          },
          blocker: {
            type: 'HUMAN_AUTHORIZATION_REQUIRED',
            provider: 'stripe',
            capability: 'credential-governance',
            severity: 'blocking',
            repairability: 'human_required',
            reason: 'Level 4 (controlled test operation) requires policy_authorized or human_authorized',
            attemptedActions: ['presence', 'format', 'local_config', 'provider_api'],
            requiredHumanAction: 'Authorize controlled test operation',
            risk: 'MEDIUM',
          },
        };
        this.recordProbeEvidence(operationId, record, blocked, authorization, correlationId);
        return blocked;
      }
      const level4 = await this.probeLevel4ControlledTest(record, value, authorization);
      this.recordProbeEvidence(operationId, record, level4, authorization, correlationId);
      if (level4.result !== 'PASS') return level4;
    }

    // Level 5: Full external E2E
    if (requestedLevel >= 5) {
      if (authorization.mode === 'autonomous') {
        const blocked: StripeProbeResult = {
          level: 5,
          levelName: 'external_e2e',
          result: 'BLOCKED',
          verificationLevel: 'BLOCKED',
          evidence: 'Level 5 probe requires explicit owner authorization',
          latencyMs: Date.now() - start,
          metadata: {
            environment: record.environment as StripeEnvironment,
            credentialType: record.type as StripeCredentialType,
            fingerprint: record.fingerprint,
          },
          blocker: {
            type: 'HUMAN_AUTHORIZATION_REQUIRED',
            provider: 'stripe',
            capability: 'stripe-e2e-qualification',
            severity: 'blocking',
            repairability: 'human_required',
            reason: 'Level 5 (full external E2E) requires owner authorization',
            attemptedActions: ['presence', 'format', 'local_config', 'provider_api', 'controlled_test'],
            requiredHumanAction: 'Authorize full external E2E qualification',
            risk: 'HIGH',
          },
        };
        this.recordProbeEvidence(operationId, record, blocked, authorization, correlationId);
        return blocked;
      }
      const level5 = await this.probeLevel5ExternalE2E(record, value, authorization);
      this.recordProbeEvidence(operationId, record, level5, authorization, correlationId);
      return level5;
    }

    // All passed levels succeeded
    const finalResult: StripeProbeResult = {
      level: requestedLevel,
      levelName: this.levelName(requestedLevel),
      result: 'PASS',
      verificationLevel: requestedLevel >= 3 ? 'VERIFIED_EXTERNAL' : 'VERIFIED_INTERNAL',
      evidence: `All probe levels 0-${requestedLevel} passed`,
      latencyMs: Date.now() - start,
      metadata: {
        environment: record.environment as StripeEnvironment,
        credentialType: record.type as StripeCredentialType,
        fingerprint: record.fingerprint,
      },
    };

    // Transition to HEALTHY if we passed Level 3+
    if (requestedLevel >= 3 && record.state !== 'HEALTHY') {
      this.stateMachine.transition(credentialId, 'VALIDATED', {
        reason: `Probe level ${requestedLevel} passed`,
        authorization: { mode: authorization.mode as any, actor: authorization.actor, role: authorization.role },
        evidence: {
          verificationLevel: finalResult.verificationLevel,
          source: 'stripe_credential_probe',
          details: finalResult.evidence,
        },
      });
      this.stateMachine.transition(credentialId, 'HEALTHY', {
        reason: 'Externally verified via Stripe API',
        authorization: { mode: authorization.mode as any, actor: authorization.actor, role: authorization.role },
        evidence: {
          verificationLevel: 'VERIFIED_EXTERNAL',
          source: 'stripe_api_balance_check',
          details: finalResult.evidence,
        },
      });
    }

    return finalResult;
  }

  // ─── Individual Probe Levels ────────────────────────────────────────────

  private probeLevel0Presence(record: CredentialRecord, value: string | null): StripeProbeResult {
    const present = !!value && value.trim() !== '';
    return {
      level: 0,
      levelName: 'presence',
      result: present ? 'PASS' : 'BLOCKED',
      verificationLevel: present ? 'VERIFIED_INTERNAL' : 'BLOCKED',
      evidence: present ? 'Credential present in environment' : 'Credential not found in environment',
      latencyMs: 0,
      metadata: {
        environment: record.environment as StripeEnvironment,
        credentialType: record.type as StripeCredentialType,
        fingerprint: record.fingerprint,
      },
      blocker: present ? undefined : {
        type: 'EXTERNAL_CREDENTIAL',
        provider: 'stripe',
        capability: 'credential-governance',
        severity: 'blocking',
        repairability: 'human_required',
        reason: 'Credential not present in environment',
        attemptedActions: [],
        requiredHumanAction: `Set ${record.name} in .env.local`,
        risk: 'HIGH',
      },
    };
  }

  private probeLevel1Format(record: CredentialRecord, value: string | null): StripeProbeResult {
    if (!value) {
      return this.probeLevel0Presence(record, null);
    }

    const expectedPrefix = this.expectedPrefix(record.type as StripeCredentialType);
    const placeholder = isPlaceholder(value);
    const malformed = isMalformed(value, expectedPrefix);

    if (placeholder) {
      // Transition to INVALID if not already
      if (record.state !== 'INVALID') {
        this.stateMachine.transition(record.id, 'INVALID', {
          reason: 'Placeholder detected during format probe',
          authorization: { mode: 'system', actor: 'credential-governance', role: null },
          evidence: {
            verificationLevel: 'VERIFIED_INTERNAL',
            source: 'placeholder_detection',
            details: 'Value matches placeholder pattern',
          },
        });
      }
      return {
        level: 1,
        levelName: 'format',
        result: 'BLOCKED',
        verificationLevel: 'BLOCKED',
        evidence: 'Credential is a placeholder value',
        latencyMs: 0,
        metadata: {
          environment: record.environment as StripeEnvironment,
          credentialType: record.type as StripeCredentialType,
          fingerprint: record.fingerprint,
        },
        blocker: {
          type: 'EXTERNAL_CREDENTIAL',
          provider: 'stripe',
          capability: 'credential-governance',
          severity: 'blocking',
          repairability: 'human_required',
          reason: 'Credential value is a placeholder (e.g., trailing zeros, example value)',
          attemptedActions: ['presence'],
          requiredHumanAction: `Replace ${record.name} with a real Stripe credential`,
          risk: 'HIGH',
        },
      };
    }

    if (malformed) {
      return {
        level: 1,
        levelName: 'format',
        result: 'FAIL',
        verificationLevel: 'VERIFIED_INTERNAL',
        evidence: `Credential malformed — expected prefix: ${expectedPrefix}`,
        latencyMs: 0,
        metadata: {
          environment: record.environment as StripeEnvironment,
          credentialType: record.type as StripeCredentialType,
          fingerprint: record.fingerprint,
        },
        blocker: {
          type: 'EXTERNAL_CREDENTIAL',
          provider: 'stripe',
          capability: 'credential-governance',
          severity: 'blocking',
          repairability: 'human_required',
          reason: 'Credential format is malformed',
          attemptedActions: ['presence'],
          requiredHumanAction: `Fix ${record.name} format`,
          risk: 'MEDIUM',
        },
      };
    }

    return {
      level: 1,
      levelName: 'format',
      result: 'PASS',
      verificationLevel: 'VERIFIED_INTERNAL',
      evidence: `Format valid — prefix: ${this.safePrefix(value)}, type: ${record.type}`,
      latencyMs: 0,
      metadata: {
        environment: record.environment as StripeEnvironment,
        credentialType: record.type as StripeCredentialType,
        fingerprint: record.fingerprint,
      },
    };
  }

  private probeLevel2LocalConfig(record: CredentialRecord): StripeProbeResult {
    // Check that the credential is referenced in the expected configuration location
    const sourceOk = record.source.startsWith('process.env.');
    return {
      level: 2,
      levelName: 'local_config',
      result: sourceOk ? 'PASS' : 'FAIL',
      verificationLevel: 'VERIFIED_INTERNAL',
      evidence: sourceOk
        ? `Credential sourced from ${record.source}`
        : `Unexpected credential source: ${record.source}`,
      latencyMs: 0,
      metadata: {
        environment: record.environment as StripeEnvironment,
        credentialType: record.type as StripeCredentialType,
        fingerprint: record.fingerprint,
      },
    };
  }

  private async probeLevel3ProviderAPI(record: CredentialRecord, value: string | null): Promise<StripeProbeResult> {
    if (!value) {
      return this.probeLevel0Presence(record, null);
    }

    // Webhook secrets and CLI sessions can't be validated via API balance check
    if (record.type === 'stripe_webhook_secret' || record.type === 'stripe_cli_session') {
      return {
        level: 3,
        levelName: 'provider_api',
        result: 'SKIPPED',
        verificationLevel: 'VERIFIED_INTERNAL',
        evidence: `${record.type} cannot be validated via Stripe balance API — requires webhook signature verification`,
        latencyMs: 0,
        metadata: {
          environment: record.environment as StripeEnvironment,
          credentialType: record.type as StripeCredentialType,
          fingerprint: record.fingerprint,
        },
      };
    }

    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const response = await fetch('https://api.stripe.com/v1/balance', {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${value}` },
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        const balance = await response.json() as { available?: { amount: number; currency?: string }[] };
        const amt = balance.available?.[0]?.amount ?? 0;
        return {
          level: 3,
          levelName: 'provider_api',
          result: 'PASS',
          verificationLevel: 'VERIFIED_EXTERNAL',
          evidence: `Stripe API verified — balance: ${amt / 100} ${balance.available?.[0]?.currency || 'usd'}`,
          latencyMs: Date.now() - start,
          apiResponseCode: response.status,
          metadata: {
            environment: record.environment as StripeEnvironment,
            credentialType: record.type as StripeCredentialType,
            fingerprint: record.fingerprint,
          },
        };
      }

      if (response.status === 401) {
        // Transition to INVALID
        if (record.state !== 'INVALID') {
          this.stateMachine.transition(record.id, 'INVALID', {
            reason: 'Stripe API rejected credential (401)',
            authorization: { mode: 'system', actor: 'credential-governance', role: null },
            evidence: {
              verificationLevel: 'VERIFIED_EXTERNAL',
              source: 'stripe_api_balance_check',
              details: 'HTTP 401 — Invalid API Key',
            },
          });
        }
        return {
          level: 3,
          levelName: 'provider_api',
          result: 'FAIL',
          verificationLevel: 'VERIFIED_EXTERNAL',
          evidence: 'Stripe API key rejected (401)',
          latencyMs: Date.now() - start,
          apiResponseCode: 401,
          metadata: {
            environment: record.environment as StripeEnvironment,
            credentialType: record.type as StripeCredentialType,
            fingerprint: record.fingerprint,
          },
          blocker: {
            type: 'EXTERNAL_CREDENTIAL',
            provider: 'stripe',
            capability: 'credential-governance',
            severity: 'blocking',
            repairability: 'human_required',
            reason: 'Stripe API rejected the credential (401 Invalid API Key)',
            attemptedActions: ['presence', 'format', 'local_config'],
            requiredHumanAction: `Replace ${record.name} with a valid Stripe API key`,
            risk: 'HIGH',
          },
        };
      }

      if (response.status === 403) {
        if (record.state !== 'REVOKED') {
          this.stateMachine.transition(record.id, 'REVOKED', {
            reason: 'Stripe API forbidden (403) — key may be revoked or restricted',
            authorization: { mode: 'system', actor: 'credential-governance', role: null },
            evidence: {
              verificationLevel: 'VERIFIED_EXTERNAL',
              source: 'stripe_api_balance_check',
              details: 'HTTP 403 — Forbidden',
            },
          });
        }
        return {
          level: 3,
          levelName: 'provider_api',
          result: 'FAIL',
          verificationLevel: 'VERIFIED_EXTERNAL',
          evidence: 'Stripe API key forbidden (403) — may be revoked',
          latencyMs: Date.now() - start,
          apiResponseCode: 403,
          metadata: {
            environment: record.environment as StripeEnvironment,
            credentialType: record.type as StripeCredentialType,
            fingerprint: record.fingerprint,
          },
          blocker: {
            type: 'EXTERNAL_CREDENTIAL',
            provider: 'stripe',
            capability: 'credential-governance',
            severity: 'blocking',
            repairability: 'human_required',
            reason: 'Stripe API key forbidden — may be revoked or restricted',
            attemptedActions: ['presence', 'format', 'local_config'],
            requiredHumanAction: `Check ${record.name} in Stripe Dashboard — may need rotation`,
            risk: 'HIGH',
          },
        };
      }

      return {
        level: 3,
        levelName: 'provider_api',
        result: 'UNKNOWN',
        verificationLevel: 'UNAVAILABLE',
        evidence: `Stripe API returned ${response.status}`,
        latencyMs: Date.now() - start,
        apiResponseCode: response.status,
        metadata: {
          environment: record.environment as StripeEnvironment,
          credentialType: record.type as StripeCredentialType,
          fingerprint: record.fingerprint,
        },
      };
    } catch (error) {
      return {
        level: 3,
        levelName: 'provider_api',
        result: 'BLOCKED',
        verificationLevel: 'UNAVAILABLE',
        evidence: `Stripe API unreachable: ${error instanceof Error ? error.message : 'unknown'}`,
        latencyMs: Date.now() - start,
        metadata: {
          environment: record.environment as StripeEnvironment,
          credentialType: record.type as StripeCredentialType,
          fingerprint: record.fingerprint,
        },
        blocker: {
          type: 'EXTERNAL_SERVICE_UNAVAILABLE',
          provider: 'stripe',
          capability: 'credential-governance',
          severity: 'blocking',
          repairability: 'auto_repairable',
          reason: 'Stripe API unreachable — network or service issue',
          attemptedActions: ['presence', 'format', 'local_config'],
          requiredHumanAction: null,
          risk: 'LOW',
        },
      };
    }
  }

  private async probeLevel4ControlledTest(
    record: CredentialRecord,
    value: string | null,
    authorization: { mode: string; actor: string | null; role: string | null }
  ): Promise<StripeProbeResult> {
    if (!value || record.environment === 'live') {
      return {
        level: 4,
        levelName: 'controlled_test',
        result: 'BLOCKED',
        verificationLevel: 'BLOCKED',
        evidence: 'Level 4 only applicable to test-mode credentials',
        latencyMs: 0,
        metadata: {
          environment: record.environment as StripeEnvironment,
          credentialType: record.type as StripeCredentialType,
          fingerprint: record.fingerprint,
        },
        blocker: {
          type: 'POLICY_PROHIBITED_ACTION',
          provider: 'stripe',
          capability: 'credential-governance',
          severity: 'blocking',
          repairability: 'not_repairable',
          reason: 'Level 4 controlled test only for test-mode',
          attemptedActions: [],
          requiredHumanAction: null,
          risk: 'HIGH',
        },
      };
    }

    // For test mode: create a test product (safe, reversible)
    const start = Date.now();
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10000);
      const response = await fetch('https://api.stripe.com/v1/products', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${value}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'name=HYDI_E2E_Test_Product&metadata[source]=hydi_e2e_probe&metadata[delete_after]=true',
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (response.ok) {
        const product = await response.json() as { id: string };
        // Clean up the test product
        await fetch(`https://api.stripe.com/v1/products/${product.id}`, {
          method: 'DELETE',
          headers: { 'Authorization': `Bearer ${value}` },
        }).catch(() => {});

        return {
          level: 4,
          levelName: 'controlled_test',
          result: 'PASS',
          verificationLevel: 'VERIFIED_EXTERNAL',
          evidence: 'Created and deleted a test product — write access confirmed',
          latencyMs: Date.now() - start,
          apiResponseCode: response.status,
          metadata: {
            environment: record.environment as StripeEnvironment,
            credentialType: record.type as StripeCredentialType,
            fingerprint: record.fingerprint,
          },
        };
      }

      return {
        level: 4,
        levelName: 'controlled_test',
        result: 'FAIL',
        verificationLevel: 'VERIFIED_EXTERNAL',
        evidence: `Test product creation failed: ${response.status}`,
        latencyMs: Date.now() - start,
        apiResponseCode: response.status,
        metadata: {
          environment: record.environment as StripeEnvironment,
          credentialType: record.type as StripeCredentialType,
          fingerprint: record.fingerprint,
        },
      };
    } catch (error) {
      return {
        level: 4,
        levelName: 'controlled_test',
        result: 'BLOCKED',
        verificationLevel: 'UNAVAILABLE',
        evidence: `Test operation failed: ${error instanceof Error ? error.message : 'unknown'}`,
        latencyMs: Date.now() - start,
        metadata: {
          environment: record.environment as StripeEnvironment,
          credentialType: record.type as StripeCredentialType,
          fingerprint: record.fingerprint,
        },
      };
    }
  }

  private async probeLevel5ExternalE2E(
    record: CredentialRecord,
    value: string | null,
    authorization: { mode: string; actor: string | null; role: string | null }
  ): Promise<StripeProbeResult> {
    // Level 5 is the full E2E orchestrator — delegate to StripeE2EOrchestrator
    return {
      level: 5,
      levelName: 'external_e2e',
      result: 'BLOCKED',
      verificationLevel: 'BLOCKED',
      evidence: 'Level 5 E2E must be invoked via StripeE2EOrchestrator',
      latencyMs: 0,
      metadata: {
        environment: record.environment as StripeEnvironment,
        credentialType: record.type as StripeCredentialType,
        fingerprint: record.fingerprint,
      },
      blocker: {
        type: 'EXTERNAL_CREDENTIAL',
        provider: 'stripe',
        capability: 'stripe-e2e-qualification',
        severity: 'blocking',
        repairability: 'human_required',
        reason: 'E2E orchestrator not yet invoked',
        attemptedActions: [],
        requiredHumanAction: 'Invoke StripeE2EOrchestrator',
        risk: 'MEDIUM',
      },
    };
  }

  // ─── Webhook Secret Verification ────────────────────────────────────────

  /**
   * Verify a webhook signing secret by checking signature verification
   * against a known payload. This is a safe, read-only operation.
   */
  verifyWebhookSecret(
    secretId: string,
    payload: string,
    signature: string,
    timestamp: number,
    tolerance: number = 300
  ): StripeProbeResult {
    const record = this.stateMachine.get(secretId);
    if (!record || record.type !== 'stripe_webhook_secret') {
      return {
        level: 3,
        levelName: 'webhook_signature',
        result: 'FAIL',
        verificationLevel: 'VERIFIED_INTERNAL',
        evidence: 'Record not found or not a webhook secret',
        latencyMs: 0,
        metadata: { environment: 'unknown', credentialType: 'stripe_webhook_secret', fingerprint: '' },
      };
    }

    const secret = this.getCredentialValue(record);
    if (!secret) {
      return {
        level: 3,
        levelName: 'webhook_signature',
        result: 'BLOCKED',
        verificationLevel: 'BLOCKED',
        evidence: 'Webhook secret not available',
        latencyMs: 0,
        metadata: {
          environment: record.environment as StripeEnvironment,
          credentialType: 'stripe_webhook_secret',
          fingerprint: record.fingerprint,
        },
        blocker: {
          type: 'EXTERNAL_CREDENTIAL',
          provider: 'stripe',
          capability: 'credential-governance',
          severity: 'blocking',
          repairability: 'human_required',
          reason: 'Webhook secret not present',
          attemptedActions: [],
          requiredHumanAction: `Set ${record.name}`,
          risk: 'HIGH',
        },
      };
    }

    // Stripe signature format: t=timestamp,v1=signature
    const signedPayload = `${timestamp}.${payload}`;
    const expectedSignature = createHash('sha256')
      .update(signedPayload)
      .update(secret)
      .digest('hex');

    const now = Math.floor(Date.now() / 1000);
    const age = now - timestamp;
    if (age > tolerance) {
      return {
        level: 3,
        levelName: 'webhook_signature',
        result: 'FAIL',
        verificationLevel: 'VERIFIED_INTERNAL',
        evidence: `Webhook timestamp expired (age: ${age}s, tolerance: ${tolerance}s)`,
        latencyMs: 0,
        metadata: {
          environment: record.environment as StripeEnvironment,
          credentialType: 'stripe_webhook_secret',
          fingerprint: record.fingerprint,
        },
      };
    }

    const valid = this.constantTimeCompare(expectedSignature, signature);
    return {
      level: 3,
      levelName: 'webhook_signature',
      result: valid ? 'PASS' : 'FAIL',
      verificationLevel: 'VERIFIED_INTERNAL',
      evidence: valid ? 'Webhook signature verified' : 'Webhook signature mismatch',
      latencyMs: 0,
      metadata: {
        environment: record.environment as StripeEnvironment,
        credentialType: 'stripe_webhook_secret',
        fingerprint: record.fingerprint,
      },
    };
  }

  // ─── Rotation Planning ──────────────────────────────────────────────────

  /**
   * Generate a rotation plan for a credential.
   * Returns safe metadata only.
   */
  createRotationPlan(credentialId: string): {
    credentialId: string;
    credentialName: string;
    provider: string;
    environment: string;
    rotationSafe: boolean;
    dependentServices: string[];
    dependentCapabilities: string[];
    steps: { description: string; requiresAuthorization: boolean; risk: string }[];
    rollbackPossible: boolean;
    requiresDowntime: boolean;
  } {
    const record = this.stateMachine.get(credentialId);
    if (!record) {
      throw new Error('Credential not found');
    }

    const isLive = record.environment === 'live';
    const steps = [
      { description: 'Acquire new credential from Stripe Dashboard', requiresAuthorization: true, risk: 'HIGH' },
      { description: 'Validate new credential via Stripe API', requiresAuthorization: false, risk: 'LOW' },
      { description: 'Update local configuration (.env.local)', requiresAuthorization: true, risk: 'MEDIUM' },
      { description: 'Restart affected services', requiresAuthorization: !record.rotationSafe, risk: 'MEDIUM' },
      { description: 'Verify health with new credential', requiresAuthorization: false, risk: 'LOW' },
      { description: 'Verify provider authentication', requiresAuthorization: false, risk: 'LOW' },
      { description: 'Revoke old credential in Stripe Dashboard', requiresAuthorization: true, risk: 'HIGH' },
      { description: 'Verify old credential no longer works', requiresAuthorization: false, risk: 'LOW' },
      { description: 'Certify rotation complete', requiresAuthorization: false, risk: 'LOW' },
    ];

    return {
      credentialId,
      credentialName: record.name,
      provider: record.provider,
      environment: record.environment,
      rotationSafe: record.rotationSafe,
      dependentServices: record.dependentServices,
      dependentCapabilities: record.dependentCapabilities,
      steps,
      rollbackPossible: !isLive, // Can't rollback live revocation
      requiresDowntime: !record.rotationSafe,
    };
  }

  // ─── Helpers ────────────────────────────────────────────────────────────

  private getCredentialValue(record: CredentialRecord): string | null {
    // Map record name to env var
    const envName = record.source.replace('process.env.', '');
    return process.env[envName] || null;
  }

  private fingerprint(value: string): string {
    return createHash('sha256').update(value).digest('hex').substring(0, 16);
  }

  private safePrefix(value: string): string {
    if (value.startsWith('sk_live_')) return 'sk_live_...';
    if (value.startsWith('sk_test_')) return 'sk_test_...';
    if (value.startsWith('rk_live_')) return 'rk_live_...';
    if (value.startsWith('rk_test_')) return 'rk_test_...';
    if (value.startsWith('whsec_')) return 'whsec_...';
    return value.substring(0, 4) + '...';
  }

  private expectedPrefix(type: StripeCredentialType): string | undefined {
    switch (type) {
      case 'stripe_secret_key': return 'sk_';
      case 'stripe_restricted_key': return 'rk_';
      case 'stripe_webhook_secret': return 'whsec_';
      case 'stripe_cli_session': return undefined;
    }
  }

  private levelName(level: number): string {
    return ['presence', 'format', 'local_config', 'provider_api', 'controlled_test', 'external_e2e'][level] || 'unknown';
  }

  private dependentCapabilities(type: StripeCredentialType): string[] {
    switch (type) {
      case 'stripe_secret_key':
      case 'stripe_restricted_key':
        return ['commercial.stripe', 'stripe-e2e-qualification', 'revenue.payment'];
      case 'stripe_webhook_secret':
        return ['stripe.webhook_processing', 'stripe-e2e-qualification'];
      case 'stripe_cli_session':
        return ['stripe-e2e-qualification'];
    }
  }

  private dependentServices(type: StripeCredentialType): string[] {
    switch (type) {
      case 'stripe_secret_key':
      case 'stripe_restricted_key':
        return ['api/webhooks/stripe', 'api/checkout', 'api/checkout-v2'];
      case 'stripe_webhook_secret':
        return ['api/webhooks/stripe'];
      case 'stripe_cli_session':
        return ['stripe-cli-forwarding'];
    }
  }

  private isRotationSafe(type: StripeCredentialType, environment: StripeEnvironment): boolean {
    // Test credentials are rotation-safe (no real financial impact)
    // Webhook secrets are rotation-safe (just need reconfiguration)
    if (environment === 'test') return true;
    if (type === 'stripe_webhook_secret') return true;
    return false;
  }

  private constantTimeCompare(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let result = 0;
    for (let i = 0; i < a.length; i++) {
      result |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return result === 0;
  }

  private recordProbeEvidence(
    operationId: string,
    record: CredentialRecord,
    result: StripeProbeResult,
    authorization: { mode: string; actor: string | null; role: string | null },
    correlationId: string
  ): void {
    createEvidence({
      operationId,
      capability: 'credential-governance',
      provider: 'stripe',
      environment: record.environment,
      action: `probe_level_${result.level}_${result.levelName}`,
      authorization: {
        mode: authorization.mode,
        actor: authorization.actor,
        role: authorization.role,
        permission: 'credentials:probe',
      },
      observation: result.evidence,
      verificationLevel: result.verificationLevel,
      verificationMethod: `stripe.probe.${result.levelName}`,
      result: result.result,
      confidence: result.result === 'PASS' ? 1.0 : result.result === 'BLOCKED' ? 0.0 : 0.5,
      externalEvidence: result.apiResponseCode ? [`HTTP ${result.apiResponseCode}`] : [],
      internalEvidence: [`credential: ${record.name}`, `fingerprint: ${record.fingerprint}`],
      correlationId,
      blocker: result.blocker || null,
    });
  }
}

// ─── Singleton ───────────────────────────────────────────────────────────

let stripeAdapterInstance: StripeCredentialProviderAdapter | null = null;

export function getStripeCredentialAdapter(): StripeCredentialProviderAdapter {
  if (!stripeAdapterInstance) {
    stripeAdapterInstance = new StripeCredentialProviderAdapter();
  }
  return stripeAdapterInstance;
}
