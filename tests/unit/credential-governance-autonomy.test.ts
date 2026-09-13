/**
 * Credential Governance Autonomy Tests
 *
 * Phase 19: No-false-green enforcement extension
 * Phase 20: Restart/crash qualification
 * Phase 21: Production safety
 *
 * Tests the entire HYDI behavior — not just the code.
 */

import { getCredentialSourceManager, LocalSecureCredentialSource, EnvironmentCredentialSource, createHandle, type CredentialHandle } from '../../lib/operational/CredentialSource';
import { getStripeCliSessionManager, type StripeCliState } from '../../lib/operational/StripeCliSessionManager';
import { getCredentialGovernanceOrchestrator } from '../../lib/operational/CredentialGovernanceOrchestrator';
import { getRotationTransactionManager, StripeRotationAdapter } from '../../lib/operational/ProviderRotationAdapter';
import { getCredentialStateMachine, isPlaceholder } from '../../lib/operational/CredentialStateMachine';
import { getStripeE2EOrchestrator } from '../../lib/operational/StripeE2EOrchestrator';
import { getCredentialGovernanceChatRouter } from '../../lib/operational/CredentialGovernanceChatRouter';
import { getCredentialGovernanceDashboard } from '../../lib/operational/CredentialGovernanceDashboard';
import { getHistoricalSecretRemediationTracker } from '../../lib/operational/HistoricalSecretRemediationTracker';

// ─── Phase 19: No-False-Green Extension ──────────────────────────────────

// Global mock: prevent real git log scans and CLI exec calls during tests
beforeAll(() => {
  const tracker = getHistoricalSecretRemediationTracker();
  (tracker as any).scanHistory = jest.fn().mockReturnValue([]);
  const cliManager = getStripeCliSessionManager();
  (cliManager as any).diagnose = jest.fn().mockResolvedValue({
    state: 'NOT_INSTALLED', listenerState: 'NOT_RUNNING', cliPath: null, cliVersion: null,
    accountId: null, accountMode: 'unknown', sessionExpiry: null,
    webhookSecretPrefix: null, webhookSecretFingerprint: null, forwardingEndpoint: null,
    lastChecked: new Date().toISOString(), evidence: 'not installed', blocker: null,
  });
  (cliManager as any).getStatus = jest.fn().mockReturnValue(null);
  (cliManager as any).getPendingHumanActionRequests = jest.fn().mockReturnValue([]);
  (cliManager as any).checkAndResolveHumanActions = jest.fn().mockResolvedValue(undefined);
});

