'use strict';

/**
 * Checkpoint fulfillment tests — the checkpoint_audit delivery chain:
 * engine analyze → audit artifacts → independent product-aware QA.
 * fetch is stubbed — a real engine failure must fail the job, never
 * produce a fabricated audit.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { generateCheckpointAudit } = require('../../lib/revenue/CheckpointAuditGenerator');
const { verifyDeliverableArtifacts } = require('../../lib/revenue/DeliveryVerifier');

const ENGINE_OK = {
  '/checkpoint/workflow/analyze': { status: 201, body: { workflow_id: 77, risk_level: 'HIGH', failure_points: 2 } },
  '/checkpoint/workflow/77': {
    status: 200,
    body: {
      workflow_name: 'customer-onboarding', category: 'general', risk_level: 'HIGH',
      failure_points: 2, checkpoints_required: 2, total_steps: 3,
      steps: [{ name: 'intake', number: 1, risk: 4 }, { name: 'provision', number: 2, risk: 8 }, { name: 'handoff', number: 3, risk: 7 }],
      checkpoints: [{ description: 'manual approval before provisioning' }, { description: 'sign-off before customer handoff' }],
    },
  },
};

function fakeFetch(map) {
  return async (url) => {
    const u = String(url);
    for (const [k, v] of Object.entries(map)) {
      if (u.endsWith(k)) return { ok: v.status < 400, status: v.status, json: async () => v.body, text: async () => JSON.stringify(v.body) };
    }
    return { ok: false, status: 404, json: async () => ({}), text: async () => 'not found' };
  };
}

describe('generateCheckpointAudit', () => {
  let savedFetch, savedEnv;
  beforeEach(() => { savedFetch = global.fetch; savedEnv = process.env.URSULA_ENGINE_URL; process.env.URSULA_ENGINE_URL = 'http://engine.test'; });
  afterEach(() => { global.fetch = savedFetch; if (savedEnv === undefined) delete process.env.URSULA_ENGINE_URL; else process.env.URSULA_ENGINE_URL = savedEnv; });

  test('real engine analysis → audit report + data artifacts', async () => {
    global.fetch = fakeFetch(ENGINE_OK);
    const outputDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-audit-'));
    const out = await generateCheckpointAudit({
      jobId: 'job_1',
      requestText: 'fallback text',
      requirements: { steps: [{ name: 'intake' }, { name: 'provision' }, { name: 'handoff' }], workflowName: 'customer-onboarding' },
      outputDir,
    });
    expect(out.workflowId).toBe(77);
    expect(out.riskLevel).toBe('HIGH');
    expect(out.artifacts.map((a) => a.filename).sort()).toEqual(['audit-data.json', 'checkpoint-audit.md']);
    const report = fs.readFileSync(path.join(outputDir, 'checkpoint-audit.md'), 'utf8');
    expect(report).toMatch(/Risk Summary/);
    expect(report).toMatch(/risk 8\/10/);
    const data = JSON.parse(fs.readFileSync(path.join(outputDir, 'audit-data.json'), 'utf8'));
    expect(data.analyzeResult.workflow_id).toBe(77);
    expect(data.report.risk_level).toBe('HIGH');
  });

  test('requestText-only input derives steps; empty input refuses', async () => {
    global.fetch = fakeFetch(ENGINE_OK);
    const dir1 = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-audit-'));
    const out = await generateCheckpointAudit({ jobId: 'j2', requestText: 'intake orders\ncharge card\nship product', requirements: {}, outputDir: dir1 });
    expect(out.workflowId).toBe(77);
    await expect(generateCheckpointAudit({ jobId: 'j3', requestText: '', requirements: {}, outputDir: dir1 })).rejects.toThrow('no workflow steps');
  });

  test('engine failure → throws — the job fails, no fabricated audit', async () => {
    global.fetch = fakeFetch({ '/checkpoint/workflow/analyze': { status: 500, body: { error: 'db locked' } } });
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-audit-'));
    await expect(generateCheckpointAudit({
      jobId: 'j4', requestText: 'intake orders\ncharge card', requirements: {}, outputDir: dir,
    })).rejects.toThrow('HTTP 500');
    expect(fs.readdirSync(dir).length).toBe(0); // no artifacts at all
  });
});

describe('verifyDeliverableArtifacts — checkpoint_audit product dispatch', () => {
  let savedFetch, savedEnv;
  beforeEach(() => { savedFetch = global.fetch; savedEnv = process.env.URSULA_ENGINE_URL; process.env.URSULA_ENGINE_URL = 'http://engine.test'; global.fetch = fakeFetch(ENGINE_OK); });
  afterEach(() => { global.fetch = savedFetch; if (savedEnv === undefined) delete process.env.URSULA_ENGINE_URL; else process.env.URSULA_ENGINE_URL = savedEnv; });

  test('real audit artifacts PASS; wrong-artifact jobs do not pass as audit', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-qa-'));
    await generateCheckpointAudit({ jobId: 'j9', requestText: 'a\nb', requirements: { steps: [{ name: 's1' }] }, outputDir: dir });
    const ok = verifyDeliverableArtifacts(dir, { product: 'checkpoint_audit' });
    expect(ok.verdict).toBe('PASS');

    // A model-prep artifact set must NOT pass audit verification.
    const wrong = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-qa-'));
    fs.writeFileSync(path.join(wrong, 'README.md'), 'x'.repeat(500));
    fs.writeFileSync(path.join(wrong, 'model.scad'), 'cube([1,1,1]);');
    const bad = verifyDeliverableArtifacts(wrong, { product: 'checkpoint_audit' });
    expect(bad.verdict).toBe('FAIL');
  });

  test('audit data without workflow_id fails — engine proof required', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-qa-'));
    fs.writeFileSync(path.join(dir, 'checkpoint-audit.md'), `# audit\n\nrisk workflow ${'x'.repeat(300)}`);
    fs.writeFileSync(path.join(dir, 'audit-data.json'), JSON.stringify({ report: { risk_level: 'HIGH', steps: [{ name: 'a' }] } }));
    const r = verifyDeliverableArtifacts(dir, { product: 'checkpoint_audit' });
    expect(r.verdict).toBe('FAIL');
    expect(r.checks.some((c) => c.name === 'audit_data_workflow')).toBe(true);
  });
});
