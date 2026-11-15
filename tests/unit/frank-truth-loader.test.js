'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const {
  loadLatestFrankProductionTruth,
  validateTimestamps,
  redactFrankTruthPayload,
  DEFAULT_STALE_MS,
} = require('../../lib/observation/frank-truth-loader');

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
    const newer = path.join(dir, 'frank-production-truth-20260102T000000Z.json');
    const now = Date.now();
    fs.writeFileSync(
      newer,
      JSON.stringify({
        schema_version: 2,
        collected_at: new Date(now).toISOString(),
        host: 'DESKTOP-TEST',
        probes: [{ name: 'heidi-web', ok: true, status: 200 }],
        pm2: { ok: true, env_keys_sample: ['SECRET_SHOULD_DROP'] },
      }),
    );
    fs.utimesSync(newer, now / 1000, now / 1000);

    const r = loadLatestFrankProductionTruth({ root, now, staleMs: DEFAULT_STALE_MS });
    expect(r.availability).toBe('LIVE');
    expect(r.probe_summary[0].mode).toBe('LIVE');
    expect(r.data.pm2.env_keys_sample).toBeUndefined();
  });

  it('marks CACHED when file is stale and warns probes', () => {
    const dir = path.join(root, '.runtime', 'production-truth');
    const file = path.join(dir, 'frank-production-truth-20260102T000000Z.json');
    const now = Date.now();
    fs.writeFileSync(file, JSON.stringify({ schema_version: 1, collected_at: new Date(now - 1e6).toISOString() }));
    fs.utimesSync(file, (now - 1e6) / 1000, (now - 1e6) / 1000);

    const r = loadLatestFrankProductionTruth({ root, now, staleMs: 60000 });
    expect(r.availability).toBe('CACHED');
    expect(r.stale_data_warning).toBe(true);
    expect(r.probe_summary).toEqual([]);
  });

  it('validateTimestamps flags skew', () => {
    const now = Date.now();
    const v = validateTimestamps({
      collected_at: new Date(now - 600000).toISOString(),
      fileMtimeMs: now,
      now,
    });
    expect(v.issues).toContain('collected_at_file_mtime_skew');
  });

  it('redactFrankTruthPayload strips env key samples', () => {
    const out = redactFrankTruthPayload({ pm2: { ok: true, env_keys_sample: ['X'] } });
    expect(out.pm2.env_keys_sample).toBeUndefined();
  });
});