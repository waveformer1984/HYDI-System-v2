'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { loadLatestFrankProductionTruth, DEFAULT_STALE_MS } = require('../../lib/observation/frank-truth-loader');

describe('frank-truth-loader', () => {
  let root;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'frank-truth-'));
    fs.mkdirSync(path.join(root, '.runtime', 'production-truth'), { recursive: true });
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('reports UNAVAILABLE when no files exist', () => {
    const r = loadLatestFrankProductionTruth({ root, now: Date.now() });
    expect(r.availability).toBe('UNAVAILABLE');
    expect(r.evidence_state).toBe('missing');
  });

  it('picks newest file and marks LIVE when fresh', () => {
    const dir = path.join(root, '.runtime', 'production-truth');
    const older = path.join(dir, 'frank-production-truth-20260101T000000Z.json');
    const newer = path.join(dir, 'frank-production-truth-20260102T000000Z.json');
    const now = Date.now();
    fs.writeFileSync(older, JSON.stringify({ schema_version: 2, collected_at: new Date(now - 60000).toISOString(), host: 'old' }));
    fs.writeFileSync(newer, JSON.stringify({
      schema_version: 2,
      collected_at: new Date(now).toISOString(),
      host: 'DESKTOP-TEST',
      probes: [{ name: 'heidi-web', ok: true, status: 200 }],
      local_ci_hint: { eslint_use_flat_config_process: true },
    }));
    fs.utimesSync(older, (now - 120000) / 1000, (now - 120000) / 1000);
    fs.utimesSync(newer, now / 1000, now / 1000);

    const r = loadLatestFrankProductionTruth({ root, now, staleMs: DEFAULT_STALE_MS });
    expect(r.availability).toBe('LIVE');
    expect(r.host).toBe('DESKTOP-TEST');
    expect(r.local_ci_hint.eslint_use_flat_config_process).toBe(true);
  });

  it('marks CACHED when file is stale', () => {
    const dir = path.join(root, '.runtime', 'production-truth');
    const file = path.join(dir, 'frank-production-truth-20260102T000000Z.json');
    const now = Date.now();
    fs.writeFileSync(file, JSON.stringify({ schema_version: 1, collected_at: new Date(now - 1e6).toISOString() }));
    fs.utimesSync(file, (now - 1e6) / 1000, (now - 1e6) / 1000);

    const r = loadLatestFrankProductionTruth({ root, now, staleMs: 60000 });
    expect(r.availability).toBe('CACHED');
    expect(r.evidence_state).toBe('stale');
  });
});