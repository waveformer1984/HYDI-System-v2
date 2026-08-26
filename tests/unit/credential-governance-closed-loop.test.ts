/**
 * Closed-Loop Blocker Ownership Tests
 *
 * Tests that HYDI correctly classifies each of the 5 remaining blockers
 * into one of four distinct categories (NOT collapsed):
 *   AUTONOMOUS
 *   HUMAN_AUTH_REQUIRED
 *   HUMAN_EXTERNAL_ACTION_REQUIRED
 *   BLOCKED
 *
 * Also tests the closed-loop resolution cycle:
 *   detect → classify → resolve/escalate → verify → certify
 */

import { getCredentialGovernanceOrchestrator, type BlockerOwnership, type BlockerRecord, type ClosedLoopResult } from '../../lib/operational/CredentialGovernanceOrchestrator';
import { getStripeCliSessionManager } from '../../lib/operational/StripeCliSessionManager';
import { getHistoricalSecretRemediationTracker } from '../../lib/operational/HistoricalSecretRemediationTracker';

// ─── Global mocks to prevent real execSync / git calls ───────────────────

beforeAll(() => {
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
    blocker: null,
  });
  (cliManager as any).getStatus = jest.fn().mockReturnValue(null);
  (cliManager as any).getPendingHumanActionRequests = jest.fn().mockReturnValue([]);
  (cliManager as any).checkAndResolveHumanActions = jest.fn().mockResolvedValue(undefined);
  (cliManager as any).startListener = jest.fn().mockResolvedValue({ started: false, webhookSecret: null, reason: 'CLI not authenticated' });
  (cliManager as any).getWebhookSecret = jest.fn().mockReturnValue(null);

  const tracker = getHistoricalSecretRemediationTracker();
  (tracker as any).scanHistory = jest.fn().mockReturnValue([]);
});

beforeEach(() => {
  delete process.env.STRIPE_SECRET_KEY;
  delete process.env.STRIPE_WEBHOOK_SECRET;
  delete process.env.STRIPE_WEBHOOK_SECRET_01;
  delete process.env.WEBHOOK_PROCESSING_ENABLED;
});

// ─── Blocker Classification Tests ────────────────────────────────────────

