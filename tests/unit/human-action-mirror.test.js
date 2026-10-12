'use strict';

/**
 * Human-action DB mirror — the file store stays truth; rows are evidence.
 *
 * Proves: every service mutation lands a mirror row when a pool is wired,
 * a dead pool never blocks or corrupts the file path, and the per-sweep
 * catch-up materializes records written while the DB was down.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const { HumanActionService } = require('../../lib/human-actions/service');
const { syncHumanActions } = require('../../lib/human-actions/detector');
const { mirrorActionRecord, mirrorAllActions } = require('../../lib/human-actions/mirror');

let dir;
let storeFile;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ha-mirror-'));
  storeFile = path.join(dir, 'human-actions.json');
  process.env.HYDI_HUMAN_ACTIONS_FILE = storeFile;
});

afterEach(() => {
  delete process.env.HYDI_HUMAN_ACTIONS_FILE;
  fs.rmSync(dir, { recursive: true, force: true });
});

const spec = (over = {}) => ({
  blockerKey: 'test:blocker', type: 'config', title: 'do the thing',
  boundary: { category: 'EXTERNAL_SERVICE' },
  verifier: { name: 'manual', spec: {} },
  ...over,
});

function makePool({ fail = false } = {}) {
  const writes = [];
  return {
    writes,
    query: async (sql, params) => {
      if (fail) throw new Error('connection refused');
      writes.push({ sql, params });
      return { rows: [] };
    },
  };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('mirrorActionRecord', () => {
  it('upserts the full record projection keyed on the action id', async () => {
    const pool = makePool();
    const svc = new HumanActionService();
    const { action } = svc.request(spec());
    const err = await mirrorActionRecord(pool, action);

    expect(err).toBeNull();
    expect(pool.writes).toHaveLength(1);
    const { sql, params } = pool.writes[0];
    expect(sql).toMatch(/INSERT INTO human_action_mirror/);
    expect(sql).toMatch(/ON CONFLICT \(id\) DO UPDATE/);
    expect(params[0]).toBe(action.id);           // id is $1
    expect(params[3]).toBe('do the thing');      // title is $4
    expect(params[4]).toBe('OPEN');              // status is $5 — real state carried
    expect(params).toContain('test:blocker');
  });

  it('refuses malformed records without touching the pool', async () => {
    const pool = makePool();
    expect(await mirrorActionRecord(pool, { id: null })).toBe('invalid record');
    expect(await mirrorActionRecord(pool, null)).toBe('invalid record');
    expect(pool.writes).toHaveLength(0);
  });

  it('returns the store error — evidence never throws', async () => {
    const pool = makePool({ fail: true });
    const svc = new HumanActionService();
    const { action } = svc.request(spec());
    expect(await mirrorActionRecord(pool, action)).toBe('connection refused');
  });
});

describe('service mutations mirror automatically when a pool is wired', () => {
  it('request + claim both land mirror rows; file store still works when the pool dies', async () => {
    const pool = makePool();
    const svc = new HumanActionService({ mirrorPool: pool });

    const { action } = svc.request(spec());
    await flush();
    expect(pool.writes.length).toBe(1);

    svc.claim(action.id, 'operator-test');
    await flush();
    expect(pool.writes.length).toBe(2);
    // The mirrored row carried CLAIMED — the projection follows mutations.
    expect(pool.writes[1].params).toContain('CLAIMED');

    // Kill the mirror — the store must not notice.
    pool.query = async () => { throw new Error('connection refused'); };
    const a2 = svc.request(spec({ blockerKey: 'test:second', title: 'another' })).action;
    await flush();
    expect(a2.status).toBe('OPEN');
    expect(svc.get(a2.id).status).toBe('OPEN');
  });
});

describe('mirrorAllActions — the offline catch-up', () => {
  it('syncs every file record, including ones written while the DB was dead', async () => {
    // Records written with NO pool — the offline window.
    const svc = new HumanActionService();
    svc.request(spec({ blockerKey: 'test:a', title: 'offline one' }));
    svc.request(spec({ blockerKey: 'test:b', title: 'offline two' }));

    const pool = makePool();
    const res = await mirrorAllActions(pool);
    expect(res).toMatchObject({ synced: 2, failed: 0, error: null });
    const ids = pool.writes.map((w) => w.params[0]);
    expect(ids).toHaveLength(2);
  });

  it('dead pool reports honestly and stops hammering', async () => {
    const svc = new HumanActionService();
    svc.request(spec({ blockerKey: 'test:a', title: 'one' }));
    svc.request(spec({ blockerKey: 'test:b', title: 'two' }));

    const res = await mirrorAllActions(makePool({ fail: true }));
    expect(res.synced).toBe(0);
    expect(res.error).toBe('connection refused');
  });
});

describe('syncHumanActions reports the mirror pass', () => {
  it('pooled sync carries out.mirror; pool-less sync does not run it', async () => {
    const svc = new HumanActionService();
    const pool = makePool();
    const env = { envNamePresent: () => false, envValue: () => undefined };

    const pooled = await syncHumanActions(svc, null, { env, pool });
    expect(pooled.mirror).toBeTruthy();
    expect(pooled.mirror.synced).toBeGreaterThanOrEqual(0);

    const unpolled = await syncHumanActions(svc, null, { env });
    expect(unpolled.mirror).toBeNull();
  });
});