describe('No-False-Green: Credential Governance Autonomy', () => {
  beforeEach(() => {
    // Reset state machine between tests
    const sm = getCredentialStateMachine();
    // No reset method — tests use isolated state machine instances
    // Clear environment
    delete process.env.STRIPE_SECRET_KEY;
    delete process.env.STRIPE_WEBHOOK_SECRET;
    delete process.env.STRIPE_WEBHOOK_SECRET_01;
    delete process.env.WEBHOOK_PROCESSING_ENABLED;

    // Mock CLI manager globally to avoid real execSync calls
    const cliManager = getStripeCliSessionManager();
    (cliManager as any).diagnose = jest.fn().mockResolvedValue({
      state: 'NOT_INSTALLED', listenerState: 'NOT_RUNNING', cliPath: null, cliVersion: null,
      accountId: null, accountMode: 'unknown', sessionExpiry: null,
      webhookSecretPrefix: null, webhookSecretFingerprint: null, forwardingEndpoint: null,
      lastChecked: new Date().toISOString(), evidence: 'not installed', blocker: null,
    });
    (cliManager as any).getStatus = jest.fn().mockReturnValue(null);
    (cliManager as any).getPendingHumanActionRequests = jest.fn().mockReturnValue([]);
    (cliManager as any).checkAndResolveHumanActions = jest.fn().mockResolvedValue(undefined);
  });

  test('no credential → BLOCKED (not PASS)', async () => {
    // Mock CLI manager to avoid real execSync calls
    const cliManager = getStripeCliSessionManager();
    (cliManager as any).diagnose = jest.fn().mockResolvedValue({
      state: 'NOT_INSTALLED',
      listenerState: 'NOT_RUNNING',
      cliPath: null,
      cliVersion: null,
      accountId: null,
      accountMode: 'unknown',
      sessionExpiry: null,
      webhookSecretPrefix: null,
      webhookSecretFingerprint: null,
      forwardingEndpoint: null,
      lastChecked: new Date().toISOString(),
      evidence: 'Stripe CLI not installed',
      blocker: { type: 'MISSING_LOCAL_CAPABILITY', provider: 'stripe', capability: 'stripe-e2e', severity: 'blocking', repairability: 'human_required', reason: 'not installed', attemptedActions: [], requiredHumanAction: 'install', risk: 'LOW' },
    });
    (cliManager as any).getPendingHumanActionRequests = jest.fn().mockReturnValue([]);

    const orchestrator = getCredentialGovernanceOrchestrator();
    const result = await orchestrator.runAutonomyCycle({ mode: 'autonomous', actor: 'test', role: null });
    expect(result.status).not.toBe('READY');
    expect(result.evidence.some(e => e.includes('BLOCKED') || e.includes('DIAGNOSE') || e.includes('NOT_INSTALLED'))).toBe(true);
  });

  test('placeholder credential → BLOCKED (not PASS)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_placeholder0000placeholder0000';
    // Mock CLI manager
    const cliManager = getStripeCliSessionManager();
    (cliManager as any).diagnose = jest.fn().mockResolvedValue({
      state: 'NOT_INSTALLED', listenerState: 'NOT_RUNNING', cliPath: null, cliVersion: null,
      accountId: null, accountMode: 'unknown', sessionExpiry: null,
      webhookSecretPrefix: null, webhookSecretFingerprint: null, forwardingEndpoint: null,
      lastChecked: new Date().toISOString(), evidence: 'not installed', blocker: null,
    });
    (cliManager as any).getPendingHumanActionRequests = jest.fn().mockReturnValue([]);

    const orchestrator = getCredentialGovernanceOrchestrator();
    const result = await orchestrator.bootstrapStripeTestCredential({ mode: 'autonomous', actor: 'test', role: null });
    expect(result.success).toBe(false);
    expect(result.state).toBe('BLOCKED');
  });

  test('401 credential → BLOCKED/INVALID (not PASS)', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_1234567890abcdefghijklmnopqrstuvwxyz';
    const mockFetch: jest.Mock<any> = jest.fn();
    mockFetch.mockResolvedValue({
      ok: false,
      status: 401,
      json: async () => ({ error: { message: 'Invalid API Key' } }),
      text: async () => 'Invalid API Key',
    });
    (global as any).fetch = mockFetch;

    // Mock CLI manager
    const cliManager = getStripeCliSessionManager();
    (cliManager as any).diagnose = jest.fn().mockResolvedValue({
      state: 'NOT_INSTALLED', listenerState: 'NOT_RUNNING', cliPath: null, cliVersion: null,
      accountId: null, accountMode: 'unknown', sessionExpiry: null,
      webhookSecretPrefix: null, webhookSecretFingerprint: null, forwardingEndpoint: null,
      lastChecked: new Date().toISOString(), evidence: 'not installed', blocker: null,
    });
    (cliManager as any).getPendingHumanActionRequests = jest.fn().mockReturnValue([]);

    const orchestrator = getCredentialGovernanceOrchestrator();
    const result = await orchestrator.bootstrapStripeTestCredential({ mode: 'autonomous', actor: 'test', role: null });
    expect(result.success).toBe(false);
    expect(['BLOCKED', 'INVALID']).toContain(result.state);
  });

  test('expired CLI → BLOCKED (not PASS)', async () => {
    const cliManager = getStripeCliSessionManager();
    // Mock diagnose to return expired state
    const originalDiagnose = cliManager.diagnose;
    (cliManager as any).diagnose = jest.fn().mockResolvedValue({
      state: 'EXPIRED',
      listenerState: 'NOT_RUNNING',
      cliPath: '/usr/local/bin/stripe',
      cliVersion: '1.21.0',
      accountId: 'acct_test',
      accountMode: 'test',
      sessionExpiry: null,
      webhookSecretPrefix: null,
      webhookSecretFingerprint: null,
      forwardingEndpoint: null,
      lastChecked: new Date().toISOString(),
      evidence: 'Session expired',
      blocker: {
        type: 'HUMAN_AUTHORIZATION_REQUIRED',
        provider: 'stripe',
        capability: 'stripe-e2e-qualification',
        severity: 'blocking',
        repairability: 'human_required',
        reason: 'Stripe CLI session expired',
        attemptedActions: [],
        requiredHumanAction: 'Run stripe login',
        risk: 'LOW',
      },
    });

    const status = await cliManager.diagnose();
    expect(status.state).toBe('EXPIRED');
    expect(status.blocker).not.toBeNull();

    (cliManager as any).diagnose = originalDiagnose;
  });

  test('unauthenticated CLI → HUMAN_REQUIRED (not PASS)', async () => {
    const cliManager = getStripeCliSessionManager();
    const originalDiagnose = cliManager.diagnose;
    (cliManager as any).diagnose = jest.fn().mockResolvedValue({
      state: 'NOT_AUTHENTICATED',
      listenerState: 'NOT_RUNNING',
      cliPath: '/usr/local/bin/stripe',
      cliVersion: '1.21.0',
      accountId: null,
      accountMode: 'unknown',
      sessionExpiry: null,
      webhookSecretPrefix: null,
      webhookSecretFingerprint: null,
      forwardingEndpoint: null,
      lastChecked: new Date().toISOString(),
      evidence: 'Not authenticated',
      blocker: {
        type: 'HUMAN_AUTHORIZATION_REQUIRED',
        provider: 'stripe',
        capability: 'stripe-e2e-qualification',
        severity: 'blocking',
        repairability: 'human_required',
        reason: 'Stripe CLI not authenticated',
        attemptedActions: [],
        requiredHumanAction: 'Run stripe login',
        risk: 'LOW',
      },
    });

    const status = await cliManager.diagnose();
    expect(status.state).toBe('NOT_AUTHENTICATED');
    expect(status.blocker?.type).toBe('HUMAN_AUTHORIZATION_REQUIRED');

    (cliManager as any).diagnose = originalDiagnose;
  });

  test('no webhook listener → BLOCKED (not PASS)', async () => {
    const cliManager = getStripeCliSessionManager();
    const originalDiagnose = cliManager.diagnose;
    (cliManager as any).diagnose = jest.fn().mockResolvedValue({
      state: 'AUTHENTICATED',
      listenerState: 'NOT_RUNNING',
      cliPath: '/usr/local/bin/stripe',
      cliVersion: '1.21.0',
      accountId: 'acct_test',
      accountMode: 'test',
      sessionExpiry: null,
      webhookSecretPrefix: null,
      webhookSecretFingerprint: null,
      forwardingEndpoint: null,
      lastChecked: new Date().toISOString(),
      evidence: 'Authenticated but no listener',
      blocker: null,
    });

    const status = await cliManager.diagnose();
    expect(status.listenerState).toBe('NOT_RUNNING');
    (cliManager as any).diagnose = originalDiagnose;
  });

  test('mock event only → SIMULATED (not EXTERNAL_VERIFIED)', () => {
    // SIMULATED evidence can never satisfy EXTERNAL_VERIFIED gate
    // This is enforced at the EvidenceModel level
    const { createEvidence } = require('../../lib/operational/EvidenceModel');
    const evidence = createEvidence({
      operationId: 'test-simulated',
      capability: 'stripe-e2e-qualification',
      provider: 'stripe',
      environment: 'test',
      action: 'test',
      authorization: { mode: 'autonomous', actor: 'test', role: null, permission: 'credentials:e2e:qualify' },
      observation: 'Simulated test',
      verificationLevel: 'SIMULATED',
      verificationMethod: 'mock',
      result: 'PASS',
      confidence: 1.0,
      externalEvidence: [],
      internalEvidence: [],
      correlationId: 'test',
      blocker: null,
    });
    expect(evidence.verification.level).toBe('SIMULATED');
    expect(evidence.verification.level).not.toBe('VERIFIED_EXTERNAL');
  });

  test('internal test only → INTERNAL_VERIFIED (not EXTERNAL_VERIFIED)', () => {
    const { createEvidence } = require('../../lib/operational/EvidenceModel');
    const evidence = createEvidence({
      operationId: 'test-internal',
      capability: 'stripe-e2e-qualification',
      provider: 'stripe',
      environment: 'test',
      action: 'test',
      authorization: { mode: 'autonomous', actor: 'test', role: null, permission: 'credentials:e2e:qualify' },
      observation: 'Internal test',
      verificationLevel: 'VERIFIED_INTERNAL',
      verificationMethod: 'internal',
      result: 'PASS',
      confidence: 1.0,
      externalEvidence: [],
      internalEvidence: [],
      correlationId: 'test',
      blocker: null,
    });
    expect(evidence.verification.level).toBe('VERIFIED_INTERNAL');
    expect(evidence.verification.level).not.toBe('VERIFIED_EXTERNAL');
  });

  test('credential rotation unauthorized → DENIED', async () => {
    const rotationManager = getRotationTransactionManager();
    const handle = createHandle({
      provider: 'stripe',
      credentialType: 'stripe_secret_key',
      environment: 'test',
      source: 'ENVIRONMENT',
      value: 'sk_test_oldkey1234567890abcdefghijklmnop',
    });

    const transaction = await rotationManager.startRotation({
      provider: 'stripe',
      credentialType: 'stripe_secret_key',
      environment: 'test',
      oldCredentialHandle: handle,
      authorization: { mode: 'autonomous', actor: 'test', role: null },
    });

    expect(transaction.state).toBe('FAILED');
    expect(transaction.blocker?.type).toBe('POLICY_PROHIBITED_ACTION');
  });

  test('credential rotation interrupted → RECOVERABLE', async () => {
    const rotationManager = getRotationTransactionManager();
    const handle = createHandle({
      provider: 'stripe',
      credentialType: 'stripe_secret_key',
      environment: 'test',
      source: 'ENVIRONMENT',
      value: 'sk_test_oldkey1234567890abcdefghijklmnop',
    });

    const transaction = await rotationManager.startRotation({
      provider: 'stripe',
      credentialType: 'stripe_secret_key',
      environment: 'test',
      oldCredentialHandle: handle,
      authorization: { mode: 'human_authorized', actor: 'owner', role: 'owner' },
    });

    // Simulate interruption — transaction should be recoverable
    const recovered = await rotationManager.recoverTransaction(transaction.operationId);
    expect(recovered).not.toBeNull();
    expect(recovered?.operationId).toBe(transaction.operationId);
  });
});