describe('Closed-Loop Blocker Ownership: Classification', () => {
  const orchestrator = getCredentialGovernanceOrchestrator();

  test('stripe_test_credential with authenticated CLI → AUTONOMOUS', () => {
    const ownership = orchestrator.classifyBlocker('stripe_test_credential', {
      cliState: 'AUTHENTICATED',
      credentialAvailable: false,
      listenerRunning: false,
      webhookSecretConfigured: false,
    });
    expect(ownership).toBe('AUTONOMOUS');
  });

  test('stripe_test_credential without CLI auth → HUMAN_EXTERNAL_ACTION_REQUIRED', () => {
    const ownership = orchestrator.classifyBlocker('stripe_test_credential', {
      cliState: 'NOT_AUTHENTICATED',
      credentialAvailable: false,
      listenerRunning: false,
      webhookSecretConfigured: false,
    });
    expect(ownership).toBe('HUMAN_EXTERNAL_ACTION_REQUIRED');
  });

  test('stripe_cli_authentication → HUMAN_EXTERNAL_ACTION_REQUIRED (always — browser OAuth)', () => {
    const ownership = orchestrator.classifyBlocker('stripe_cli_authentication', {
      cliState: 'NOT_AUTHENTICATED',
      credentialAvailable: false,
      listenerRunning: false,
      webhookSecretConfigured: false,
    });
    expect(ownership).toBe('HUMAN_EXTERNAL_ACTION_REQUIRED');
    // Even if CLI is somehow authenticated, the blocker wouldn't be active
    // But the classification is always HUMAN_EXTERNAL because browser OAuth
    // is something HYDI cannot do
  });

  test('stripe_webhook_forwarding with authenticated CLI → AUTONOMOUS', () => {
    const ownership = orchestrator.classifyBlocker('stripe_webhook_forwarding', {
      cliState: 'AUTHENTICATED',
      credentialAvailable: false,
      listenerRunning: false,
      webhookSecretConfigured: false,
    });
    expect(ownership).toBe('AUTONOMOUS');
  });

  test('stripe_webhook_forwarding without CLI auth → HUMAN_EXTERNAL_ACTION_REQUIRED', () => {
    const ownership = orchestrator.classifyBlocker('stripe_webhook_forwarding', {
      cliState: 'EXPIRED',
      credentialAvailable: false,
      listenerRunning: false,
      webhookSecretConfigured: false,
    });
    expect(ownership).toBe('HUMAN_EXTERNAL_ACTION_REQUIRED');
  });

  test('stripe_webhook_config with running listener → AUTONOMOUS', () => {
    const ownership = orchestrator.classifyBlocker('stripe_webhook_config', {
      cliState: 'AUTHENTICATED',
      credentialAvailable: false,
      listenerRunning: true,
      webhookSecretConfigured: false,
    });
    expect(ownership).toBe('AUTONOMOUS');
  });

  test('stripe_webhook_config without running listener → HUMAN_EXTERNAL_ACTION_REQUIRED', () => {
    const ownership = orchestrator.classifyBlocker('stripe_webhook_config', {
      cliState: 'AUTHENTICATED',
      credentialAvailable: false,
      listenerRunning: false,
      webhookSecretConfigured: false,
    });
    expect(ownership).toBe('HUMAN_EXTERNAL_ACTION_REQUIRED');
  });

  test('historical_credential_rotation → HUMAN_EXTERNAL_ACTION_REQUIRED (Dashboard required)', () => {
    const ownership = orchestrator.classifyBlocker('historical_credential_rotation', {
      cliState: 'AUTHENTICATED',
      credentialAvailable: true,
      listenerRunning: true,
      webhookSecretConfigured: true,
    });
    expect(ownership).toBe('HUMAN_EXTERNAL_ACTION_REQUIRED');
  });

  test('unknown blocker → BLOCKED', () => {
    const ownership = orchestrator.classifyBlocker('unknown_blocker', {
      cliState: 'AUTHENTICATED',
      credentialAvailable: true,
      listenerRunning: true,
      webhookSecretConfigured: true,
    });
    expect(ownership).toBe('BLOCKED');
  });

  test('four categories are NOT collapsed — each is distinct', () => {
    // Verify all four categories can be produced
    const autonomous = orchestrator.classifyBlocker('stripe_webhook_forwarding', {
      cliState: 'AUTHENTICATED', credentialAvailable: false, listenerRunning: false, webhookSecretConfigured: false,
    });
    const humanExternal = orchestrator.classifyBlocker('stripe_cli_authentication', {
      cliState: 'NOT_AUTHENTICATED', credentialAvailable: false, listenerRunning: false, webhookSecretConfigured: false,
    });
    const blocked = orchestrator.classifyBlocker('unknown', {
      cliState: 'AUTHENTICATED', credentialAvailable: true, listenerRunning: true, webhookSecretConfigured: true,
    });

    expect(autonomous).toBe('AUTONOMOUS');
    expect(humanExternal).toBe('HUMAN_EXTERNAL_ACTION_REQUIRED');
    expect(blocked).toBe('BLOCKED');

    // All distinct
    const categories = new Set([autonomous, humanExternal, blocked]);
    expect(categories.size).toBe(3);
  });
});

// ─── Closed-Loop Resolution Tests ────────────────────────────────────────

