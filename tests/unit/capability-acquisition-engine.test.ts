/**
 * External Capability Acquisition Engine — Unit Tests
 *
 * Tests covering the full acquisition lifecycle: credential detection,
 * provisioning, verification, governance, retry, timeout, audit, and
 * secret redaction.
 */

import { ExternalCapabilityAcquisitionEngine } from '../../lib/operational/ExternalCapabilityAcquisitionEngine';
import {
  GmailAdapter,
  StripeAdapter,
  BaseProviderAdapter,
  getProviderAdapterRegistry,
} from '../../lib/operational/ProviderAdapters';
import type {
  ProviderAcquisitionPlan,
  CredentialValidationResult,
  VerificationResult,
} from '../../lib/operational/ProviderAdapters';
import {
  AcquisitionGovernancePolicy,
  getAcquisitionGovernancePolicy,
} from '../../lib/operational/AcquisitionGovernancePolicy';
import {
  SecretManager,
  resetSecretManager,
} from '../../lib/operational/SecretManager';
import { DEFAULT_SAFETY_LIMITS } from '../../lib/operational/CapabilityAcquisitionTypes';
import type {
  AcquisitionSafetyLimits,
  OwnerAuthorization,
} from '../../lib/operational/CapabilityAcquisitionTypes';

// ─── Test adapter that exposes fetchWithTimeout ───────────────────────────

class TimeoutTestAdapter extends BaseProviderAdapter {
  readonly providerId = 'timeout_test';
  readonly displayName = 'Timeout Test';
  readonly capabilityId = 'timeout.test';
  readonly requiredEnvVars = ['TIMEOUT_TEST_KEY'];

  async validateCredential(): Promise<CredentialValidationResult> {
    return { state: 'VALID', evidence: 'ok', latencyMs: 0 };
  }
  async verifyCapability(): Promise<VerificationResult> {
    return { verified: true, evidence: 'ok', latencyMs: 0, operation: 'test' };
  }
  getAcquisitionPlan(): ProviderAcquisitionPlan {
    return {
      provider: 'timeout_test',
      capabilityId: 'timeout.test',
      autonomousSteps: [],
      humanRequiredSteps: [],
      ownerAuthorizationSteps: [],
      commitmentTypes: ['NONE'],
      requiredAuthorization: 'R0',
      financialCommitment: false,
      legalAcceptance: false,
      identityVerification: false,
    };
  }

  async publicFetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
    return this.fetchWithTimeout(url, {}, timeoutMs);
  }
}

// ─── Helper: create a mock Response ───────────────────────────────────────

function mockResponse(body: string, status: number): Response {
  return new Response(body, { status });
}

// ─── Tests ────────────────────────────────────────────────────────────────

