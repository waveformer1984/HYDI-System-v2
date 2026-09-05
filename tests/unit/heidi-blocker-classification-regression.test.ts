/**
 * Regression test: missing-credential capability must be classified as BLOCKED
 * all the way through to BlockerResolutionEngine.resolveBlocker().
 *
 * This test was added after the live demo script reported "0 blockers to
 * resolve" despite 4 capabilities being blocked on missing credentials.
 * Root cause: the demo script read `report.status` (nonexistent field)
 * instead of `report.state`, making it appear as "unknown" and filtering
 * out everything. The production code (CapabilityHealthManager,
 * SelfRepairEngine, BlockerResolutionEngine) was already correct — it
 * uses `r.state === 'BLOCKED'` with the correct field name and uppercase
 * value. This test guards against future regressions in the production
 * path.
 */

/**
 * NOTE (updated): the assertions below were originally written expecting
 * missing-credential blockers to resolve as WORK_AROUND. That expectation
 * predates fix(false-autonomy) ["remove fabricated success, strengthen
 * verification"], which deliberately changed BlockerResolutionEngine to
 * ESCALATE_TO_HUMAN for MISSING_EXTERNAL_CREDENTIAL — HEIDI must not
 * fabricate a "worked around" result for something it cannot actually
 * do without a human providing credentials. This file's assertions were
 * updated to match that intentional, safety-motivated behavior.
 */

import {
  CapabilityHealthManager,
  createCredentialProbe,
} from '../../lib/operational/CapabilityHealthManager';
import { BlockerResolutionEngine } from '../../lib/operational/BlockerResolutionEngine';
import { SelfRepairEngine } from '../../lib/operational/SelfRepairEngine';