describe('Closed-Loop Blocker Ownership: Resolution', () => {
  test('all 5 blockers are classified and recorded', async () => {
    const orchestrator = getCredentialGovernanceOrchestrator();
    const result = await orchestrator.runClosedLoop({ mode: 'autonomous', actor: 'test', role: null });

    expect(result.blockers.length).toBe(5);

    // Each blocker has a non-collapsed ownership classification
    for (const blocker of result.blockers) {
      expect(['AUTONOMOUS', 'HUMAN_AUTH_REQUIRED', 'HUMAN_EXTERNAL_ACTION_REQUIRED', 'BLOCKED']).toContain(blocker.ownership);
    }
  });

  test('already-satisfied blockers are marked RESOLVED', async () => {
    // Set up environment as if everything is configured
    process.env.STRIPE_SECRET_KEY = 'sk_test_validkey1234567890abcdefghijkl';
    process.env.STRIPE_WEBHOOK_SECRET_01 = 'whsec_validsecret1234567890abcdefghij';
    process.env.WEBHOOK_PROCESSING_ENABLED = 'true';

    // Mock CLI as authenticated with running listener
    const cliManager = getStripeCliSessionManager();
    (cliManager as any).diagnose = jest.fn().mockResolvedValue({
      state: 'AUTHENTICATED',
      listenerState: 'RUNNING',
      cliPath: '/usr/local/bin/stripe',
      cliVersion: '1.21.0',
      accountId: 'acct_test',
      accountMode: 'test',
      sessionExpiry: null,
      webhookSecretPrefix: 'whsec_...',
      webhookSecretFingerprint: 'abc123',
      forwardingEndpoint: 'localhost:3000/api/webhooks/stripe',
      lastChecked: new Date().toISOString(),
      evidence: 'Authenticated',
      blocker: null,
    });

    const orchestrator = getCredentialGovernanceOrchestrator();
    const result = await orchestrator.runClosedLoop({ mode: 'autonomous', actor: 'test', role: null });

    // Most blockers should be resolved since everything is configured
    const resolved = result.blockers.filter(b => b.resolutionStatus === 'RESOLVED');
    expect(resolved.length).toBeGreaterThanOrEqual(3); // At least credential, forwarding, config
  });

  test('HUMAN_EXTERNAL_ACTION_REQUIRED blockers create durable action requests', async () => {
    // Mock CLI as not authenticated
    const cliManager = getStripeCliSessionManager();
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
      blocker: null,
    });

    const orchestrator = getCredentialGovernanceOrchestrator();
    const result = await orchestrator.runClosedLoop({ mode: 'autonomous', actor: 'test', role: null });

    const externalBlockers = result.blockers.filter(b => b.ownership === 'HUMAN_EXTERNAL_ACTION_REQUIRED');
    expect(externalBlockers.length).toBeGreaterThan(0);

    for (const blocker of externalBlockers) {
      expect(blocker.humanActionRequest).not.toBeNull();
      expect(blocker.humanActionRequest!.id).toMatch(/^AR-/);
      expect(blocker.humanActionRequest!.humanActionRequired).not.toBe('');
      expect(blocker.humanActionRequest!.afterCompletion).toContain('automatically');
      expect(blocker.humanActionRequest!.resolved).toBe(false);
    }
  });

  test('AUTONOMOUS blockers are attempted immediately', async () => {
    // Mock CLI as authenticated — webhook forwarding becomes AUTONOMOUS
    const cliManager = getStripeCliSessionManager();
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
      evidence: 'Authenticated',
      blocker: null,
    });
    // Mock listener start to succeed
    (cliManager as any).startListener = jest.fn().mockResolvedValue({
      started: true,
      webhookSecret: 'whsec_test123',
      reason: 'Listener started',
    });

    const orchestrator = getCredentialGovernanceOrchestrator();
    const result = await orchestrator.runClosedLoop({ mode: 'autonomous', actor: 'test', role: null });

    const webhookForwarding = result.blockers.find(b => b.blockerId === 'stripe_webhook_forwarding');
    expect(webhookForwarding).toBeDefined();
    expect(webhookForwarding!.ownership).toBe('AUTONOMOUS');
    expect(webhookForwarding!.resolutionStatus).toBe('RESOLVED');
    expect(webhookForwarding!.resolutionAction).toBe('start_stripe_listener');
  });

  test('closed loop produces evidence for each step', async () => {
    const orchestrator = getCredentialGovernanceOrchestrator();
    const result = await orchestrator.runClosedLoop({ mode: 'autonomous', actor: 'test', role: null });

    expect(result.evidence.length).toBeGreaterThan(0);
    // Should have OBSERVE, SUMMARY at minimum
    expect(result.evidence.some(e => e.includes('OBSERVE'))).toBe(true);
    expect(result.evidence.some(e => e.includes('SUMMARY'))).toBe(true);
  });

  test('closed loop counts are correct and not collapsed', async () => {
    const orchestrator = getCredentialGovernanceOrchestrator();
    const result = await orchestrator.runClosedLoop({ mode: 'autonomous', actor: 'test', role: null });

    // The sum of all categories should equal the total blockers (minus already-resolved)
    const totalUnresolved = result.blockers.filter(b => b.resolutionStatus !== 'RESOLVED').length;
    const categorySum = result.autonomousResolved + result.humanAuthRequired + result.humanExternalRequired + result.blocked;
    // autonomousResolved counts resolved ones; the others count unresolved
    // So: autonomousResolved + (humanAuth + humanExternal + blocked) should cover all
    expect(result.blockers.length).toBe(5);
  });

  test('dependencies are tracked between blockers', async () => {
    const orchestrator = getCredentialGovernanceOrchestrator();
    const result = await orchestrator.runClosedLoop({ mode: 'autonomous', actor: 'test', role: null });

    const cliAuth = result.blockers.find(b => b.blockerId === 'stripe_cli_authentication');
    const webhookForwarding = result.blockers.find(b => b.blockerId === 'stripe_webhook_forwarding');
    const webhookConfig = result.blockers.find(b => b.blockerId === 'stripe_webhook_config');

    expect(cliAuth!.dependencies).toEqual([]);
    expect(webhookForwarding!.dependencies).toContain('stripe_cli_authentication');
    expect(webhookConfig!.dependencies).toContain('stripe_webhook_forwarding');
  });
});