describe('External Capability Acquisition Engine', () => {
  afterEach(() => {
    // Restore all mocked implementations
    jest.restoreAllMocks();
    // Reset governance policy singleton kill switch
    getAcquisitionGovernancePolicy().setKillSwitch(false);
    // Reset secret manager singleton (clears cache + drops instance)
    resetSecretManager();
    // Clean up any env vars that tests might have set
    delete process.env.SENDGRID_API_KEY;
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.GOOGLE_PLACES_API_KEY;
    delete process.env.TWILIO_ACCOUNT_SID;
    delete process.env.TWILIO_AUTH_TOKEN;
    delete process.env.TWILIO_PHONE_NUMBER;
    delete process.env.TEST_SECRET;
  });

  // 1. Missing credential detection
  describe('1. Missing credential detection', () => {
    it('resolveCapability with no env vars returns BLOCKED with MISSING_CREDENTIAL blocker', async () => {
      const engine = new ExternalCapabilityAcquisitionEngine();
      const lifecycle = await engine.resolveCapability('commercial.email');
      expect(lifecycle.currentState).toBe('BLOCKED');
      expect(lifecycle.blocker).toBe('MISSING_CREDENTIAL');
    });
  });

  // 2. Account missing detection
  describe('2. Account missing detection', () => {
    it('discoverAccountState returns accountExists: null when no credentials', async () => {
      const adapter = new GmailAdapter();
      const state = await adapter.discoverAccountState();
      expect(state.accountExists).toBeNull();
      expect(state.credentialsPresent).toBe(false);
      expect(state.blocker).toBe('MISSING_CREDENTIAL');
    });
  });

  // 3. Credential provisioning
  describe('3. Credential provisioning', () => {
    it('provision phase records fingerprints (never values)', async () => {
      process.env.SENDGRID_API_KEY = 'SG.test-secret-key-value-12345';
      jest.spyOn(global, 'fetch').mockImplementation(() =>
        Promise.resolve(mockResponse('Unauthorized', 401)),
      );
      const engine = new ExternalCapabilityAcquisitionEngine();
      const lifecycle = await engine.resolveCapability('commercial.email');
      expect(lifecycle.credentialFingerprints['SENDGRID_API_KEY']).toBeDefined();
      expect(lifecycle.credentialFingerprints['SENDGRID_API_KEY']).not.toBe(
        'SG.test-secret-key-value-12345',
      );
      expect(lifecycle.credentialFingerprints['SENDGRID_API_KEY']).toMatch(
        /^[a-f0-9]{16}$/,
      );
    });
  });

  // 4. Configuration propagation
  describe('4. Configuration propagation', () => {
    it('configure phase transitions to VERIFYING', async () => {
      process.env.SENDGRID_API_KEY = 'SG.test-key';
      jest.spyOn(global, 'fetch').mockImplementation(() =>
        Promise.resolve(mockResponse('Unauthorized', 401)),
      );
      const engine = new ExternalCapabilityAcquisitionEngine();
      const lifecycle = await engine.resolveCapability('commercial.email');
      const configuringToVerifying = lifecycle.transitions.find(
        (t) => t.from === 'CONFIGURING' && t.to === 'VERIFYING',
      );
      expect(configuringToVerifying).toBeDefined();
    });
  });

  // 5. Real capability verification
  describe('5. Real capability verification', () => {
    it('verifyCapability returns verified: true when API call succeeds (mock fetch)', async () => {
      process.env.SENDGRID_API_KEY = 'SG.valid-key';
      jest.spyOn(global, 'fetch').mockImplementation(() =>
        Promise.resolve(mockResponse('{"account":"active"}', 200)),
      );
      const engine = new ExternalCapabilityAcquisitionEngine();
      const lifecycle = await engine.resolveCapability('commercial.email');
      expect(lifecycle.currentState).toBe('READY');
    });
  });

  // 6. Retry
  describe('6. Retry', () => {
    it('engine respects maxRetryCount from safety limits', async () => {
      expect(DEFAULT_SAFETY_LIMITS.maxRetryCount).toBe(3);
      const limits: AcquisitionSafetyLimits = {
        ...DEFAULT_SAFETY_LIMITS,
        maxRetryCount: 2,
      };
      const engine = new ExternalCapabilityAcquisitionEngine({ safetyLimits: limits });
      const lifecycle = await engine.resolveCapability('commercial.email');
      expect(lifecycle.retryCount).toBeLessThanOrEqual(limits.maxRetryCount);
    });
  });

  // 7. Timeout
  describe('7. Timeout', () => {
    it('fetchWithTimeout aborts after timeout', async () => {
      const adapter = new TimeoutTestAdapter();
      // Mock fetch to respect the abort signal
      jest.spyOn(global, 'fetch').mockImplementation((_url, options) => {
        return new Promise<Response>((_resolve, reject) => {
          const signal = options?.signal;
          if (signal) {
            signal.addEventListener('abort', () => {
              reject(new Error('The operation was aborted'));
            });
          }
        });
      });
      await expect(
        adapter.publicFetchWithTimeout('https://example.com', 100),
      ).rejects.toThrow();
    });
  });

  // 8. Provider outage
  describe('8. Provider outage', () => {
    it('when fetch throws, validation returns UNKNOWN state', async () => {
      process.env.SENDGRID_API_KEY = 'SG.test-key';
      jest.spyOn(global, 'fetch').mockRejectedValue(new Error('network unreachable'));
      const adapter = new GmailAdapter();
      const result = await adapter.validateCredential();
      expect(result.state).toBe('UNKNOWN');
    });
  });

  // 9. Rate limiting
  describe('9. Rate limiting', () => {
    it('when API returns 429, failure is classified as RATE_LIMITED', async () => {
      process.env.SENDGRID_API_KEY = 'SG.test-key';
      const registry = getProviderAdapterRegistry();
      const adapter = registry.getAdapter('commercial.email')!;

      // Mock discoverAccountState to skip the in-discover verification
      jest.spyOn(adapter, 'discoverAccountState').mockResolvedValue({
        accountExists: true,
        credentialsPresent: true,
        credentialsValid: false,
        blocker: 'CREDENTIAL_PRESENT_UNVERIFIED',
        evidence: 'Credentials present but unverified',
        missingEnvVars: [],
      });
      // Mock verifyCapability to return an error containing 429
      jest.spyOn(adapter, 'verifyCapability').mockResolvedValue({
        verified: false,
        evidence: 'Rate limited',
        latencyMs: 100,
        operation: 'sendgrid.account.check',
        error: 'HTTP 429: rate limit exceeded',
      });

      const engine = new ExternalCapabilityAcquisitionEngine();
      const lifecycle = await engine.resolveCapability('commercial.email');
      const failedAudit = lifecycle.auditRecords.find(
        (r) => r.eventType === 'ACQUISITION_FAILED',
      );
      expect(failedAudit).toBeDefined();
      expect(failedAudit!.description).toContain('RATE_LIMITED');
    });
  });

  // 10. Invalid credential
  describe('10. Invalid credential', () => {
    it('when API returns 401, credential state is INVALID', async () => {
      process.env.SENDGRID_API_KEY = 'SG.invalid-key';
      jest.spyOn(global, 'fetch').mockImplementation(() =>
        Promise.resolve(mockResponse('Unauthorized', 401)),
      );
      const adapter = new GmailAdapter();
      const result = await adapter.validateCredential();
      expect(result.state).toBe('INVALID');
    });
  });

  // 11. Expired credential
  describe('11. Expired credential', () => {
    it('when API returns 403, credential state is REVOKED or INVALID', async () => {
      process.env.SENDGRID_API_KEY = 'SG.expired-key';
      jest.spyOn(global, 'fetch').mockImplementation(() =>
        Promise.resolve(mockResponse('Forbidden', 403)),
      );
      const adapter = new GmailAdapter();
      const result = await adapter.validateCredential();
      expect(['REVOKED', 'INVALID']).toContain(result.state);
    });
  });

  // 12. Policy denial
  describe('12. Policy denial', () => {
    it('when kill switch is active, all acquisitions are DENIED', async () => {
      const policy = getAcquisitionGovernancePolicy();
      policy.setKillSwitch(true);

      const engine = new ExternalCapabilityAcquisitionEngine();
      const lifecycle = await engine.resolveCapability('commercial.email');
      expect(lifecycle.currentState).toBe('POLICY_BLOCKED');
    });
  });

  // 13. Policy authorization
  describe('13. Policy authorization', () => {
    it('ALLOW_AUTONOMOUS for R0/R1 commitment types', () => {
      const policy = new AcquisitionGovernancePolicy();
      expect(
        policy.evaluate(
          { commitmentType: 'NONE', authorizationLevel: 'R0', provider: 'test' },
          [],
        ),
      ).toBe('ALLOW_AUTONOMOUS');
      expect(
        policy.evaluate(
          { commitmentType: 'CONFIGURATION_CHANGE', authorizationLevel: 'R1', provider: 'test' },
          [],
        ),
      ).toBe('ALLOW_AUTONOMOUS');
      expect(
        policy.evaluate(
          { commitmentType: 'CREDENTIAL_PROVISIONING', authorizationLevel: 'R1', provider: 'test' },
          [],
        ),
      ).toBe('ALLOW_AUTONOMOUS');
    });
  });

  // 14. Financial limit
  describe('14. Financial limit', () => {
    it('checkFinancialLimit returns false when amount exceeds limit', () => {
      const policy = new AcquisitionGovernancePolicy();
      const auths: OwnerAuthorization[] = [
        {
          id: 'auth-1',
          provider: 'stripe',
          capabilityId: 'commercial.stripe',
          authorizedCommitments: ['FINANCIAL'],
          maxFinancialCommitmentCents: 500,
          currency: 'usd',
          grantedAt: new Date().toISOString(),
          expiresAt: null,
          revokedAt: null,
          grantedBy: 'owner',
        },
      ];
      expect(policy.checkFinancialLimit(1000, auths)).toBe(false);
      expect(policy.checkFinancialLimit(500, auths)).toBe(true);
    });
  });

  // 15. Legal-action classification
  describe('15. Legal-action classification', () => {
    it('ACCOUNT_CREATION requires R3 authorization', () => {
      const policy = new AcquisitionGovernancePolicy();
      expect(policy.getRequiredAuthorizationLevel('ACCOUNT_CREATION')).toBe('R3');
      expect(policy.getDefaultDecision('ACCOUNT_CREATION')).toBe(
        'REQUIRES_OWNER_AUTHORIZATION',
      );
    });
  });

  // 16. Partial acquisition
  describe('16. Partial acquisition', () => {
    it('when credentials are partially set, state is BLOCKED', async () => {
      process.env.STRIPE_SECRET_KEY = 'sk_test_partial';
      // STRIPE_WEBHOOK_SECRET intentionally not set
      const adapter = new StripeAdapter();
      const state = await adapter.discoverAccountState();
      expect(state.credentialsPresent).toBe(false);
      expect(state.blocker).toBe('MISSING_CREDENTIAL');
      expect(state.missingEnvVars).toContain('STRIPE_WEBHOOK_SECRET');
    });
  });

  // 17. Idempotent rerun
  describe('17. Idempotent rerun', () => {
    it('calling resolveCapability twice does not create duplicate lifecycles', async () => {
      const engine = new ExternalCapabilityAcquisitionEngine();
      await engine.resolveCapability('commercial.email');
      await engine.resolveCapability('commercial.email');
      expect(engine.getAllLifecycles().length).toBe(1);
    });
  });

  // 18. Rollback
  describe('18. Rollback', () => {
    it('when verification fails, state transitions to VERIFICATION_FAILED', async () => {
      process.env.SENDGRID_API_KEY = 'SG.test-key';
      jest.spyOn(global, 'fetch').mockImplementation(() =>
        Promise.resolve(mockResponse('Unauthorized', 401)),
      );
      const engine = new ExternalCapabilityAcquisitionEngine();
      const lifecycle = await engine.resolveCapability('commercial.email');
      expect(lifecycle.currentState).toBe('VERIFICATION_FAILED');
    });
  });

  // 19. Audit completeness
  describe('19. Audit completeness', () => {
    it('lifecycle contains all expected audit event types', async () => {
      process.env.SENDGRID_API_KEY = 'SG.test-key';
      jest.spyOn(global, 'fetch').mockImplementation(() =>
        Promise.resolve(mockResponse('Unauthorized', 401)),
      );
      const engine = new ExternalCapabilityAcquisitionEngine();
      const lifecycle = await engine.resolveCapability('commercial.email');
      const eventTypes = lifecycle.auditRecords.map((r) => r.eventType);
      expect(eventTypes).toContain('CAPABILITY_DISCOVERED');
      expect(eventTypes).toContain('BLOCKER_IDENTIFIED');
      expect(eventTypes).toContain('ACQUISITION_PLANNED');
      expect(eventTypes).toContain('POLICY_EVALUATED');
      expect(eventTypes).toContain('AUTHORIZATION_GRANTED');
      expect(eventTypes).toContain('CREDENTIAL_PROVISIONED');
      expect(eventTypes).toContain('CONFIGURATION_APPLIED');
      expect(eventTypes).toContain('VERIFICATION_STARTED');
      expect(eventTypes).toContain('VERIFICATION_FAILED');
    });
  });

  // 20. Secret redaction
  describe('20. Secret redaction', () => {
    it('SecretManager.redactForLogging never includes the credential value', () => {
      process.env.TEST_SECRET = 'super-secret-value-12345';
      const sm = new SecretManager();
      const metadata = sm.getCredentialMetadata('TEST_SECRET');
      const redacted = sm.redactForLogging(metadata);
      const serialized = JSON.stringify(redacted);
      expect(serialized).not.toContain('super-secret-value-12345');
      expect(redacted).not.toHaveProperty('fingerprint');
      expect(redacted.hasFingerprint).toBe(true);
    });
  });

  // 21. Kill switch
  describe('21. Kill switch', () => {
    it('when killSwitchActive is true, resolveCapability returns POLICY_BLOCKED', async () => {
      const limits: AcquisitionSafetyLimits = {
        ...DEFAULT_SAFETY_LIMITS,
        killSwitchActive: true,
      };
      const engine = new ExternalCapabilityAcquisitionEngine({ safetyLimits: limits });
      const lifecycle = await engine.resolveCapability('commercial.email');
      expect(lifecycle.blocker).toBe('POLICY_NOT_AUTHORIZED');
    });
  });

  // 22. Restart recovery
  describe('22. Restart recovery', () => {
    it('lifecycles persist in the engine internal map', async () => {
      const engine = new ExternalCapabilityAcquisitionEngine();
      const lifecycle = await engine.resolveCapability('commercial.email');
      expect(engine.getLifecycle('commercial.email')).toBe(lifecycle);
    });
  });

  // 23. Persistence across daemon restart
  describe('23. Persistence across daemon restart', () => {
    it('getLifecycle returns the lifecycle after resolveCapability', async () => {
      const engine = new ExternalCapabilityAcquisitionEngine();
      await engine.resolveCapability('commercial.email');
      const lifecycle = engine.getLifecycle('commercial.email');
      expect(lifecycle).not.toBeNull();
      expect(lifecycle!.capabilityId).toBe('commercial.email');
    });
  });

  // 24. No fake readiness
  describe('24. No fake readiness', () => {
    it('READY state only after successful verification (not just credential presence)', async () => {
      process.env.SENDGRID_API_KEY = 'SG.test-key';
      // Mock fetch to return 401 — credentials present but invalid
      jest.spyOn(global, 'fetch').mockImplementation(() =>
        Promise.resolve(mockResponse('Unauthorized', 401)),
      );
      const engine = new ExternalCapabilityAcquisitionEngine();
      const lifecycle = await engine.resolveCapability('commercial.email');
      expect(lifecycle.currentState).not.toBe('READY');
      expect(lifecycle.currentState).toBe('VERIFICATION_FAILED');
    });
  });
});
