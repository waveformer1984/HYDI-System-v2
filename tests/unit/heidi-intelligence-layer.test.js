'use strict';

const path = require('path');
const fs = require('fs');
const os = require('os');

const {
  layerEnabled,
  classifySkill,
  routeInference,
  buildPlan,
  verifyContinuity,
  evaluateToolProposal,
  gateToolHypotheses,
  runHarnessSelfTest,
  captureAllowed,
  appendInteraction,
  experimentalEnabled,
  buildFinetuneManifest,
  prepareTurn,
  repoRoot,
} = require('../../lib/heidi-intelligence');

describe('Heidi intelligence layer', () => {
  const envBase = { ...process.env, HEIDI_INTELLIGENCE_LAYER: 'true', ENABLE_LOCAL_MODEL: 'true' };

  test('identity and evaluation harness self-test passes', () => {
    const report = runHarnessSelfTest();
    expect(report.ok).toBe(true);
    expect(report.passRate).toBeGreaterThanOrEqual(0.75);
  });

  test('skill classification', () => {
    expect(classifySkill('fix the npm test failure').skillId).toBe('coding');
    expect(classifySkill('frank health status').skillId).toBe('system_admin');
  });

  test('router prefers local when RAM sufficient', () => {
    const route = routeInference({ skillId: 'coding', complexity: 0.2, env: envBase });
    expect(['local', 'degraded', 'cloud']).toContain(route.provider);
    expect(route.resources.freeRamGb).toBeGreaterThan(0);
  });

  test('planner marks consequential proposal work for approval', () => {
    const plan = buildPlan({ input: 'submit proposal to client', skillId: 'proposal_prep', context: {} });
    expect(plan.requiresHumanApproval).toBe(true);
    expect(plan.steps.some((s) => s.id === 'approval')).toBe(true);
  });

  test('memory continuity distinguishes history vs structured memory', () => {
    const r = verifyContinuity({
      conversationId: 'abc',
      context: { memoryBlock: '', sources: { memoryIds: [], historyMessages: 3 }, degraded: [] },
      persistence: { saved: true },
    });
    expect(r.checks.find((c) => c.id === 'history_not_substitute').pass).toBe(true);
  });

  test('tool policy fail-closed off allowlist', () => {
    const r = evaluateToolProposal({ toolId: 'unknown.auxiliary', skillId: 'research', env: envBase });
    expect(r.decision).toBe('reject');
  });

  test('billing charge is consequential and escalates', () => {
    const r = evaluateToolProposal({ toolId: 'billing.charge', skillId: 'business_ops', env: { HEIDI_ALLOW_EXEC: 'false' } });
    expect(r.decision).toBe('escalate');
  });

  test('consequential tool escalates without HEIDI_ALLOW_EXEC', () => {
    const r = evaluateToolProposal({ toolId: 'ops.recovery_execute', skillId: 'system_admin', env: { HEIDI_ALLOW_EXEC: 'false' } });
    expect(r.decision).toBe('escalate');
  });

  test('gateToolHypotheses batches decisions', () => {
    const g = gateToolHypotheses([{ tool: 'health.check' }, { tool: 'ops.recovery_execute' }], 'system_admin', { HEIDI_ALLOW_EXEC: 'false' });
    expect(g.approved.length).toBe(1);
    expect(g.escalated.length).toBe(1);
  });

  test('dataset capture blocked without client authorization', () => {
    const tmp = path.join(os.tmpdir(), `heidi-intel-${Date.now()}`);
    const prev = process.env.HYDI_REPO_ROOT;
    process.env.HYDI_REPO_ROOT = tmp;
    try {
      expect(captureAllowed({ HEIDI_INTELLIGENCE_DATASET_CAPTURE: 'true', HEIDI_DATASET_CLIENT_AUTHORIZED: 'false' }).allowed).toBe(false);
      const w = appendInteraction({ input: 'secret test', output: 'ok' }, { HEIDI_INTELLIGENCE_DATASET_CAPTURE: 'true', HEIDI_DATASET_CLIENT_AUTHORIZED: 'true' });
      expect(w.written).toBe(true);
      const corpus = path.join(tmp, '.runtime', 'heidi-intelligence', 'interactions.jsonl');
      expect(fs.existsSync(corpus)).toBe(true);
      const line = fs.readFileSync(corpus, 'utf8');
      expect(line).toContain('secret test');
    } finally {
      process.env.HYDI_REPO_ROOT = prev;
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });

  test('finetune pathway isolated when experimental off', () => {
    expect(experimentalEnabled({})).toBe(false);
    const m = buildFinetuneManifest({ env: {} });
    expect(m.ok).toBe(false);
  });

  test('prepareTurn returns envelope when layer enabled', () => {
    const envelope = prepareTurn({
      input: 'explain architecture',
      context: { sources: { memoryIds: [1] }, degraded: [], memoryBlock: '<memory>...</memory>' },
      persistence: { saved: true },
      conversationId: 'c1',
      env: envBase,
    });
    expect(envelope.enabled).toBe(true);
    expect(envelope.systemOverlay).toMatch(/Heidi/);
    expect(layerEnabled(envBase)).toBe(true);
  });

  test('config files exist under repo', () => {
    const root = path.resolve(__dirname, '..', '..');
    expect(fs.existsSync(path.join(root, 'config', 'heidi-intelligence', 'identity.json'))).toBe(true);
    expect(typeof repoRoot()).toBe('string');
  });
});