describe('Missing-credential capability reaches BlockerResolutionEngine as BLOCKED', () => {
  // Save and restore env vars so tests don't leak
  const savedEnv: Record<string, string | undefined> = {};
  const TEST_VARS = [
    'TEST_MISSING_CRED_A',
    'TEST_MISSING_CRED_B',
  ];

  beforeEach(() => {
    for (const v of TEST_VARS) {
      savedEnv[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(() => {
    for (const v of TEST_VARS) {
      if (savedEnv[v] === undefined) {
        delete process.env[v];
      } else {
        process.env[v] = savedEnv[v];
      }
    }
  });

  test('createCredentialProbe reports state=BLOCKED when credentials are missing', async () => {
    // Ensure the test env vars are NOT set
    expect(process.env.TEST_MISSING_CRED_A).toBeUndefined();
    expect(process.env.TEST_MISSING_CRED_B).toBeUndefined();

    const probe = createCredentialProbe({
      capabilityId: 'test.credential_gated',
      description: 'Test credential-gated capability',
      provider: 'test_provider',
      credentialEnvVars: ['TEST_MISSING_CRED_A', 'TEST_MISSING_CRED_B'],
    });

    const result = await probe.probe();

    expect(result.state).toBe('BLOCKED');
    expect(result.failureClassification).toBe('MISSING_EXTERNAL_CREDENTIAL');
    expect(result.evidence).toContain('TEST_MISSING_CRED_A');
    expect(result.evidence).toContain('TEST_MISSING_CRED_B');
  });

  test('CapabilityHealthManager.checkCapability returns state=BLOCKED for missing credentials', async () => {
    const chm = new CapabilityHealthManager();
    chm.registerProbe(createCredentialProbe({
      capabilityId: 'test.credential_gated',
      description: 'Test credential-gated capability',
      provider: 'test_provider',
      credentialEnvVars: ['TEST_MISSING_CRED_A'],
    }));

    const report = await chm.checkCapability('test.credential_gated');

    expect(report).not.toBeNull();
    expect(report!.state).toBe('BLOCKED');
    expect(report!.failureClassification).toBe('MISSING_EXTERNAL_CREDENTIAL');
    expect(report!.repairability).toBe('human_required');
    expect(report!.evidence).toContain('Missing credentials');
  });

  test('CapabilityHealthManager.checkAll counts blocked capabilities correctly', async () => {
    const chm = new CapabilityHealthManager();
    chm.registerProbe(createCredentialProbe({
      capabilityId: 'test.cred_one',
      description: 'Test credential-gated capability 1',
      provider: 'test_provider',
      credentialEnvVars: ['TEST_MISSING_CRED_A'],
    }));
    chm.registerProbe(createCredentialProbe({
      capabilityId: 'test.cred_two',
      description: 'Test credential-gated capability 2',
      provider: 'test_provider',
      credentialEnvVars: ['TEST_MISSING_CRED_B'],
    }));

    const summary = await chm.checkAll();

    expect(summary.total).toBe(2);
    expect(summary.blocked).toBe(2);
    expect(summary.ready).toBe(0);
    expect(summary.unknown).toBe(0);
    expect(summary.reports.every(r => r.state === 'BLOCKED')).toBe(true);
  });

  test('BlockerResolutionEngine.resolveBlockers finds and resolves BLOCKED capabilities', async () => {
    const chm = new CapabilityHealthManager();
    chm.registerProbe(createCredentialProbe({
      capabilityId: 'test.credential_gated',
      description: 'Test credential-gated capability',
      provider: 'test_provider',
      credentialEnvVars: ['TEST_MISSING_CRED_A'],
    }));

    const summary = await chm.checkAll();
    const bre = new BlockerResolutionEngine();

    // Pass the FULL reports array (not pre-filtered) — resolveBlockers
    // filters internally on r.state === 'BLOCKED'
    const result = await bre.resolveBlockers(summary.reports);

    expect(result.totalBlockers).toBe(1);
    expect(result.escalated).toBe(1);
    expect(result.workedAround).toBe(0);
    expect(result.resolutions).toHaveLength(1);
    expect(result.resolutions[0].capabilityId).toBe('test.credential_gated');
    expect(result.resolutions[0].blockerClassification).toBe('MISSING_EXTERNAL_CREDENTIAL');
    expect(result.resolutions[0].resolutionAction).toBe('ESCALATE_TO_HUMAN');
  });

  test('SelfRepairEngine.runSelfRepair escalates BLOCKED capabilities with a runbook (does not fabricate success)', async () => {
    const chm = new CapabilityHealthManager();
    chm.registerProbe(createCredentialProbe({
      capabilityId: 'test.credential_gated',
      description: 'Test credential-gated capability',
      provider: 'test_provider',
      credentialEnvVars: ['TEST_MISSING_CRED_A'],
    }));

    const summary = await chm.checkAll();
    const sre = new SelfRepairEngine();

    const result = await sre.runSelfRepair(summary);

    expect(result.totalIssues).toBe(1);
    expect(result.escalated).toBe(1);
    expect(result.repaired).toBe(0);
    expect(result.workedAround).toBe(0);
    expect(result.repairs).toHaveLength(1);
    expect(result.repairs[0].capabilityId).toBe('test.credential_gated');
    expect(result.repairs[0].classification).toBe('MISSING_EXTERNAL_CREDENTIAL');
    expect(result.repairs[0].plannedAction).toContain('ESCALATE');
  });

  test('full path: checkAll → resolveBlockers with 4 missing-credential capabilities', async () => {
    // Simulate the 4 production blocked capabilities
    const chm = new CapabilityHealthManager();
    const caps = [
      { id: 'commercial.stripe', creds: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_SECRET'] },
      { id: 'commercial.email', creds: ['SENDGRID_API_KEY'] },
      { id: 'commercial.discovery_external', creds: ['GOOGLE_PLACES_API_KEY'] },
      { id: 'commercial.sms', creds: ['TWILIO_ACCOUNT_SID', 'TWILIO_AUTH_TOKEN', 'TWILIO_PHONE_NUMBER'] },
    ];

    // Ensure none of these are set (they shouldn't be in test env, but be explicit)
    for (const cap of caps) {
      for (const cred of cap.creds) {
        delete process.env[cred];
      }
    }

    for (const cap of caps) {
      chm.registerProbe(createCredentialProbe({
        capabilityId: cap.id,
        description: `Test ${cap.id}`,
        provider: 'test_provider',
        credentialEnvVars: cap.creds,
      }));
    }

    const summary = await chm.checkAll();

    // All 4 should be BLOCKED, not UNKNOWN
    expect(summary.blocked).toBe(4);
    expect(summary.unknown).toBe(0);
    expect(summary.reports.every(r => r.state === 'BLOCKED')).toBe(true);

    // BlockerResolutionEngine should find all 4
    const bre = new BlockerResolutionEngine();
    const result = await bre.resolveBlockers(summary.reports);

    expect(result.totalBlockers).toBe(4);
    expect(result.escalated).toBe(4);
    expect(result.workedAround).toBe(0);
    expect(result.resolutions).toHaveLength(4);

    // Every resolution should be ESCALATE_TO_HUMAN for MISSING_EXTERNAL_CREDENTIAL —
    // see fix(false-autonomy): HEIDI must not report fabricated success/workaround
    // for a capability it cannot actually operate without.
    for (const res of result.resolutions) {
      expect(res.blockerClassification).toBe('MISSING_EXTERNAL_CREDENTIAL');
      expect(res.resolutionAction).toBe('ESCALATE_TO_HUMAN');
    }
  });
});
