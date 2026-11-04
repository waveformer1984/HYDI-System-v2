'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEvolutionEngine } = require('../../lib/evolution-engine');

describe('evolution engine cycle (hermetic)', () => {
  let tmpRoot;
  let memoryDir;
  let workspaceRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evolution-'));
    memoryDir = path.join(tmpRoot, 'mem');
    workspaceRoot = path.join(tmpRoot, 'workspace');
    fs.mkdirSync(path.join(tmpRoot, 'api'), { recursive: true });
    fs.writeFileSync(path.join(tmpRoot, 'api', 'health.js'), 'module.exports = {};\n');
    fs.writeFileSync(
      path.join(tmpRoot, 'package.json'),
      JSON.stringify({ scripts: { test: 'jest', typecheck: 'tsc --noEmit' } }),
    );
    fs.writeFileSync(path.join(tmpRoot, 'AGENTS.md'), '# agents\n');
    fs.writeFileSync(path.join(tmpRoot, 'CONTRIBUTING.md'), '# contrib\n');
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function engine(extra = {}) {
    process.env.EVOLUTION_ALLOW_EXECUTE = 'true';
    return createEvolutionEngine({
      repoRoot: tmpRoot,
      memoryDir,
      workspaceRoot,
      fixListInputs: {
        drift: { error: 'pm2 jlist failed' },
        now: Date.now(),
      },
      pipelineEvents: [
        { verdict: 'BLOCK', division: 'test', error: 'simulated', elapsed_ms: 100 },
        { verdict: 'AUTO-APPROVE', division: 'test', elapsed_ms: 50 },
        { verdict: 'AUTO-APPROVE', division: 'test', elapsed_ms: 60 },
        { verdict: 'AUTO-APPROVE', division: 'test', elapsed_ms: 70 },
        { verdict: 'AUTO-APPROVE', division: 'test', elapsed_ms: 80 },
        { verdict: 'AUTO-APPROVE', division: 'test', error: 'fail', elapsed_ms: 90 },
      ],
      performanceOpts: { errorRateThreshold: 0.05, windowHours: 1 },
      execFile: async () => ({ stdout: 'PASS', stderr: '' }),
      ...extra,
    });
  }

  it('detects operational problems and produces diagnosis + plan', async () => {
    const e = engine();
    const audit = await e.runAudit('owner');
    expect(audit.findings.length).toBeGreaterThan(0);
    const driftFinding = audit.findings.find((f) => f.code === 'pm2_unreadable' || f.subsystem === 'observation');
    expect(driftFinding || audit.findings[0]).toBeTruthy();

    const plan = e.generatePlan();
    expect(plan.ok).toBe(true);
    expect(plan.backlog.length).toBeGreaterThan(0);
    expect(plan.backlog[0].rank_score).toBeGreaterThan(plan.backlog[plan.backlog.length - 1].rank_score);
  });

  it('executes approved improvement, detects regression, rolls back, persists history', async () => {
    const e = engine();
    await e.runAudit('owner');
    e.generatePlan();
    const top = e.getLastPlan().backlog[0];

    const okRun = await e.executeImprovement(top.id, {
      approved: true,
      simulatePatch: true,
      regressionProbe: () => false,
    });
    expect(okRun.ok).toBe(true);
    expect(okRun.outcome).toBe('verified');

    const failRun = await e.executeImprovement(top.id, {
      approved: true,
      simulatePatch: true,
      regressionProbe: () => true,
      regressionInjected: true,
    });
    expect(failRun.ok).toBe(false);
    expect(failRun.outcome).toBe('rolled_back');

    const history = e.getHistory(20);
    const types = history.map((h) => h.type);
    expect(types).toContain('audit_complete');
    expect(types).toContain('improvement_applied');
    expect(types).toContain('improvement_failed');
  });

  it('blocks execution without approval', async () => {
    const e = engine();
    await e.runAudit('owner');
    e.generatePlan();
    const r = await e.executeImprovement(undefined, { approved: false, simulatePatch: true });
    expect(r.ok).toBe(false);
    expect(r.error).toBe('approval_required');
  });

  it('mobile evolution actions are registered', () => {
    const { ACTIONS, TEST_SUITES } = require('../../lib/mobile-ops/action-catalog');
    expect(ACTIONS['evolution.status']).toBeDefined();
    expect(ACTIONS['evolution.audit']).toBeDefined();
    expect(TEST_SUITES.evolution).toContain('tests/unit/evolution-engine-cycle.test.js');
  });
});
