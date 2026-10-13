'use strict';

/**
 * model-prep-loop — the crash-loop regression.
 *
 * 2026-10-13: the scheduler's first `await cycle()` ran outside try/catch,
 * so ECONNREFUSED from a dead Postgres reached process.exit(1) and PM2
 * restarted it tens of thousands of times. These tests pin the fix:
 * the loop never exits on a cycle error, it backs off, it reports
 * degraded state on the status file, and only a stop request ends it.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  runSchedulerLoop,
  runOnce,
  writeModelPrepStatus,
  MODEL_PREP_STATUS_FILE,
} = require('../../lib/revenue/model-prep-loop');

const ECONNREFUSED = () => Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:54322'), { code: 'ECONNREFUSED' });

/** Fake clock + recorded sleeps. stopAfterSleeps flips isStopping to end the loop. */
function harness({ intervalMs = 30000, maxBackoffMs = 300000, stopAfterSleeps = 10 } = {}) {
  let now = 1_000_000;
  let stopping = false;
  let sleepCount = 0;
  const sleeps = [];
  const writes = [];
  const logs = [];
  return {
    sleeps, writes, logs,
    isStopping: () => stopping,
    stop: () => { stopping = true; },
    sleep: async (ms) => {
      sleeps.push(ms);
      now += ms;
      if (++sleepCount >= stopAfterSleeps) stopping = true;
    },
    now: () => now,
    writeStatus: (s) => writes.push({ ...s }),
    log: (m) => logs.push(m),
    intervalMs,
    maxBackoffMs,
  };
}

describe('model-prep supervised loop', () => {
  test('first cycle throwing ECONNREFUSED does not exit — loop continues and reports degraded', async () => {
    const h = harness({ stopAfterSleeps: 3 });
    const cycle = jest.fn()
      .mockRejectedValueOnce(ECONNREFUSED())
      .mockResolvedValue(undefined);

    await runSchedulerLoop({ cycle, ...h });

    // The first write is 'starting' — evidence the loop is alive but has
    // not yet completed a cycle, never an unearned 'ok'.
    expect(h.writes[0].state).toBe('starting');
    // The loop survived the unguarded-first-cycle bug: it ran more cycles
    // after the throw instead of propagating to a fatal exit.
    expect(cycle).toHaveBeenCalledTimes(3);
    const degraded = h.writes.find((w) => w.state === 'degraded');
    expect(degraded).toBeTruthy();
    expect(degraded.consecutiveFailures).toBe(1);
    expect(degraded.lastError).toMatch(/ECONNREFUSED/);
    // ...and it recovered to 'ok' once a cycle passed.
    expect(h.writes[h.writes.length - 1].state).toBe('ok');
  });

  test('a first cycle that never resolves reports starting, not ok — no false green', async () => {
    const h = harness();
    const cycle = jest.fn(() => new Promise(() => { })); // hangs forever

    // The loop stays pending on the first cycle; what matters is the verdict
    // a health surface would read during that hang.
    const loop = runSchedulerLoop({ cycle, ...h });
    await Promise.resolve();
    await Promise.resolve();

    expect(h.writes).toHaveLength(1);
    expect(h.writes[0].state).toBe('starting');
    expect(h.writes[0].lastSuccessAt).toBeNull();
    expect(h.writes[0].consecutiveFailures).toBe(0);
    // Keep the dangling loop referenced so nothing GC-complains mid-test.
    expect(loop).toBeInstanceOf(Promise);
  });

  test('consecutive failures back off exponentially and cap at 5 minutes', async () => {
    const h = harness({ intervalMs: 30000, stopAfterSleeps: 8 });
    const cycle = jest.fn().mockRejectedValue(ECONNREFUSED());

    await runSchedulerLoop({ cycle, ...h });

    // 30s, 60s, 120s, 240s, then capped at 300s (5 min).
    expect(h.sleeps.slice(0, 6)).toEqual([30000, 60000, 120000, 240000, 300000, 300000]);
  });

  test('backoff resets after the first success; state returns to ok; recovered logged once', async () => {
    const h = harness({ intervalMs: 10000, stopAfterSleeps: 6 });
    const cycle = jest.fn()
      .mockRejectedValueOnce(ECONNREFUSED())
      .mockRejectedValueOnce(ECONNREFUSED())
      .mockRejectedValueOnce(ECONNREFUSED())
      .mockResolvedValue(undefined);

    await runSchedulerLoop({ cycle, ...h });

    // Failure sleeps double: 10s, 20s, 40s — then success resets to the
    // base interval (10s) for the remaining sleeps.
    expect(h.sleeps).toEqual([10000, 20000, 40000, 10000, 10000, 10000]);

    const recovered = h.logs.filter((m) => /recovered after/.test(m));
    expect(recovered).toEqual(['recovered after 3 failures']);
    expect(h.logs.filter((m) => /^degraded:/.test(m))).toHaveLength(1);
    expect(h.writes[h.writes.length - 1]).toMatchObject({
      state: 'ok', consecutiveFailures: 0, lastError: null,
    });
    expect(h.writes[h.writes.length - 1].lastSuccessAt).toBeTruthy();
  });

  test('a stop request during a backoff wait exits the loop promptly', async () => {
    const h = harness({ intervalMs: 10000 });
    const cycle = jest.fn().mockRejectedValue(ECONNREFUSED());
    // Stop mid-wait: the first sleep flips the flag, the loop must exit
    // without running another cycle.
    h.sleep = async (ms) => { h.sleeps.push(ms); h.stop(); };

    await runSchedulerLoop({ cycle, ...h });

    expect(cycle).toHaveBeenCalledTimes(1);
    expect(h.sleeps).toHaveLength(1);
  });

  test('status file is written atomically with the degraded verdict', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'model-prep-status-'));
    const err = writeModelPrepStatus(root, {
      pid: 1234,
      state: 'degraded',
      consecutiveFailures: 5,
      lastError: 'connect ECONNREFUSED 127.0.0.1:54322',
      lastSuccessAt: null,
      updatedAt: new Date().toISOString(),
    });
    expect(err).toBeNull();

    const snap = JSON.parse(fs.readFileSync(path.join(root, MODEL_PREP_STATUS_FILE), 'utf8'));
    expect(snap).toMatchObject({
      pid: 1234, state: 'degraded', consecutiveFailures: 5,
      lastError: expect.stringMatching(/ECONNREFUSED/), lastSuccessAt: null,
    });
    // The temp file must not linger next to the real one.
    expect(fs.readdirSync(root).filter((f) => f.endsWith('.json'))).toEqual([MODEL_PREP_STATUS_FILE]);
  });

  test('--once contract: failing cycle reports not-ok, passing cycle reports ok', async () => {
    const bad = await runOnce({ cycle: async () => { throw ECONNREFUSED(); } });
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/ECONNREFUSED/);

    const good = await runOnce({ cycle: async () => { } });
    expect(good).toEqual({ ok: true });
  });
});