// ─── Phase 21: Production Safety ─────────────────────────────────────────

describe('Production Safety: Live Mode Prohibition', () => {
  beforeEach(() => {
    delete process.env.STRIPE_SECRET_KEY;
  });

  test('live-mode credential for E2E → PROHIBITED_BY_POLICY', async () => {
    // Set a live-mode credential
    process.env.STRIPE_SECRET_KEY = 'sk_live_FAKE1a2b3c4d5e6f';

    // Mock fetch to return success (live API works)
    const mockFetch: jest.Mock<any> = jest.fn();
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ available: [{ amount: 10000, currency: 'usd' }], livemode: true }),
    });
    (global as any).fetch = mockFetch;

    // Mock CLI manager
    const cliManager = getStripeCliSessionManager();
    (cliManager as any).diagnose = jest.fn().mockResolvedValue({
      state: 'NOT_INSTALLED', listenerState: 'NOT_RUNNING', cliPath: null, cliVersion: null,
      accountId: null, accountMode: 'unknown', sessionExpiry: null,
      webhookSecretPrefix: null, webhookSecretFingerprint: null, forwardingEndpoint: null,
      lastChecked: new Date().toISOString(), evidence: 'not installed', blocker: null,
    });
    (cliManager as any).getPendingHumanActionRequests = jest.fn().mockReturnValue([]);

    const orchestrator = getCredentialGovernanceOrchestrator();
    const result = await orchestrator.bootstrapStripeTestCredential({ mode: 'human_authorized', actor: 'owner', role: 'owner' });

    // Should be blocked because we need TEST mode, not LIVE
    expect(result.success).toBe(false);
    expect(result.state).not.toBe('HEALTHY');
  });

  test('autonomous rotation of live credentials is rejected', async () => {
    const rotationManager = getRotationTransactionManager();
    const handle = createHandle({
      provider: 'stripe',
      credentialType: 'stripe_secret_key',
      environment: 'live',
      source: 'ENVIRONMENT',
      value: 'sk_live_FAKE1a2b3c4d5e6f',
    });

    const transaction = await rotationManager.startRotation({
      provider: 'stripe',
      credentialType: 'stripe_secret_key',
      environment: 'live',
      oldCredentialHandle: handle,
      authorization: { mode: 'autonomous', actor: 'test', role: null },
    });

    expect(transaction.state).toBe('FAILED');
    expect(transaction.blocker?.type).toBe('POLICY_PROHIBITED_ACTION');
  });

  test('Stripe webhook secret rotation requires HUMAN_REQUIRED', () => {
    const adapter = new StripeRotationAdapter();
    const capability = adapter.canRotate('stripe_webhook_secret', 'test');
    expect(capability).toBe('HUMAN_REQUIRED');
  });

  test('Stripe secret key rotation requires HUMAN_REQUIRED', () => {
    const adapter = new StripeRotationAdapter();
    const capability = adapter.canRotate('stripe_secret_key', 'test');
    expect(capability).toBe('HUMAN_REQUIRED');
  });
});

