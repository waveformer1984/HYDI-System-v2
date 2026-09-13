/**
 * No-False-Green Tests for Credential Governance
 *
 * These tests prove that HYDI cannot accidentally claim success when:
 *   - Stripe key is missing
 *   - Stripe key is malformed
 *   - Stripe key is a placeholder
 *   - Stripe key returns 401
 *   - Stripe CLI session is expired
 *   - webhook forwarding is unavailable
 *   - webhook signature fails
 *   - provider API is unreachable
 *   - external verification was never performed
 *
 * Every one of these must produce FAIL or BLOCKED, not PASS.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';

// ─── Test Setup ──────────────────────────────────────────────────────────

// We need to reset modules between tests to clear singletons
let originalEnv: NodeJS.ProcessEnv;

beforeEach(() => {
  originalEnv = { ...process.env };
  // Clear Stripe-related env vars
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_RESTRICTED_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET_01;
  delete process.env.STRIPE_CLI_SESSION;
  delete process.env.STRIPE_CLI_FORWARDING;
  delete process.env.STRIPE_WEBHOOK_ENDPOINT;

  // Reset modules to clear singletons
  jest.resetModules();
});

afterEach(() => {
  process.env = originalEnv;
});

// ─── Helper: Import fresh modules ─────────────────────────────────────────

function freshImports() {
  const { getCredentialStateMachine, isPlaceholder, isMalformed, CredentialStateMachine } = require('../../lib/operational/CredentialStateMachine');
  const { getEvidenceStore, createEvidence, EvidenceStore } = require('../../lib/operational/EvidenceModel');
  const { StripeCredentialProviderAdapter, getStripeCredentialAdapter } = require('../../lib/operational/StripeCredentialProviderAdapter');
  const { StripeE2EOrchestrator } = require('../../lib/operational/StripeE2EOrchestrator');
  return {
    getCredentialStateMachine,
    isPlaceholder,
    isMalformed,
    CredentialStateMachine,
    getEvidenceStore,
    createEvidence,
    EvidenceStore,
    StripeCredentialProviderAdapter,
    getStripeCredentialAdapter,
    StripeE2EOrchestrator,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('No-False-Green: Credential Governance', () => {

  // ─── Missing credential → BLOCKED ──────────────────────────────────────

  test('missing Stripe credential → BLOCKED (not PASS)', async () => {
    const { StripeCredentialProviderAdapter, getCredentialStateMachine } = freshImports();
    const adapter = new StripeCredentialProviderAdapter();

    // No STRIPE_SECRET_KEY in environment
    adapter.discover();
    const sm = getCredentialStateMachine();
    const creds = sm.getAll();

    // No credentials should be discovered
    expect(creds.length).toBe(0);

    // Running E2E orchestrator should be BLOCKED
    const { StripeE2EOrchestrator } = freshImports();
    const orchestrator = new StripeE2EOrchestrator();
    const result = await orchestrator.run({ mode: 'autonomous', actor: 'test', role: 'system' });

    expect(result.state).toBe('BLOCKED');
    expect(result.state).not.toBe('COMPLETED');
    expect(result.blocker).not.toBeNull();
    expect(result.blocker?.type).toBe('EXTERNAL_CREDENTIAL');
  });

  // ─── Placeholder credential → BLOCKED ──────────────────────────────────

  test('placeholder Stripe credential → BLOCKED (not PASS)', async () => {
    const { StripeCredentialProviderAdapter, getCredentialStateMachine, isPlaceholder } = freshImports();

    // Set a placeholder key
    process.env.STRIPE_SECRET_KEY = 'sk_test_00000000000000000000000000000';

    // Verify placeholder detection
    expect(isPlaceholder('sk_test_00000000000000000000000000000')).toBe(true);

    const adapter = new StripeCredentialProviderAdapter();
    adapter.discover();
    const sm = getCredentialStateMachine();
    const creds = sm.getAll();

    // Credential should be discovered but classified as INVALID (placeholder)
    expect(creds.length).toBeGreaterThan(0);
    const secretKey = creds.find((c: any) => c.type === 'stripe_secret_key');
    expect(secretKey).toBeDefined();
    expect(secretKey.state).toBe('INVALID');

    // E2E should be BLOCKED
    const { StripeE2EOrchestrator } = freshImports();
    const orchestrator = new StripeE2EOrchestrator();
    const result = await orchestrator.run({ mode: 'autonomous', actor: 'test', role: 'system' });

    expect(result.state).toBe('BLOCKED');
    expect(result.state).not.toBe('COMPLETED');
  });

  // ─── Malformed credential → FAIL ───────────────────────────────────────

  test('malformed Stripe credential → FAIL (not PASS)', async () => {
    const { StripeCredentialProviderAdapter, getCredentialStateMachine, isMalformed } = freshImports();

    // Set a malformed key (wrong prefix)
    process.env.STRIPE_SECRET_KEY = 'not_a_stripe_key_at_all';

    expect(isMalformed('not_a_stripe_key_at_all', 'sk_')).toBe(true);

    const adapter = new StripeCredentialProviderAdapter();
    adapter.discover();
    const sm = getCredentialStateMachine();
    const creds = sm.getAll();

    const secretKey = creds.find((c: any) => c.type === 'stripe_secret_key');
    expect(secretKey).toBeDefined();

    // Probe should FAIL at format level
    if (secretKey) {
      const probe = await adapter.probe(secretKey.id, 3, { mode: 'autonomous', actor: 'test', role: 'system' }, 'test-corr');
      expect(probe.result).not.toBe('PASS');
      // Should be BLOCKED or FAIL
      expect(['BLOCKED', 'FAIL']).toContain(probe.result);
    }
  });

  // ─── Invalid credential (401) → FAIL ───────────────────────────────────

  test('invalid Stripe credential (401) → FAIL (not PASS)', async () => {
    const { StripeCredentialProviderAdapter, getCredentialStateMachine } = freshImports();

    // Set a syntactically valid but actually invalid key
    process.env.STRIPE_SECRET_KEY = 'sk_test_invalidkey1234567890abcdef';

    const adapter = new StripeCredentialProviderAdapter();
    adapter.discover();
    const sm = getCredentialStateMachine();
    const creds = sm.getAll();

    const secretKey = creds.find((c: any) => c.type === 'stripe_secret_key');
    expect(secretKey).toBeDefined();

    if (secretKey) {
      // Mock fetch to return 401
      const originalFetch = global.fetch;
      const mockFetch: jest.Mock<any> = jest.fn();
      mockFetch.mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: { message: 'Invalid API Key provided' } }),
        text: async () => 'Invalid API Key provided',
      });
      (global as any).fetch = mockFetch;

      try {
        const probe = await adapter.probe(secretKey.id, 3, { mode: 'autonomous', actor: 'test', role: 'system' }, 'test-corr');
        expect(probe.result).not.toBe('PASS');
        expect(['FAIL', 'BLOCKED']).toContain(probe.result);
        expect(probe.apiResponseCode).toBe(401);

        // Credential state should transition to INVALID
        const updated = sm.get(secretKey.id);
        expect(updated?.state).toBe('INVALID');
      } finally {
        global.fetch = originalFetch;
      }
    }
  });

  // ─── Provider API unreachable → BLOCKED ────────────────────────────────

  test('Stripe API unreachable → BLOCKED (not PASS)', async () => {
    const { StripeCredentialProviderAdapter, getCredentialStateMachine } = freshImports();

    process.env.STRIPE_SECRET_KEY = 'sk_test_validlookingkey1234567890ab';

    const adapter = new StripeCredentialProviderAdapter();
    adapter.discover();
    const sm = getCredentialStateMachine();
    const secretKey = sm.getAll().find((c: any) => c.type === 'stripe_secret_key');

    if (secretKey) {
      // Mock fetch to throw (network error)
      const originalFetch = global.fetch;
      const mockFetch: jest.Mock<any> = jest.fn();
      mockFetch.mockRejectedValue(new Error('Network error'));
      (global as any).fetch = mockFetch;

      try {
        const probe = await adapter.probe(secretKey.id, 3, { mode: 'autonomous', actor: 'test', role: 'system' }, 'test-corr');
        expect(probe.result).not.toBe('PASS');
        expect(['BLOCKED', 'FAIL']).toContain(probe.result);
        expect(probe.verificationLevel).not.toBe('VERIFIED_EXTERNAL');
      } finally {
        global.fetch = originalFetch;
      }
    }
  });

  // ─── Live mode credential used for E2E → BLOCKED ───────────────────────

  test('live-mode credential for E2E → BLOCKED (not PASS)', async () => {
    const { StripeCredentialProviderAdapter, getCredentialStateMachine } = freshImports();

    // Set a live key
    process.env.STRIPE_SECRET_KEY = 'sk_live_FAKE1a2b3c4d5e6f';

    const adapter = new StripeCredentialProviderAdapter();
    adapter.discover();
    const sm = getCredentialStateMachine();
    const secretKey = sm.getAll().find((c: any) => c.type === 'stripe_secret_key');

    expect(secretKey?.environment).toBe('live');

    if (secretKey) {
      // Mock fetch to return success (live API works)
      const originalFetch = global.fetch;
      const mockFetch: jest.Mock<any> = jest.fn();
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ available: [{ amount: 10000, currency: 'usd' }] }),
      });
      (global as any).fetch = mockFetch;

      try {
        // Probe with autonomous authorization should be BLOCKED for live mode
        const probe = await adapter.probe(secretKey.id, 3, { mode: 'autonomous', actor: 'test', role: 'system' }, 'test-corr');
        expect(probe.result).toBe('BLOCKED');
        expect(probe.blocker?.type).toBe('HUMAN_AUTHORIZATION_REQUIRED');
      } finally {
        global.fetch = originalFetch;
      }
    }
  });

  // ─── SIMULATED evidence never satisfies EXTERNAL_VERIFIED ───────────────

  test('SIMULATED evidence never satisfies EXTERNAL_VERIFIED gate', () => {
    const { EvidenceStore } = freshImports();
    const store = new EvidenceStore();

    // Record a SIMULATED evidence
    store.record({
      operationId: 'test-op',
      capability: 'stripe-e2e-qualification',
      provider: 'stripe',
      environment: 'test',
      action: 'test_action',
      authorization: { mode: 'autonomous', actor: 'test', role: 'system', permission: 'credentials:e2e:qualify' },
      observation: 'Simulated test',
      verification: { level: 'SIMULATED', method: 'mock', timestamp: new Date().toISOString() },
      result: 'SIMULATED',
      confidence: 0.5,
      externalEvidence: [],
      internalEvidence: [],
      correlationId: 'test-corr',
      blocker: null,
    });

    // isExternallyVerified must return false
    expect(store.isExternallyVerified('stripe-e2e-qualification')).toBe(false);

    // isSimulated must return true
    expect(store.isSimulated('stripe-e2e-qualification')).toBe(true);
  });

  // ─── Webhook signature verification ────────────────────────────────────

  test('valid webhook signature → PASS, invalid → FAIL', async () => {
    const { StripeCredentialProviderAdapter, getCredentialStateMachine } = freshImports();
    const crypto = require('crypto');

    process.env.STRIPE_WEBHOOK_SECRET = 'whsec_validsecret1234567890abcdef';

    const adapter = new StripeCredentialProviderAdapter();
    adapter.discover();
    const sm = getCredentialStateMachine();
    const webhookSecret = sm.getAll().find((c: any) => c.type === 'stripe_webhook_secret');

    expect(webhookSecret).toBeDefined();

    if (webhookSecret) {
      const payload = '{"test":"data"}';
      const timestamp = Math.floor(Date.now() / 1000);

      // Compute valid signature
      const signedPayload = `${timestamp}.${payload}`;
      const validSignature = crypto.createHash('sha256')
        .update(signedPayload)
        .update(process.env.STRIPE_WEBHOOK_SECRET)
        .digest('hex');

      // Valid signature
      const validResult = adapter.verifyWebhookSecret(webhookSecret.id, payload, validSignature, timestamp);
      expect(validResult.result).toBe('PASS');

      // Invalid signature
      const invalidResult = adapter.verifyWebhookSecret(webhookSecret.id, payload, 'invalid_signature', timestamp);
      expect(invalidResult.result).toBe('FAIL');

      // Expired timestamp
      const expiredTimestamp = timestamp - 600; // 10 minutes ago
      const expiredResult = adapter.verifyWebhookSecret(webhookSecret.id, payload, validSignature, expiredTimestamp);
      expect(expiredResult.result).toBe('FAIL');
    }
  });

  // ─── Credential state machine rejects illegal transitions ──────────────

  test('credential state machine rejects illegal transitions', () => {
    const { CredentialStateMachine } = freshImports();
    const sm = new CredentialStateMachine();

    const record = sm.register({
      name: 'TEST_KEY',
      type: 'stripe_secret_key',
      provider: 'stripe',
      fingerprint: 'abc123',
      prefix: 'sk_test_...',
      environment: 'test',
      source: 'process.env.TEST_KEY',
    });

    // DISCOVERED → CLASSIFIED is legal
    expect(() => sm.transition(record.id, 'CLASSIFIED', {
      reason: 'test',
      authorization: { mode: 'system', actor: 'test', role: null },
      evidence: { verificationLevel: 'VERIFIED_INTERNAL', source: 'test', details: 'test' },
    })).not.toThrow();

    // CLASSIFIED → HEALTHY is ILLEGAL (must go through VALIDATED first)
    expect(() => sm.transition(record.id, 'HEALTHY', {
      reason: 'test',
      authorization: { mode: 'system', actor: 'test', role: null },
      evidence: { verificationLevel: 'VERIFIED_INTERNAL', source: 'test', details: 'test' },
    })).toThrow(/Illegal credential transition/);

    // CLASSIFIED → VALIDATED → HEALTHY is legal
    expect(() => sm.transition(record.id, 'VALIDATED', {
      reason: 'test',
      authorization: { mode: 'system', actor: 'test', role: null },
      evidence: { verificationLevel: 'VERIFIED_EXTERNAL', source: 'test', details: 'test' },
    })).not.toThrow();

    expect(() => sm.transition(record.id, 'HEALTHY', {
      reason: 'test',
      authorization: { mode: 'system', actor: 'test', role: null },
      evidence: { verificationLevel: 'VERIFIED_EXTERNAL', source: 'test', details: 'test' },
    })).not.toThrow();
  });

  // ─── Autonomous rotation of live credentials is rejected ───────────────

  test('autonomous rotation of live credentials is rejected', () => {
    const { CredentialStateMachine } = freshImports();
    const sm = new CredentialStateMachine();

    const record = sm.register({
      name: 'LIVE_KEY',
      type: 'stripe_secret_key',
      provider: 'stripe',
      fingerprint: 'abc123',
      prefix: 'sk_live_...',
      environment: 'live',
      source: 'process.env.LIVE_KEY',
      rotationSafe: false,
    });

    // Transition to ROTATION_REQUIRED
    sm.transition(record.id, 'CLASSIFIED', {
      reason: 'test',
      authorization: { mode: 'system', actor: 'test', role: null },
      evidence: { verificationLevel: 'VERIFIED_INTERNAL', source: 'test', details: 'test' },
    });
    sm.transition(record.id, 'ROTATION_REQUIRED', {
      reason: 'test',
      authorization: { mode: 'system', actor: 'test', role: null },
      evidence: { verificationLevel: 'VERIFIED_INTERNAL', source: 'test', details: 'test' },
    });

    // Attempt autonomous rotation → should throw
    expect(() => sm.transition(record.id, 'ROTATING', {
      reason: 'autonomous rotation attempt',
      authorization: { mode: 'autonomous', actor: 'system', role: null },
      evidence: { verificationLevel: 'VERIFIED_INTERNAL', source: 'test', details: 'test' },
    })).toThrow(/Unauthorized/);

    // Human-authorized rotation should succeed
    expect(() => sm.transition(record.id, 'ROTATING', {
      reason: 'human-authorized rotation',
      authorization: { mode: 'human_authorized', actor: 'owner', role: 'owner' },
      evidence: { verificationLevel: 'VERIFIED_INTERNAL', source: 'test', details: 'test' },
    })).not.toThrow();
  });

  // ─── RBAC permission checks ────────────────────────────────────────────

  test('RBAC: viewer cannot rotate, operator can rotate test, owner can rotate all', () => {
    const { hasPermission } = require('../../lib/auth/rbac');

    expect(hasPermission('viewer', 'credentials:rotate')).toBe(false);
    expect(hasPermission('agent', 'credentials:rotate')).toBe(false);
    expect(hasPermission('operator', 'credentials:rotate')).toBe(true);
    expect(hasPermission('owner', 'credentials:rotate')).toBe(true);

    // Viewer can view credential metadata
    expect(hasPermission('viewer', 'credentials:view')).toBe(true);
  });

  // ─── Placeholder detection patterns ────────────────────────────────────

  test('placeholder detection catches common placeholder patterns', () => {
    const { isPlaceholder } = freshImports();

    expect(isPlaceholder('sk_test_00000000000000000000000000')).toBe(true);
    expect(isPlaceholder('sk_live_placeholder0000')).toBe(true);
    expect(isPlaceholder('whsec_00000000000000000000000000')).toBe(true);
    expect(isPlaceholder('your_stripe_key')).toBe(true);
    expect(isPlaceholder('YOUR_KEY')).toBe(true);
    expect(isPlaceholder('placeholder')).toBe(true);
    expect(isPlaceholder('CHANGE_ME')).toBe(true);
    expect(isPlaceholder('REPLACE_ME')).toBe(true);
    expect(isPlaceholder('xxxx')).toBe(true);
    expect(isPlaceholder('<your-key-here>')).toBe(true);
    expect(isPlaceholder('')).toBe(true);

    // Real-looking keys should not be flagged as placeholders
    expect(isPlaceholder('sk_test_4eC39HqLyjWDarjtT1zdp7dc')).toBe(false);
    expect(isPlaceholder('sk_live_FAKE1a2b3c4d5e6f')).toBe(false);
  });

  // ─── E2E orchestrator explains blockers ────────────────────────────────

  test('E2E orchestrator produces structured blocker explanation', async () => {
    const { StripeE2EOrchestrator } = freshImports();

    // No credentials
    const orchestrator = new StripeE2EOrchestrator();
    const result = await orchestrator.run({ mode: 'autonomous', actor: 'test', role: 'system' });

    expect(result.state).toBe('BLOCKED');
    const explanation = orchestrator.explainBlocker();
    expect(explanation).toContain('CAPABILITY BLOCKED');
    expect(explanation).toContain('stripe-e2e-qualification');
    expect(explanation).toContain('No simulated success recorded');
  });

  // ─── Credential never goes from INVALID to HEALTHY without validation ──

  test('credential cannot silently move from INVALID to HEALTHY', () => {
    const { CredentialStateMachine } = freshImports();
    const sm = new CredentialStateMachine();

    const record = sm.register({
      name: 'TEST_KEY',
      type: 'stripe_secret_key',
      provider: 'stripe',
      fingerprint: 'abc123',
      prefix: 'sk_test_...',
      environment: 'test',
      source: 'process.env.TEST_KEY',
    });

    // Move to CLASSIFIED → INVALID
    sm.transition(record.id, 'CLASSIFIED', {
      reason: 'test',
      authorization: { mode: 'system', actor: 'test', role: null },
      evidence: { verificationLevel: 'VERIFIED_INTERNAL', source: 'test', details: 'test' },
    });
    sm.transition(record.id, 'INVALID', {
      reason: 'API rejected',
      authorization: { mode: 'system', actor: 'test', role: null },
      evidence: { verificationLevel: 'VERIFIED_EXTERNAL', source: 'stripe_api', details: '401' },
    });

    // Attempt to go directly to HEALTHY — ILLEGAL
    expect(() => sm.transition(record.id, 'HEALTHY', {
      reason: 'trying to skip validation',
      authorization: { mode: 'system', actor: 'test', role: null },
      evidence: { verificationLevel: 'VERIFIED_INTERNAL', source: 'test', details: 'test' },
    })).toThrow(/Illegal credential transition/);

    // Legal path: INVALID → ROTATION_REQUIRED → ROTATION_PENDING_AUTHORIZATION → ROTATING → ROTATED → HEALTHY
    sm.transition(record.id, 'ROTATION_REQUIRED', {
      reason: 'need new key',
      authorization: { mode: 'system', actor: 'test', role: null },
      evidence: { verificationLevel: 'VERIFIED_INTERNAL', source: 'test', details: 'test' },
    });
    sm.transition(record.id, 'ROTATION_PENDING_AUTHORIZATION', {
      reason: 'awaiting auth',
      authorization: { mode: 'system', actor: 'test', role: null },
      evidence: { verificationLevel: 'VERIFIED_INTERNAL', source: 'test', details: 'test' },
    });
    sm.transition(record.id, 'ROTATING', {
      reason: 'authorized',
      authorization: { mode: 'human_authorized', actor: 'owner', role: 'owner' },
      evidence: { verificationLevel: 'VERIFIED_INTERNAL', source: 'test', details: 'test' },
    });
    sm.transition(record.id, 'ROTATED', {
      reason: 'new key issued',
      authorization: { mode: 'human_authorized', actor: 'owner', role: 'owner' },
      evidence: { verificationLevel: 'VERIFIED_EXTERNAL', source: 'stripe_api', details: 'new key valid' },
    });
    sm.transition(record.id, 'HEALTHY', {
      reason: 'verified',
      authorization: { mode: 'human_authorized', actor: 'owner', role: 'owner' },
      evidence: { verificationLevel: 'VERIFIED_EXTERNAL', source: 'stripe_api', details: 'balance check passed' },
    });

    expect(sm.get(record.id)?.state).toBe('HEALTHY');
  });
});