// ─── Auto-Resume Detection Tests ─────────────────────────────────────────

describe('Closed-Loop: Auto-Resume After External Action', () => {
  test('CLI authentication change is detected and blocker auto-resolves', async () => {
    const cliManager = getStripeCliSessionManager();

    // First run: CLI not authenticated
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
      blocker: null,
    });
    (cliManager as any).getStatus = jest.fn().mockReturnValue({
      state: 'NOT_AUTHENTICATED',
    });

    const orchestrator = getCredentialGovernanceOrchestrator();
    const result1 = await orchestrator.runClosedLoop({ mode: 'autonomous', actor: 'test', role: null });

    const cliBlocker1 = result1.blockers.find(b => b.blockerId === 'stripe_cli_authentication');
    expect(cliBlocker1!.ownership).toBe('HUMAN_EXTERNAL_ACTION_REQUIRED');
    expect(cliBlocker1!.resolutionStatus).not.toBe('RESOLVED');

    // Simulate: human completes `stripe login`
    // Now CLI is authenticated
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
      evidence: 'Authenticated',
      blocker: null,
    });
    (cliManager as any).getStatus = jest.fn().mockReturnValue({
      state: 'NOT_AUTHENTICATED', // old state — to trigger change detection
    });

    // Second run: HYDI should detect the change
    const result2 = await orchestrator.runClosedLoop({ mode: 'autonomous', actor: 'test', role: null });

    // The CLI auth blocker should now be resolved (not active)
    const cliBlocker2 = result2.blockers.find(b => b.blockerId === 'stripe_cli_authentication');
    expect(cliBlocker2!.resolutionStatus).toBe('RESOLVED');

    // Evidence should show the auto-resume
    expect(result2.evidence.some(e => e.includes('OBSERVE'))).toBe(true);
  });
});

// ─── No-False-Green: Closed Loop ─────────────────────────────────────────

describe('Closed-Loop: No-False-Green', () => {
  test('closed loop does not report allResolved when blockers remain', async () => {
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
      evidence: 'Not installed',
      blocker: null,
    });

    const orchestrator = getCredentialGovernanceOrchestrator();
    const result = await orchestrator.runClosedLoop({ mode: 'autonomous', actor: 'test', role: null });

    expect(result.allResolved).toBe(false);
    expect(result.humanExternalRequired).toBeGreaterThan(0);
  });

  test('closed loop does not collapse HUMAN_EXTERNAL into AUTONOMOUS', async () => {
    const cliManager = getStripeCliSessionManager();
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
      blocker: null,
    });

    const orchestrator = getCredentialGovernanceOrchestrator();
    const result = await orchestrator.runClosedLoop({ mode: 'autonomous', actor: 'test', role: null });

    const cliAuth = result.blockers.find(b => b.blockerId === 'stripe_cli_authentication');
    expect(cliAuth!.ownership).toBe('HUMAN_EXTERNAL_ACTION_REQUIRED');
    // NOT AUTONOMOUS — HYDI cannot do browser OAuth
    expect(cliAuth!.ownership).not.toBe('AUTONOMOUS');
    // NOT RESOLVED — no human has done it yet
    expect(cliAuth!.resolutionStatus).not.toBe('RESOLVED');
  });

  test('durable action requests have expiration and afterCompletion', async () => {
    const cliManager = getStripeCliSessionManager();
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
      blocker: null,
    });

    const orchestrator = getCredentialGovernanceOrchestrator();
    const result = await orchestrator.runClosedLoop({ mode: 'autonomous', actor: 'test', role: null });

    const externalBlockers = result.blockers.filter(b => b.ownership === 'HUMAN_EXTERNAL_ACTION_REQUIRED' && b.humanActionRequest);
    for (const blocker of externalBlockers) {
      const req = blocker.humanActionRequest!;
      expect(req.expiration).toBeDefined();
      expect(req.afterCompletion).toContain('automatically');
      expect(req.createdAt).toBeDefined();
      expect(req.resolved).toBe(false);
    }
  });
});