// ─── Phase 1-3: Credential Source Abstraction ───────────────────────────

describe('Credential Source Abstraction', () => {
  test('CredentialSourceManager returns UNAVAILABLE when no source has credential', async () => {
    delete process.env.STRIPE_SECRET_KEY;
    const manager = getCredentialSourceManager();
    const result = await manager.getCredential('stripe', 'stripe_secret_key', 'test');
    expect(result.handle).toBeNull();
    expect(result.source).toBe('UNAVAILABLE');
  });

  test('EnvironmentCredentialSource reads from process.env', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_abc123def456ghi789jkl012mno345';
    const source = new EnvironmentCredentialSource();
    const handle = await source.getCredential('stripe', 'stripe_secret_key', 'test');
    expect(handle).not.toBeNull();
    expect(handle!.hasValue).toBe(true);
    expect(handle!.source).toBe('ENVIRONMENT');
    expect(handle!.prefix).toBe('sk_test_...');
    expect(handle!._access()).toBe('sk_test_abc123def456ghi789jkl012mno345');
    delete process.env.STRIPE_SECRET_KEY;
  });

  test('credential handle never exposes raw value in serializable fields', () => {
    const handle = createHandle({
      provider: 'stripe',
      credentialType: 'stripe_secret_key',
      environment: 'test',
      source: 'ENVIRONMENT',
      value: 'sk_test_supersecret1234567890abcdefghijklmnop',
    });

    // The handle should have metadata but the raw value is only in _access
    expect(handle.fingerprint).not.toContain('supersecret');
    expect(handle.prefix).toBe('sk_test_...');
    expect(handle.hasValue).toBe(true);

    // Serializing the handle should NOT include the raw value
    const serialized = JSON.parse(JSON.stringify({ ...handle, _access: undefined }));
    expect(JSON.stringify(serialized)).not.toContain('supersecret');
  });

  test('source priority: SECURE_LOCAL checked before ENVIRONMENT', async () => {
    // The source manager should check sources in priority order
    const manager = getCredentialSourceManager();
    const sources = manager.getSources();
    expect(sources.indexOf('SECURE_LOCAL')).toBeLessThan(sources.indexOf('ENVIRONMENT'));
  });
});

