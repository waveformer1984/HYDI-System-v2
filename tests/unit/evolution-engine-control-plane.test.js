'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { createEvolutionEngine } = require('../../lib/evolution-engine');
const { assertPathAllowed, validateApprovalContract, buildApprovalContract } = require('../../lib/evolution-engine/approval-contract');
const { isProtectedPath } = require('../../lib/evolution-engine/protected-boundaries');
const { EvolutionRunStore } = require('../../lib/evolution-engine/run-store');
const { VerificationEngine } = require('../../lib/evolution-engine/verification-engine');
const { EvidenceBundle } = require('../../lib/evolution-engine/evidence-bundle');

describe('evolution control plane (negative + safety)', () => {
  let tmpRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'evo-cp-'));
    process.env.EVOLUTION_ALLOW_EXECUTE = 'true';
    delete process.env.EVOLUTION_EMERGENCY_STOP;
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  function engine(extra = {}) {
    const memoryDir = path.join(tmpRoot, 'mem');
    const workspaceRoot = path.join(tmpRoot, 'workspace');
    fs.mkdirSync(path.join(tmpRoot, 'api'));
    fs.writeFileSync(path.join(tmpRoot, 'package.json'), JSON.stringify({ scripts: { test: 'jest', typecheck: 'tsc' } }));
    fs.writeFileSync(path.join(tmpRoot, 'package-lock.json'), '{}');
    fs.writeFileSync(path.join(tmpRoot, 'AGENTS.md'), '# x');
    fs.writeFileSync(path.join(tmpRoot, 'CONTRIBUTING.md'), '# x');
    return createEvolutionEngine({
      repoRoot: tmpRoot,
      memoryDir,
      workspaceRoot,
      getBaseSha: () => 'abc123',
      fixListInputs: { drift: { error: 'pm2 jlist failed' }, now: Date.now() },
      execFile: async () => ({ stdout: 'ok', stderr: '' }),
      ...extra,
    });
  }

  it('blocks write to protected control-plane path', () => {
    expect(isProtectedPath('lib/auth/rbac.js')).toBe(true);
    const contract = buildApprovalContract({ id: 'x', title: 't', severity: 'info' }, { repoRoot: tmpRoot, baseSha: 'abc' });
    expect(assertPathAllowed('lib/auth/rbac.js', contract).ok).toBe(false);
    expect(assertPathAllowed('patches/foo.txt', contract).ok).toBe(false);
    contract.allowed_paths = ['.runtime/evolution/workspace/'];
    expect(assertPathAllowed('.runtime/evolution/workspace/patches/a.txt', contract).ok).toBe(true);
  });

  it('blocks execution without approval', async () => {
    const e = engine();
    await e.runAudit('owner');
    e.generatePlan();
    const r = await e.executeImprovement(undefined, { approved: false, simulatePatch: true });
    expect(r.error).toBe('approval_required');
  });

  it('blocks when approval base SHA changed', async () => {
    const e = engine();
    await e.runAudit('owner');
    e.generatePlan();
    const item = e.getLastPlan().backlog[0];
    const contract = buildApprovalContract(item, { repoRoot: tmpRoot, baseSha: 'old-sha' });
    const r = await e.executeImprovement(item.id, {
      approved: true,
      simulatePatch: true,
      contract,
      baseSha: 'new-sha',
    });
    expect(r.error).toBe('base_sha_changed');
  });

  it('dedupes idempotent mobile execution', async () => {
    const e = engine();
    await e.runAudit('owner');
    e.generatePlan();
    const item = e.getLastPlan().backlog[0];
    const key = 'mobile-req-1';
    const a = await e.executeImprovement(item.id, { approved: true, simulatePatch: true, idempotency_key: key });
    const b = await e.executeImprovement(item.id, { approved: true, simulatePatch: true, idempotency_key: key });
    expect(a.run_id).toBeDefined();
    expect(b.duplicate).toBe(true);
    expect(b.run.run_id).toBe(a.run_id);
  });

  it('emergency stop prevents new execution', async () => {
    const store = new EvolutionRunStore({ rootDir: path.join(tmpRoot, 'runs') });
    store.setEmergencyStop('test');
    const e = engine({ runStore: store });
    await e.runAudit('owner');
    e.generatePlan();
    const r = await e.executeImprovement(undefined, { approved: true, simulatePatch: true });
    expect(r.error).toBe('emergency_stop');
  });

  it('labels injected regression separately from operational regression', async () => {
    const v = new VerificationEngine({ repoRoot: tmpRoot });
    const injected = await v.verify({ regressionProbe: () => true, regressionInjected: true });
    expect(injected.checks[0].injected).toBe(true);
    expect(injected.checks[0].detail).toBe('injected_regression_detected');
  });

  it('fails verification when protected tests would be weakened', async () => {
    const v = new VerificationEngine({ repoRoot: tmpRoot });
    const r = await v.verify({
      testIntegrityBefore: { hash: 'a' },
      testIntegrityAfter: { hash: 'b', removed_tests: ['tests/unit/foo.test.js'] },
    });
    expect(r.ok).toBe(false);
  });

  it('marks evidence incomplete when required fields missing', () => {
    const ev = new EvidenceBundle({ rootDir: path.join(tmpRoot, 'evidence') });
    const w = ev.write({ run_id: 'r1', outcome: 'failed' });
    expect(w.complete.ok).toBe(false);
  });

  it('architecture audit is blocking deliverable shape', () => {
    const e = engine();
    const audit = e.runArchitectureAudit();
    expect(audit.base_sha).toBe('abc123');
    expect(audit.integrations.length).toBeGreaterThan(3);
    expect(audit.measurable.inference_performance).toMatch(/not_measured|partial/);
  });

  it('validateApprovalContract rejects expired approval', () => {
    const c = buildApprovalContract({ id: '1', title: 't', severity: 'info' }, { repoRoot: tmpRoot });
    c.expires_at = new Date(Date.now() - 1000).toISOString();
    expect(validateApprovalContract(c, { approved: true }).code).toBe('approval_expired');
  });
});
