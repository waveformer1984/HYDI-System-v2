const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createAudit } = require('../src/audit');
const { createCopilot } = require('../src/copilot');

function repo(projects = []) {
  return {
    dataDir: os.tmpdir(),
    listProjects: () => projects,
    getProject: (id) => projects.find((p) => p.id === id) || null,
    listTracks: () => [], listAssets: () => [], listProcessingJobs: () => [],
  };
}
const okEngine = { status: () => ({ available: true, audioProvider: 'local', cloudDependency: false, modelAvailable: true }) };

describe('Readiness audit', () => {
  it('reports only PASS/FAIL/BLOCKED/NOT_TESTED and aggregates', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aud-'));
    const audit = createAudit({ repository: repo([{ id: 'p1' }]), engine: okEngine, copilot: createCopilot({ repository: repo(), dataDir: dir }), diskFreeGb: () => 40, freeMemBytes: () => 8e9 });
    const r = await audit.run();
    for (const c of Object.values(r.checks).flat()) assert.ok(['PASS', 'FAIL', 'BLOCKED', 'NOT_TESTED'].includes(c.status));
    assert.ok(r.ok && r.counts);
  });

  it('GET run() writes nothing — repeated calls create no notes', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aud-'));
    const audit = createAudit({ repository: repo(), engine: okEngine, copilot: createCopilot({ repository: repo(), dataDir: dir }), diskFreeGb: () => 40, freeMemBytes: () => 8e9 });
    await audit.run();
    await audit.run();
    await audit.run();
    const m = (await audit.run()).checks.copilot.find((c) => c.id === 'copilot.memory');
    assert.equal(m.status, 'NOT_TESTED', 'read-only audit must report persistence as NOT_TESTED, not PASS');
    assert.ok(!fs.existsSync(path.join(dir, 'copilot', 'audit-probe.jsonl')), 'three GET runs created a note file');
  });

  it('POST probe writes and reads back an isolated note', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aud-'));
    const audit = createAudit({ repository: repo(), engine: okEngine, copilot: createCopilot({ repository: repo(), dataDir: dir }), diskFreeGb: () => 40, freeMemBytes: () => 8e9 });
    const p = await audit.probe();
    assert.equal(p.status, 'PASS', p.evidence);
    const file = path.join(dir, 'copilot', 'audit-probe.jsonl');
    assert.ok(fs.existsSync(file));
    assert.match(fs.readFileSync(file, 'utf8'), /audit-readiness-probe/);
  });

  it('resource gates: BLOCKED below warn floor, FAIL below block floor', async () => {
    const mk = (mem) => createAudit({ repository: repo(), engine: okEngine, copilot: createCopilot({ repository: repo(), dataDir: os.tmpdir() }), diskFreeGb: () => 40, freeMemBytes: () => mem });
    let r = await mk(1.5e9).run();
    assert.equal(r.checks.resources.find((c) => c.id === 'resource.memory').status, 'BLOCKED');
    r = await mk(0.5e9).run();
    assert.equal(r.checks.resources.find((c) => c.id === 'resource.memory').status, 'FAIL');
    r = await createAudit({ repository: repo(), engine: okEngine, copilot: createCopilot({ repository: repo(), dataDir: os.tmpdir() }), diskFreeGb: () => 3, freeMemBytes: () => 8e9 }).run();
    assert.equal(r.checks.resources.find((c) => c.id === 'resource.disk').status, 'FAIL');
    assert.equal(r.overall, 'FAIL');
  });

  it('tablet check is honest: listen PASS, tailnet BLOCKED', async () => {
    const audit = createAudit({ repository: repo(), engine: okEngine, copilot: createCopilot({ repository: repo(), dataDir: os.tmpdir() }), diskFreeGb: () => 40, freeMemBytes: () => 8e9 });
    const r = await audit.run();
    assert.equal(r.checks.tablet.find((c) => c.id === 'tablet.tailnet').status, 'BLOCKED');
    assert.equal(r.checks.tablet.find((c) => c.id === 'tablet.listen').status, 'PASS');
  });

  it('copilot failures surface as FAIL, never as PASS', async () => {
    const bad = { suggest: async () => { throw new Error('store gone'); }, context: async () => { throw new Error('x'); }, remember: async () => {}, memory: async () => ({ entries: [] }) };
    const r = await createAudit({ repository: repo(), engine: okEngine, copilot: bad, diskFreeGb: () => 40, freeMemBytes: () => 8e9 }).run();
    assert.equal(r.checks.copilot.find((c) => c.id === 'copilot.suggest').status, 'FAIL');
    assert.equal(r.overall, 'FAIL');
  });
});