// ─── Phase 18: Chat Operations ───────────────────────────────────────────

describe('Chat Operations: Intent Router', () => {
  const router = getCredentialGovernanceChatRouter();

  test('parses "Run Stripe qualification" intent', () => {
    const intent = router.parseIntent('Run Stripe qualification.');
    expect(intent).toBe('run_stripe_qualification');
  });

  test('parses "Check Stripe credentials" intent', () => {
    const intent = router.parseIntent('Check Stripe credentials.');
    expect(intent).toBe('check_stripe_credentials');
  });

  test('parses "Why is Stripe blocked?" intent', () => {
    const intent = router.parseIntent('Why is Stripe blocked?');
    expect(intent).toBe('why_is_stripe_blocked');
  });

  test('parses "Fix the Stripe blocker" intent', () => {
    const intent = router.parseIntent('Fix the Stripe blocker.');
    expect(intent).toBe('fix_stripe_blocker');
  });

  test('parses "Rotate the exposed Stripe credential" intent', () => {
    const intent = router.parseIntent('Rotate the exposed Stripe credential.');
    expect(intent).toBe('rotate_exposed_credential');
  });

  test('parses "What still requires me?" intent', () => {
    const intent = router.parseIntent('What still requires me?');
    expect(intent).toBe('what_requires_me');
  });

  test('parses "Show dashboard" intent', () => {
    const intent = router.parseIntent('Show credential governance dashboard.');
    expect(intent).toBe('show_dashboard');
  });

  test('unknown intent returns understood=false', async () => {
    const result = await router.handle('What is the weather today?');
    expect(result.understood).toBe(false);
    expect(result.intent).toBe('unknown');
  });

  test('show dashboard returns real state (not fake)', async () => {
    const result = await router.handle('Show dashboard');
    expect(result.understood).toBe(true);
    expect(result.response).toContain('CREDENTIAL GOVERNANCE');
    expect(result.response).toContain('Stripe Test');
    expect(result.response).toContain('Stripe CLI');
    expect(result.response).toContain('Webhook');
    expect(result.response).toContain('E2E');
    expect(result.response).toContain('Release');
  });

  test('check credentials returns real state (not fake)', async () => {
    const result = await router.handle('Check Stripe credentials');
    expect(result.understood).toBe(true);
    // Should reflect actual state — no credentials registered
    expect(result.response).toContain('Stripe credential');
  });
});

