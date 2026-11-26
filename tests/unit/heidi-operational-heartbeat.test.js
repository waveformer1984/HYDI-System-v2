'use strict';

const {
  buildOperationalPayload,
  insertOperationalSnapshot,
  DEFAULT_MODEL,
} = require('../../heidi-core/jobs/operational-heartbeat');

describe('operational heartbeat', () => {
  test('buildOperationalPayload shape', async () => {
    const payload = await buildOperationalPayload({
      now: () => 1_700_000_000_000,
      platform: 'linux',
      execFile: (file, args, opts, cb) => cb(null, '[]', ''),
      tcpConnect: () => ({
        on(ev, fn) {
          if (ev === 'error') process.nextTick(() => fn(new Error('closed')));
          return this;
        },
        setTimeout(_ms, fn) { if (fn) process.nextTick(fn); },
        destroy() {},
      }),
      fetch: async () => ({ ok: true }),
    });
    expect(payload).toMatchObject({
      ts: expect.any(String),
      pm2_services: expect.any(Array),
      ports_up: expect.any(Array),
      ollama_reachable: true,
      model: DEFAULT_MODEL,
    });
  });

  test('insert failure logs and does not throw', async () => {
    const warnings = [];
    const store = {
      isAvailable: () => true,
      from() {
        return {
          insert: async () => ({ error: { message: 'relation missing' } }),
        };
      },
    };
    const log = { warn: (m) => warnings.push(m) };
    const r = await insertOperationalSnapshot(store, { ts: new Date().toISOString() }, log);
    expect(r.ok).toBe(false);
    expect(warnings.some((w) => /insert failed/i.test(w))).toBe(true);
  });

  test('insert success', async () => {
    const store = {
      isAvailable: () => true,
      from() {
        return { insert: async () => ({ error: null }) };
      },
    };
    const r = await insertOperationalSnapshot(store, {
      ts: '2026-01-01T00:00:00.000Z',
      pm2_services: [],
      ports_up: [3459],
      ollama_reachable: false,
      model: DEFAULT_MODEL,
    });
    expect(r.ok).toBe(true);
  });
});