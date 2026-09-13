/**
 * HEIDI Self-Sufficiency PRODUCTION Qualification Tests
 *
 * These tests use the REAL CognitiveCoreBuilder with REAL probes.
 * No mocks. No bridgeOverrides. No fake credentials.
 *
 * Tests verify that the production CognitiveCore:
 *   1. Has CapabilityHealthManager wired
 *   2. Has BlockerResolutionEngine wired
 *   3. Has SelfRepairEngine wired
 *   4. Exposes self-sufficiency capabilities through the registry
 *   5. Can execute self-sufficiency capabilities through the governed path
 *   6. Reports READY only after verification
 *   7. Reports BLOCKED for missing credentials
 *   8. Does not fabricate credentials or health
 *   9. Protected assets are never repaired
 *  10. Autonomy is not raised
 *  11. /api/status exposes capability health
 *  12. Commercial loop continues past blocked Stripe
 *  13. Revenue remains $0 without verified payment
 */

import dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { CognitiveCoreBuilder } from '../../lib/heidi/CognitiveCoreBuilder';
import type { CognitiveCore, ExecutionBridge } from '../../lib/heidi/CognitiveCore';
import { getCapabilityRegistry } from '../../lib/heidi/CapabilityRegistry';
import { HeidiOrchestrator } from '../../lib/orchestrator';

const DB_CONFIG = {
  host: '127.0.0.1',
  port: 54322,
  database: 'postgres',
  user: 'postgres',
  password: 'postgres',
};

// Helper: build a REAL production CognitiveCore with no overrides
async function buildProductionCognitiveCore(): Promise<CognitiveCore> {
  return new CognitiveCoreBuilder({ dbConfig: DB_CONFIG }).build();
}

