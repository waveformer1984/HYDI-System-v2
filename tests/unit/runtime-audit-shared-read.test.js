'use strict';

/**
 * The shared `pm2 jlist` read in lib/runtime/collect.js.
 *
 * On Frank (2026-10-30) `pm2 jlist` took ~28s under memory pressure, past the
 * old 20s bound, so `npm run runtime:audit` and every health probe reported
 * UNKNOWN. One read now runs at a time, its result is reused briefly, a
 * caller waits at most `waitMs`, and a slow read finishes in the background
 * for the next caller. These tests drive that with a fake PM2 whose answer
 * is released by hand.
 */

const os = require('os');
const { collectRuntimeAudit, resetPm2ReadCache, readPm2List, execFileText } = require('../../lib/runtime/collect');

const JLIST = JSON.stringify([{
  name: 'hydi-boot',
  pm2_env: { status: 'online', pm_exec_path: '/repo/scripts/boot-agent.js', args: '', pm_cwd: '/repo' },
}]);

function fakePm2() {
  const pending = [];
  const execFile = jest.fn((cmd, _args, _opts, cb) => {
    if (cmd === 'pm2') pending.push(cb);
    else process.nextTick(() => cb(null, 'abc\n'));
    return { on() {} };
  });
  return {
    execFile,
    pm2Calls: () => execFile.mock.calls.filter((c) => c[0] === 'pm2').length,
    answer: (text = JLIST) => pending.shift()(null, text),
    timeout: () => {
      const err = new Error('Command failed: pm2 jlist');
      err.killed = true;
      err.signal = 'SIGTERM';
      pending.shift()(err);
    },
  };
}

function base(pm2, clock, extra = {}) {
  return {
    root: os.tmpdir(),
    execFile: pm2.execFile,
    shared: true,
    now: () => clock.t,
    requireImpl: () => ({ apps: [{ name: 'hydi-boot', script: 'scripts/boot-agent.js' }] }),
    fs: { readdirSync() { throw new Error('none'); }, readFileSync() { throw new Error('none'); } },
    ...extra,
  };
}

const tick = () => new Promise((r) => setImmediate(r));

beforeEach(() => resetPm2ReadCache());
afterEach(() => { delete process.env.HYDI_PM2_JLIST_CACHE_MS; });

describe('shared pm2 jlist read', () => {
  it('a read slower than the caller wait is UNKNOWN with the reason, then serves the next caller', async () => {
    const pm2 = fakePm2();
    const clock = { t: 1000 };
    const first = await collectRuntimeAudit(base(pm2, clock, { waitMs: 20 }));
    expect(first.overall).toBe('UNKNOWN');
    expect(first.suggestion).toMatch(/still answering after 0s/);
    expect(first.suggestion).toMatch(/No process was restarted/);

    pm2.answer(); // PM2 finally answers, after the caller gave up
    await tick();
    clock.t += 5000;
    const second = await collectRuntimeAudit(base(pm2, clock, { waitMs: 20 }));
    expect(second.rows.length).toBeGreaterThan(0);
    expect(second.overall).not.toBe('UNKNOWN');
    expect(second.pm2ReadAgeMs).toBe(5000);
    expect(pm2.pm2Calls()).toBe(1);
  });

  it('concurrent callers share one pm2 read', async () => {
    const pm2 = fakePm2();
    const clock = { t: 0 };
    const a = collectRuntimeAudit(base(pm2, clock, { waitMs: 1000 }));
    const b = collectRuntimeAudit(base(pm2, clock, { waitMs: 1000 }));
    await tick();
    expect(pm2.pm2Calls()).toBe(1);
    pm2.answer();
    const [ra, rb] = await Promise.all([a, b]);
    expect(ra.overall).not.toBe('UNKNOWN');
    expect(rb.overall).not.toBe('UNKNOWN');
  });

  it('serves a stale result while refreshing, and refreshes once', async () => {
    process.env.HYDI_PM2_JLIST_CACHE_MS = '1000';
    const pm2 = fakePm2();
    const clock = { t: 0 };
    const warm = collectRuntimeAudit(base(pm2, clock, { waitMs: 1000 }));
    await tick();
    pm2.answer();
    await warm;

    clock.t = 5000; // older than the 1s fresh window, younger than max stale
    const stale = await collectRuntimeAudit(base(pm2, clock, { waitMs: 1000 }));
    expect(stale.overall).not.toBe('UNKNOWN');
    expect(stale.pm2ReadAgeMs).toBe(5000);
    expect(pm2.pm2Calls()).toBe(2); // refresh started in the background
    await collectRuntimeAudit(base(pm2, clock, { waitMs: 1000 }));
    expect(pm2.pm2Calls()).toBe(2); // not a second refresh while one runs
    pm2.answer();
  });

  it('a pm2 timeout with nothing cached names the timeout', async () => {
    const pm2 = fakePm2();
    const clock = { t: 0 };
    const p = collectRuntimeAudit(base(pm2, clock, { waitMs: 1000 }));
    await tick();
    pm2.timeout();
    const res = await p;
    expect(res.overall).toBe('UNKNOWN');
    expect(res.suggestion).toMatch(/did not answer within 120s/);
  });

  it('nothing older than the max-stale window is ever served', async () => {
    const pm2 = fakePm2();
    const clock = { t: 0 };
    const warm = collectRuntimeAudit(base(pm2, clock, { waitMs: 1000 }));
    await tick();
    pm2.answer();
    await warm;
    clock.t = 11 * 60000;
    const res = await collectRuntimeAudit(base(pm2, clock, { waitMs: 20 }));
    expect(res.overall).toBe('UNKNOWN');
    pm2.answer();
  });

  it('readPm2List parses the shared read and reports the reason when unreadable', async () => {
    const pm2 = fakePm2();
    const clock = { t: 0 };
    const p = readPm2List({ root: os.tmpdir(), execFile: pm2.execFile, now: () => clock.t, waitMs: 1000 });
    await tick();
    pm2.answer();
    const got = await p;
    expect(got.list).toHaveLength(1);
    expect(got.list[0].name).toBe('hydi-boot');
    resetPm2ReadCache();
    const bad = readPm2List({ root: os.tmpdir(), execFile: pm2.execFile, now: () => clock.t, waitMs: 1000 });
    await tick();
    pm2.answer('not json');
    expect(await bad).toEqual({ list: null, why: 'pm2 jlist output was not JSON' });
  });
});

describe('execFileText tree kill', () => {
  it('on its own deadline kills the whole tree of a hung launch and reports a timeout', async () => {
    const killed = [];
    const execImpl = jest.fn(() => ({ pid: 4242, on() {} })); // never calls back: hung
    let reason = null;
    const text = await execFileText(execImpl, 'pm2', ['jlist'], os.tmpdir(), 30, (r) => { reason = r; },
      { treeKill: true, killImpl: (pid) => killed.push(pid) });
    expect(text).toBeNull();
    expect(reason).toBe('timeout');
    expect(killed).toEqual([4242]);
    expect(execImpl.mock.calls[0][2].timeout).toBe(0); // Node's own timeout would kill only cmd.exe
  });

  it('does not kill anything when the launch answers in time', async () => {
    const killed = [];
    const execImpl = (_c, _a, _o, cb) => { setImmediate(() => cb(null, '[]')); return { pid: 7, on() {} }; };
    const text = await execFileText(execImpl, 'pm2', ['jlist'], os.tmpdir(), 1000, null,
      { treeKill: true, killImpl: (pid) => killed.push(pid) });
    expect(text).toBe('[]');
    await new Promise((r) => setTimeout(r, 20));
    expect(killed).toEqual([]);
  });
});