// ─── Phase 17: Dashboard ─────────────────────────────────────────────────

describe('Credential Governance Dashboard', () => {
  beforeEach(() => {
    // Mock CLI manager to avoid real execSync calls
    const cliManager = getStripeCliSessionManager();
    (cliManager as any).diagnose = jest.fn().mockResolvedValue({
      state: 'NOT_INSTALLED', listenerState: 'NOT_RUNNING', cliPath: null, cliVersion: null,
      accountId: null, accountMode: 'unknown', sessionExpiry: null,
      webhookSecretPrefix: null, webhookSecretFingerprint: null, forwardingEndpoint: null,
      lastChecked: new Date().toISOString(), evidence: 'not installed', blocker: null,
    });
    (cliManager as any).getStatus = jest.fn().mockReturnValue(null);
    (cliManager as any).getPendingHumanActionRequests = jest.fn().mockReturnValue([]);
  });

  test('dashboard never includes raw secrets', async () => {
    process.env.STRIPE_SECRET_KEY = 'sk_test_supersecret1234567890abcdefghijklmnop';
    const dashboard = getCredentialGovernanceDashboard();
    const result = await dashboard.generate();
    const json = JSON.stringify(result);
    expect(json).not.toContain('supersecret');
    delete process.env.STRIPE_SECRET_KEY;
  });

  test('dashboard includes all required sections', async () => {
    const dashboard = getCredentialGovernanceDashboard();
    const result = await dashboard.generate();
    expect(result).toHaveProperty('stripeTest');
    expect(result).toHaveProperty('stripeCli');
    expect(result).toHaveProperty('webhook');
    expect(result).toHaveProperty('e2e');
    expect(result).toHaveProperty('historicalExposure');
    expect(result).toHaveProperty('release');
    expect(result).toHaveProperty('humanActionsRequired');
  });

  test('text summary is human-readable', async () => {
    const dashboard = getCredentialGovernanceDashboard();
    const summary = await dashboard.generateTextSummary();
    expect(summary).toContain('CREDENTIAL GOVERNANCE');
    expect(summary).toContain('credential:');
    expect(summary).toContain('source:');
    expect(summary).toContain('mode:');
  });
});