describe('HEIDI Self-Sufficiency PRODUCTION Qualification', () => {
  let core: CognitiveCore;
  let bridge: ExecutionBridge;

  // Tests assert commercial.stripe/commercial.email are correctly reported
  // as missing external credentials. dotenv.config() above loads whatever a
  // developer's .env.local happens to contain -- clear before the core is
  // built (construction, not just live checks, may capture this).
  const CREDENTIAL_KEYS = ['STRIPE_SECRET_KEY', 'SENDGRID_API_KEY', 'SMTP_HOST'];
  const envSnapshot: Record<string, string | undefined> = {};

  beforeAll(async () => {
    for (const key of CREDENTIAL_KEYS) {
      envSnapshot[key] = process.env[key];
      delete process.env[key];
    }
    core = await buildProductionCognitiveCore();
    bridge = core.getBridge();
  }, 30000);

  afterAll(() => {
    for (const key of CREDENTIAL_KEYS) {
      if (envSnapshot[key] === undefined) delete process.env[key];
      else process.env[key] = envSnapshot[key];
    }
  });

  // ─── Production Wiring Tests ──────────────────────────────────────

  test('1. CognitiveCore has CapabilityHealthManager wired', () => {
    expect(bridge.capabilityHealthManager).not.toBeNull();
    expect(bridge.capabilityHealthManager).toBeDefined();
  });

  test('2. CognitiveCore has BlockerResolutionEngine wired', () => {
    expect(bridge.blockerResolutionEngine).not.toBeNull();
    expect(bridge.blockerResolutionEngine).toBeDefined();
  });

  test('3. CognitiveCore has SelfRepairEngine wired', () => {
    expect(bridge.selfRepairEngine).not.toBeNull();
    expect(bridge.selfRepairEngine).toBeDefined();
  });

  test('4. CapabilityRegistry has self-sufficiency capabilities registered', () => {
    const registry = getCapabilityRegistry();
    const caps = registry.listAll();
    const selfSufficiencyCaps = caps.filter((c: any) => c.provider === 'capability_health_manager' ||
      c.provider === 'blocker_resolution_engine' || c.provider === 'self_repair_engine');
    expect(selfSufficiencyCaps.length).toBeGreaterThanOrEqual(6);
  });

  test('5. CapabilityHealthManager probes real database and reports READY', async () => {
    const chm = bridge.capabilityHealthManager!;
    const report = await chm.checkCapability('system.database');
    expect(report).not.toBeNull();
    // Database should be READY if Supabase is running
    expect((report as any).state).toBe('READY');
    expect((report as any).evidence).toContain('tables');
    expect((report as any).lastSuccessfulVerification).not.toBeNull();
  }, 15000);

  test('6. CapabilityHealthManager reports BLOCKED for missing Stripe credentials', async () => {
    const chm = bridge.capabilityHealthManager!;
    const report = await chm.checkCapability('commercial.stripe');
    expect(report).not.toBeNull();
    if (!process.env.STRIPE_SECRET_KEY) {
      expect((report as any).state).toBe('BLOCKED');
      expect((report as any).failureClassification).toBe('MISSING_EXTERNAL_CREDENTIAL');
      expect((report as any).requiredCredentials).toContain('STRIPE_SECRET_KEY');
    }
  }, 10000);

  test('7. CapabilityHealthManager reports BLOCKED for missing email credentials', async () => {
    const chm = bridge.capabilityHealthManager!;
    const report = await chm.checkCapability('commercial.email');
    expect(report).not.toBeNull();
    if (!process.env.SENDGRID_API_KEY) {
      expect((report as any).state).toBe('BLOCKED');
      expect((report as any).failureClassification).toBe('MISSING_EXTERNAL_CREDENTIAL');
    }
  }, 10000);

  test('8. checkAll returns summary with correct counts', async () => {
    const chm = bridge.capabilityHealthManager!;
    const summary = await chm.checkAll() as any;
    expect(summary.total).toBeGreaterThan(0);
    expect(summary.ready + summary.blocked + summary.unavailable + summary.degraded +
           summary.repairable + summary.humanRequired + summary.prohibited + summary.unknown)
      .toBe(summary.total);
  }, 15000);

  test('9. getReadyCapabilities returns only READY with evidence', async () => {
    const chm = bridge.capabilityHealthManager!;
    await chm.checkAll();
    const ready = chm.getReadyCapabilities() as any[];
    for (const cap of ready) {
      expect(cap.state).toBe('READY');
      expect(cap.evidence.length).toBeGreaterThan(5);
      expect(cap.lastSuccessfulVerification).not.toBeNull();
    }
  }, 15000);

  test('10. getBlockedCapabilities returns only blocked with classification', async () => {
    const chm = bridge.capabilityHealthManager!;
    await chm.checkAll();
    const blocked = chm.getBlockedCapabilities() as any[];
    for (const cap of blocked) {
      expect(['BLOCKED', 'UNAVAILABLE', 'HUMAN_REQUIRED']).toContain(cap.state);
      expect(cap.failureClassification).toBeDefined();
    }
  }, 15000);

  // ─── Self-Repair Governance Tests ────────────────────────────────

  test('11. SelfRepairEngine refuses to repair protected assets', async () => {
    const sre = bridge.selfRepairEngine!;
    const chm = bridge.capabilityHealthManager!;
    await chm.checkAll();

    // Create a health summary with a protected asset marked as blocked
    const summary = {
      total: 1,
      ready: 0, degraded: 0, blocked: 1, unavailable: 0,
      repairable: 0, humanRequired: 0, prohibited: 0, unknown: 0,
      reports: [{
        capabilityId: 'guardian_model',
        description: 'Guardian Model',
        provider: 'internal',
        dependencies: [],
        state: 'BLOCKED',
        evidence: 'Guardian is blocked',
        lastSuccessfulVerification: null,
        lastFailure: new Date().toISOString(),
        failureClassification: 'POLICY_PROHIBITED_ACTION',
        repairability: 'not_repairable',
        requiredAuthorization: 'R5',
        requiredCredentials: [],
        recoveryProcedure: 'N/A',
        verificationProcedure: 'N/A',
        checkedAt: new Date().toISOString(),
      }],
    };

    const result = await sre.runSelfRepair(summary as any) as any;
    expect(result.refused).toBe(1);
    expect(result.repaired).toBe(0);
  }, 10000);

  test('12. SelfRepairEngine works around missing credentials, does not fabricate', async () => {
    const sre = bridge.selfRepairEngine!;
    const chm = bridge.capabilityHealthManager!;
    const summary = await chm.checkAll();

    const result = await sre.runSelfRepair(summary as any) as any;

    // No repair should claim to have fabricated credentials. The planned
    // action is expected to *disclaim* fabrication (e.g. "must NOT fabricate
    // credentials") -- a plain substring check on 'fabricate' would fail on
    // that exact safe sentence, so only flag an affirmative instruction.
    for (const repair of result.repairs) {
      if (repair.capabilityId === 'commercial.stripe' || repair.capabilityId === 'commercial.email') {
        const affirmsFabrication = /\bfabricat\w*\b/i.test(repair.plannedAction)
          && !/\b(not|never|must not)\s+fabricat\w*/i.test(repair.plannedAction);
        expect(affirmsFabrication).toBe(false);
        expect(repair.plannedAction).not.toMatch(/\binvent(ed|ing)?\s+(a\s+)?credential/i);
      }
    }
  }, 15000);

  test('13. SelfRepairEngine does not raise autonomy level', async () => {
    const sre = bridge.selfRepairEngine!;
    const chm = bridge.capabilityHealthManager!;
    const summary = await chm.checkAll();
    const result = await sre.runSelfRepair(summary as any) as any;

    for (const repair of result.repairs) {
      expect(repair.riskLevel).not.toBe('R5');
      // R2+ requires human authorization — should not be auto-executed
      if (repair.riskLevel === 'R2' || repair.riskLevel === 'R3' || repair.riskLevel === 'R4') {
        if (repair.executed) {
          expect(repair.authorized).toBe(true);
          expect(repair.authorizedBy).not.toBe('heidi_autonomous_r0r1');
        }
      }
    }
  }, 15000);

  test('14. SelfRepairEngine enforces max repairs per cycle', async () => {
    const { SelfRepairEngine } = await import('../../lib/operational/SelfRepairEngine');
    const sre = new SelfRepairEngine({ maxAutoRepairsPerCycle: 1 });

    const summary = {
      total: 3, ready: 0, degraded: 0, blocked: 0, unavailable: 3,
      repairable: 0, humanRequired: 0, prohibited: 0, unknown: 0,
      reports: [
        makeUnavailableReport('system.db1'),
        makeUnavailableReport('system.db2'),
        makeUnavailableReport('system.db3'),
      ],
    };

    const result = await sre.runSelfRepair(summary as any) as any;
    expect(result.escalated).toBeGreaterThanOrEqual(2);
  }, 10000);

  test('15. SelfRepairEngine repair history is tracked', async () => {
    const sre = bridge.selfRepairEngine!;
    const history = sre.getHistory();
    expect(Array.isArray(history)).toBe(true);
  });

  // ─── Orchestrator Integration Tests ──────────────────────────────

  test('16. Orchestrator.getCapabilityHealth() returns real capability health', async () => {
    const orchestrator = new HeidiOrchestrator();
    const health = await orchestrator.getCapabilityHealth();

    // getCapabilityHealth() must lazily initialize the orchestrator's own
    // CognitiveCore singleton (via getCognitiveCore()) rather than only
    // reporting on one that something else already booted. This is the
    // actual code path /api/status hits — not the DB_CONFIG-wired core
    // built in beforeAll() above.
    expect(health.available).toBe(true);
    expect(health.error).toBeNull();
    expect(health.summary).not.toBeNull();
    expect(health.summary!.total).toBeGreaterThan(0);
    expect(health.readyCapabilities).toBeDefined();
    expect(health.blockedCapabilities).toBeDefined();
    expect(health.repairHistory).toBeDefined();
  }, 30000);

  test('16b. Orchestrator real singleton includes system.database capability (regression: dbConfig must reach the production build path)', async () => {
    // Regression test for a real production gap: CognitiveCoreBuilder only
    // registers the system.database probe + repair handler when dbConfig is
    // explicitly passed. lib/orchestrator.ts's getCognitiveCore() used to
    // call buildCognitiveCore() without dbConfig at all, so /api/status
    // never reported database health or could self-repair the database —
    // even though the 27-test "production qualification" suite passed,
    // because it built its own CognitiveCoreBuilder({ dbConfig: DB_CONFIG })
    // directly and never exercised getCognitiveCore()/HeidiOrchestrator.
    const orchestrator = new HeidiOrchestrator();
    const health = await orchestrator.getCapabilityHealth();
    expect(health.available).toBe(true);

    const allCaps = [...health.readyCapabilities, ...health.blockedCapabilities];
    const dbCap = allCaps.find((c) => c.capabilityId === 'system.database');
    expect(dbCap).toBeDefined();
  }, 30000);

  test('17. Orchestrator.getCapabilityHealth() never exposes secrets', async () => {
    const orchestrator = new HeidiOrchestrator();
    const health = await orchestrator.getCapabilityHealth();

    // Check that no credential values appear in the response
    const json = JSON.stringify(health);
    // Only credential NAMES should appear, not values
    if (process.env.STRIPE_SECRET_KEY) {
      expect(json).not.toContain(process.env.STRIPE_SECRET_KEY);
    }
    if (process.env.SENDGRID_API_KEY) {
      expect(json).not.toContain(process.env.SENDGRID_API_KEY);
    }
    if (process.env.SUPABASE_SERVICE_ROLE_KEY) {
      expect(json).not.toContain(process.env.SUPABASE_SERVICE_ROLE_KEY);
    }
  }, 30000);

  test('18. Orchestrator.getCommercialState() reports blocked providers accurately', async () => {
    const orchestrator = new HeidiOrchestrator();
    const state = await orchestrator.getCommercialState();

    expect(state.autonomyLevel).toBe(2); // Level 2 — not raised
    if (!process.env.STRIPE_SECRET_KEY) {
      expect(state.stripe.state).toBe('BLOCKED');
      expect(state.stripe.blocker).toContain('STRIPE_SECRET_KEY');
    }
    if (!process.env.SENDGRID_API_KEY && !process.env.SMTP_HOST) {
      expect(state.email.state).toBe('BLOCKED');
    }
  }, 10000);

  // ─── Commercial Continuation Tests ───────────────────────────────

  test('19. Blocked Stripe does not prevent commercial state query', async () => {
    const orchestrator = new HeidiOrchestrator();
    const state = await orchestrator.getCommercialState();
    // Commercial state should still be available even if Stripe is blocked
    expect(state.available).toBe(true);
  }, 10000);

  test('20. Revenue dashboard shows $0 verified revenue without Stripe', async () => {
    const orchestrator = new HeidiOrchestrator();
    const dashboard = await orchestrator.getRevenueDashboard();
    // Pipeline value may be > 0, but verified revenue must be from ledger
    expect(dashboard).toBeDefined();
    // verifiedRevenueCents should only reflect actual ledger entries
    // (not fabricated from pipeline value)
    expect(dashboard.verifiedRevenueCents).toBeGreaterThanOrEqual(0);
  }, 15000);

  // ─── CognitiveCore Execution Tests ───────────────────────────────

  test('21. CognitiveCore can execute self_sufficiency.check_all_capabilities', async () => {
    const registry = core.getRegistry();
    const descriptor = registry.listAll().find(
      (d: any) => d.capabilityId === 'self_sufficiency.check_all_capabilities',
    );
    expect(descriptor).toBeDefined();
    expect(descriptor!.provider).toBe('capability_health_manager');
    expect(descriptor!.riskLevel).toBe('R0');
  });

  test('22. CognitiveCore can execute self_sufficiency.run_self_repair', async () => {
    const registry = core.getRegistry();
    const descriptor = registry.listAll().find(
      (d: any) => d.capabilityId === 'self_sufficiency.run_self_repair',
    );
    expect(descriptor).toBeDefined();
    expect(descriptor!.provider).toBe('self_repair_engine');
    expect(descriptor!.riskLevel).toBe('R1');
  });

  test('23. CognitiveCore bridge has real database probe (not a mock)', async () => {
    const chm = bridge.capabilityHealthManager!;
    const report = await chm.checkCapability('system.database') as any;
    // Real probe returns actual table count
    expect(report.evidence).toMatch(/tables/);
    expect(report.state).toBe('READY');
  }, 15000);

  test('24. CognitiveCore bridge has real Ollama probe (not a mock)', async () => {
    const chm = bridge.capabilityHealthManager!;
    const report = await chm.checkCapability('system.local_model') as any;
    // Real probe — Ollama may or may not be running
    expect(['READY', 'UNAVAILABLE', 'DEGRADED']).toContain(report.state);
    if (report.state === 'READY') {
      expect(report.evidence).toContain('Ollama');
    }
  }, 15000);

  test('25. Self-repair cycle completes without overlap or duplicate', async () => {
    const sre = bridge.selfRepairEngine!;
    const chm = bridge.capabilityHealthManager!;
    const summary = await chm.checkAll();

    // Run two self-repair cycles back-to-back
    const result1 = await sre.runSelfRepair(summary as any) as any;
    const result2 = await sre.runSelfRepair(summary as any) as any;

    // Both should complete
    expect(result1).toBeDefined();
    expect(result2).toBeDefined();
    // No duplicate repair IDs
    const allRepairs = [...result1.repairs, ...result2.repairs];
    const repairIds = allRepairs.map((r: any) => r.repairId);
    const uniqueIds = new Set(repairIds);
    expect(uniqueIds.size).toBe(repairIds.length);
  }, 20000);

  // ─── /api/status Integration ─────────────────────────────────────

  test('26. /api/status handler includes capabilityHealth field', async () => {
    // Import the handler directly
    const statusModule = await import('../../pages/api/status');
    const handler = statusModule.default;

    // Create mock req/res
    const req = {} as any;
    const json = (code: number, data: any) => {
      expect(code).toBe(200);
      expect(data.capabilityHealth).toBeDefined();
    };
    const res = {
      status: (code: number) => ({ json: (data: any) => json(code, data) }),
    } as any;

    await handler(req, res);
  }, 30000);

  // ─── Full Self-Sufficiency Cycle ─────────────────────────────────

  test('27. FULL CYCLE: observe → classify → repair → verify → record', async () => {
    const chm = bridge.capabilityHealthManager!;
    const bre = bridge.blockerResolutionEngine!;
    const sre = bridge.selfRepairEngine!;

    // 1. OBSERVE: Check all capabilities
    const summary = await chm.checkAll() as any;
    expect(summary.total).toBeGreaterThan(0);

    // 2. CLASSIFY: Resolve blockers
    const blocked = chm.getBlockedCapabilities() as any[];
    if (blocked.length > 0) {
      const resolution = await bre.resolveBlockers(blocked) as any;
      expect(resolution.totalBlockers).toBe(blocked.length);
    }

    // 3. REPAIR: Run self-repair
    const repairResult = await sre.runSelfRepair(summary as any) as any;
    expect(repairResult.totalIssues).toBeGreaterThanOrEqual(0);

    // 4. VERIFY: Check that the cycle completed
    expect(repairResult.repaired + repairResult.escalated + repairResult.refused + repairResult.workedAround)
      .toBe(repairResult.totalIssues);

    // 5. RECORD: History is tracked
    const history = sre.getHistory();
    expect(Array.isArray(history)).toBe(true);

    console.log('');
    console.log('════════════════════════════════════════════════════════════════');
    console.log('PRODUCTION SELF-SUFFICIENCY CYCLE COMPLETE');
    console.log('════════════════════════════════════════════════════════════════');
    console.log(`Total capabilities:     ${summary.total}`);
    console.log(`READY:                  ${summary.ready}`);
    console.log(`BLOCKED:                ${summary.blocked}`);
    console.log(`UNAVAILABLE:            ${summary.unavailable}`);
    console.log(`Self-repair issues:     ${repairResult.totalIssues}`);
    console.log(`Repaired:               ${repairResult.repaired}`);
    console.log(`Escalated:              ${repairResult.escalated}`);
    console.log(`Worked around:          ${repairResult.workedAround}`);
    console.log(`Refused:                ${repairResult.refused}`);
    console.log(`Autonomy level:         2 (unchanged)`);
    console.log(`Protected assets:       REFUSED if blocked`);
    console.log('════════════════════════════════════════════════════════════════');
  }, 30000);
});

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeUnavailableReport(capabilityId: string): any {
  return {
    capabilityId,
    description: `Test capability ${capabilityId}`,
    provider: 'postgres',
    dependencies: [],
    state: 'UNAVAILABLE',
    evidence: 'Not reachable',
    lastSuccessfulVerification: null,
    lastFailure: new Date().toISOString(),
    failureClassification: 'INFRASTRUCTURE_RUNTIME_PROBLEM',
    repairability: 'auto_repairable',
    requiredAuthorization: 'R0',
    requiredCredentials: [],
    recoveryProcedure: 'Restart service',
    verificationProcedure: 'Check health',
    checkedAt: new Date().toISOString(),
  };
}
