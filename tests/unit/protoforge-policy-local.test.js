'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');

const { PolicyEngine, getPolicyEngine, recordOutcome } = require('../../lib/protoforge/policy-engine');
const LocalPolicyStore = require('../../lib/protoforge/stores/local-policy-store');

function writeLocalPolicies(tmpDir, policies) {
  fs.mkdirSync(tmpDir, { recursive: true });
  fs.writeFileSync(path.join(tmpDir, 'policies.json'), JSON.stringify({ policies }, null, 2), 'utf8');
}

function makeLocalEngine() {
  return new PolicyEngine(new LocalPolicyStore());
}

describe('ProtoForge policy engine — local-first', () => {
  let tmpDir;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hydi-policy-'));
    process.env.HYDI_PROTOFORGE_DATA_DIR = tmpDir;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    process.env.HYDI_POLICY_SOURCE = 'local';
  });

  afterEach(() => {
    delete process.env.HYDI_PROTOFORGE_DATA_DIR;
    delete process.env.HYDI_POLICY_SOURCE;
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('fails closed when no local policy exists', async () => {
    const engine = makeLocalEngine();
    await engine.init();
    const decision = engine.evaluate({ id: 'hyp-1', confidence: 0.99, risk: 0.01 });
    expect(decision.decision).toBe('reject');
    expect(decision.reasoning).toMatch(/no-active-policy/);
  });

  test('loads local policy and evaluates allow', async () => {
    writeLocalPolicies(tmpDir, [
      {
        id: 'policy-1',
        version: 1,
        name: 'local-test',
        description: 'test policy',
        stream: null,
        is_active: true,
        rules: {
          default: 'reject',
          rules: [
            { id: 'auto-approve', if: { confidence: { gte: 0.80 } }, then: 'approve', priority: 1 },
          ],
        },
      },
    ]);

    const engine = makeLocalEngine();
    await engine.init('rezonate');
    const decision = engine.evaluate({ id: 'hyp-2', confidence: 0.90, risk: 0.10, stream: 'rezonate' });
    expect(decision.decision).toBe('approve');
    expect(decision.matchedRuleId).toBe('auto-approve');
  });

  test('stream-specific policy wins over global', async () => {
    writeLocalPolicies(tmpDir, [
      {
        id: 'global',
        version: 1,
        name: 'global',
        stream: null,
        is_active: true,
        rules: { default: 'reject', rules: [{ id: 'g', if: { confidence: { gte: 0.80 } }, then: 'approve', priority: 1 }] },
      },
      {
        id: 'stream',
        version: 1,
        name: 'stream',
        stream: 'rezonate',
        is_active: true,
        rules: { default: 'reject', rules: [{ id: 's', if: { confidence: { gte: 0.80 } }, then: 'escalate', priority: 1 }] },
      },
    ]);

    const engine = makeLocalEngine();
    await engine.init('rezonate');
    const decision = engine.evaluate({ id: 'hyp-3', confidence: 0.90, risk: 0.10, stream: 'rezonate' });
    expect(decision.decision).toBe('escalate');
    expect(decision.matchedRuleId).toBe('s');
  });

  test('policy precedence: lower priority number wins', async () => {
    writeLocalPolicies(tmpDir, [
      {
        id: 'policy',
        version: 1,
        name: 'precedence',
        stream: null,
        is_active: true,
        rules: {
          default: 'reject',
          rules: [
            { id: 'second', if: { confidence: { gte: 0.80 } }, then: 'approve', priority: 2 },
            { id: 'first', if: { confidence: { gte: 0.80 } }, then: 'escalate', priority: 1 },
          ],
        },
      },
    ]);

    const engine = makeLocalEngine();
    await engine.init();
    const decision = engine.evaluate({ id: 'hyp-4', confidence: 0.90 });
    expect(decision.decision).toBe('escalate');
    expect(decision.matchedRuleId).toBe('first');
  });

  test('recordDecision and recordOutcome persist without cloud', async () => {
    writeLocalPolicies(tmpDir, [
      {
        id: 'policy',
        version: 1,
        name: 'audit',
        stream: null,
        is_active: true,
        rules: { default: 'reject', rules: [{ id: 'approve', if: { confidence: { gte: 0.80 } }, then: 'approve', priority: 1 }] },
      },
    ]);

    const engine = makeLocalEngine();
    await engine.init();
    const decision = engine.evaluate({ id: 'hyp-5', confidence: 0.90 });
    const recordedId = await engine.recordDecision(decision);
    expect(recordedId).toBe(decision.decisionId);

    await recordOutcome(recordedId, 'success', { revenue_actual: 42 });

    const decisions = JSON.parse(fs.readFileSync(path.join(tmpDir, 'decisions.json'), 'utf8')).decisions;
    const row = decisions[recordedId];
    expect(row).toBeDefined();
    expect(row.decision).toBe('approve');
    expect(row.outcome).toBe('success');
    expect(row.outcome_detail).toEqual({ revenue_actual: 42 });
  });

  test('missing policy falls back to reject after restart', async () => {
    const engine = makeLocalEngine();
    await engine.init();
    const decision = engine.evaluate({ id: 'hyp-6', confidence: 0.99 });
    expect(decision.decision).toBe('reject');
  });

  test('getPolicyEngine works without cloud credentials', async () => {
    writeLocalPolicies(tmpDir, [
      {
        id: 'test-stream-policy',
        version: 1,
        name: 'test-stream',
        stream: 'test-stream',
        is_active: true,
        rules: { default: 'reject', rules: [{ id: 'default-approve', then: 'approve', priority: 1 }] },
      },
    ]);

    const engine = await getPolicyEngine('test-stream');
    const decision = engine.evaluate({ id: 'hyp-7', confidence: 0.50 });
    expect(decision.decision).toBe('approve');
    expect(decision.matchedRuleId).toBe('default-approve');
  });
});
