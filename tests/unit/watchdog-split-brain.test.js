'use strict';
/**
 * SPLIT-BRAIN detection: a port answered by a non-PM2 PID (or a PM2 app
 * that isn't online) must flip the endpoint result to unhealthy with the
 * orphan PID, file a report, and propose — never kill.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');

jest.mock('child_process', () => {
  const actual = jest.requireActual('child_process');
  return { ...actual, execSync: jest.fn() };
});

const { execSync } = require('child_process');

const PM2_ONLINE_PID = 35016;
const ORPHAN_PID = 20896;

function fakeExec(command) {
  if (command === 'pm2 jlist') {
    return JSON.stringify([
      { name: 'heidi-web-standalone', pid: PM2_ONLINE_PID, pm2_env: { status: 'online' } },
      { name: 'heidi-web-waiting', pid: 0, pm2_env: { status: 'waiting restart' } },
      { name: 'heidi-core', pid: 0, pm2_env: { status: 'waiting restart' } },
    ]);
  }
  if (command === 'netstat -ano') {
    // :3000 owned by orphan, :3006 owned by PM2's own pid
    return [
      '  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    ' + ORPHAN_PID,
      '  TCP    0.0.0.0:3006    0.0.0.0:0    LISTENING    ' + PM2_ONLINE_PID,
    ].join('\r\n');
  }
  if (command.startsWith('node scripts/mission-cli.js create')) return 'created mission #1';
  throw new Error('unexpected exec: ' + command);
}

describe('watchdog-split-brain', () => {
  const sb = require('../../scripts/watchdog-split-brain');
  const reportDir = path.resolve(__dirname, '..', '..', '.runtime', 'watchdog');

  beforeEach(() => {
    execSync.mockImplementation(fakeExec);
    sb._reset();
  });

  afterEach(() => {
    for (const f of ['split-brain-heidi-web.json', 'split-brain-heidi-mobile-chat.json', 'split-brain-heidi-core.json']) {
      try { fs.rmSync(path.join(reportDir, f), { force: true }); } catch {}
    }
  });

  test('PM2-owned listener stays healthy', () => {
    const results = [{ name: 'heidi-mobile-chat', url: 'http://127.0.0.1:3006/api/health', ok: true, state: 'HEALTHY' }];
    sb.annotateSplitBrain(results);
    // 'heidi-mobile-chat' has no PM2 app in the fake jlist -> skipped entirely
    expect(results[0].ok).toBe(true);
  });

  test('orphan listener on a PM2-managed port flips to SPLIT-BRAIN', () => {
    const results = [{ name: 'heidi-web', url: 'http://127.0.0.1:3000/api/health', ok: true, state: 'HEALTHY' }];
    sb.annotateSplitBrain(results);
    expect(results[0].ok).toBe(false);
    expect(results[0].state).toBe('SPLIT-BRAIN');
    expect(results[0].splitBrain).toBe(true);
    expect(results[0].noAutoRecover).toBe(true);
    expect(results[0].orphanPids).toEqual([ORPHAN_PID]);
    expect(results[0].reason).toContain(String(ORPHAN_PID));
  });

  test('already-unhealthy results are not re-checked', () => {
    const results = [{ name: 'heidi-web', url: 'http://127.0.0.1:3000/api/health', ok: false, state: 'UNAVAILABLE' }];
    sb.annotateSplitBrain(results);
    expect(results[0].state).toBe('UNAVAILABLE');
  });

  test('endpoint ok + PM2 app not online + empty listener table → SPLIT-BRAIN', () => {
    // :3459 has no netstat rows in the fake — simulates sandboxed/permission-
    // limited hosts where listenerPids() returns empty. Status alone must
    // still flag split-brain (this was the live blind spot on Frank).
    const results = [{ name: 'heidi-core', url: 'http://127.0.0.1:3459/health', ok: true, state: 'HEALTHY' }];
    sb.annotateSplitBrain(results);
    expect(results[0].ok).toBe(false);
    expect(results[0].state).toBe('SPLIT-BRAIN');
    expect(results[0].noAutoRecover).toBe(true);
    expect(results[0].orphanPids).toEqual([]);
    expect(results[0].reason).toContain('listener table unavailable');
  });

  test('report file records pm2 + orphan pids', () => {
    const results = [{ name: 'heidi-web', url: 'http://127.0.0.1:3000/api/health', ok: true, state: 'HEALTHY' }];
    sb.annotateSplitBrain(results);
    const report = JSON.parse(fs.readFileSync(path.join(reportDir, 'split-brain-heidi-web.json'), 'utf8'));
    expect(report.orphanPids).toContain(ORPHAN_PID);
    expect(report.pm2Name).toBe('heidi-web-standalone');
  });
});

/**
 * Snapshot lifecycle (2026-11-16 fix): the PM2 jlist snapshot must refresh
 * per cycle, distinguish failure modes, and never let stale/unavailable
 * telemetry silently stand in for current state.
 */
describe('watchdog-split-brain snapshot lifecycle', () => {
  const sb = require('../../scripts/watchdog-split-brain');
  const reportDir = path.resolve(__dirname, '..', '..', '.runtime', 'watchdog');
  const WEB = { name: 'heidi-web', url: 'http://127.0.0.1:3000/api/health', ok: true, state: 'HEALTHY' };

  let now;
  let dateNowSpy;

  const jlistWith = (app) => JSON.stringify(app ? [app] : []);
  const ONLINE = { name: 'heidi-web-standalone', pid: PM2_ONLINE_PID, pm2_env: { status: 'online' } };
  const WAITING = { name: 'heidi-web-standalone', pid: 0, pm2_env: { status: 'waiting restart' } };

  function execFactory({ jlist, netstat }) {
    return (command) => {
      if (command === 'pm2 jlist') {
        if (jlist instanceof Error) throw jlist;
        return jlist;
      }
      if (command === 'netstat -ano') {
        if (netstat instanceof Error) throw netstat;
        return netstat;
      }
      if (command.startsWith('node scripts/mission-cli.js create')) return 'created mission #1';
      throw new Error('unexpected exec: ' + command);
    };
  }

  const NETSTAT_ORPHAN = '  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    ' + ORPHAN_PID;
  const NETSTAT_PM2 = '  TCP    0.0.0.0:3000    0.0.0.0:0    LISTENING    ' + PM2_ONLINE_PID;

  beforeEach(() => {
    now = 1_000_000;
    dateNowSpy = jest.spyOn(Date, 'now').mockImplementation(() => now);
    sb._reset();
  });

  afterEach(() => {
    dateNowSpy.mockRestore();
    for (const f of ['split-brain-heidi-web.json', 'pm2-snapshot.json']) {
      try { fs.rmSync(path.join(reportDir, f), { force: true }); } catch {}
    }
  });

  test('startup snapshot "waiting restart" → later fresh snapshot "online" clears split-brain', () => {
    // Cycle 1: PM2 says waiting restart, listener table empty → SPLIT-BRAIN.
    execSync.mockImplementation(execFactory({ jlist: jlistWith(WAITING), netstat: '' }));
    const r1 = [{ ...WEB }];
    sb.annotateSplitBrain(r1);
    expect(r1[0].state).toBe('SPLIT-BRAIN');

    // Cycle 2 (past TTL): PM2 now online and owns the listener → healthy.
    now += 30_000;
    execSync.mockImplementation(execFactory({ jlist: jlistWith(ONLINE), netstat: NETSTAT_PM2 }));
    const r2 = [{ ...WEB }];
    sb.annotateSplitBrain(r2);
    expect(r2[0].ok).toBe(true);
    expect(r2[0].state).toBe('HEALTHY');
    expect(r2[0].splitBrain).toBeUndefined();
  });

  test('online process later disappears → fresh snapshot flags SPLIT-BRAIN', () => {
    execSync.mockImplementation(execFactory({ jlist: jlistWith(ONLINE), netstat: NETSTAT_PM2 }));
    const r1 = [{ ...WEB }];
    sb.annotateSplitBrain(r1);
    expect(r1[0].ok).toBe(true);

    now += 30_000;
    execSync.mockImplementation(execFactory({ jlist: jlistWith(WAITING), netstat: NETSTAT_ORPHAN }));
    const r2 = [{ ...WEB }];
    sb.annotateSplitBrain(r2);
    expect(r2[0].state).toBe('SPLIT-BRAIN');
    expect(r2[0].orphanPids).toEqual([ORPHAN_PID]);
  });

  test('pm2 jlist timeout → snapshot unavailable, health NOT flipped, uncertainty surfaced', () => {
    execSync.mockImplementation(execFactory({
      jlist: new Error('spawnSync pm2 ETIMEDOUT'),
      netstat: NETSTAT_ORPHAN,
    }));
    const results = [{ ...WEB }];
    const snap = sb.annotateSplitBrain(results);
    expect(snap.status).toBe('unavailable');
    expect(results[0].ok).toBe(true);
    expect(results[0].splitBrain).toBeUndefined();
    expect(results[0].splitBrainUnknown).toBe(true);
    expect(results[0].splitBrainNote).toContain('unavailable');
  });

  test('pm2 jlist malformed output → unavailable, distinct from "process absent"', () => {
    execSync.mockImplementation(execFactory({ jlist: 'not-json{{{', netstat: NETSTAT_ORPHAN }));
    const results = [{ ...WEB }];
    const snap = sb.annotateSplitBrain(results);
    expect(snap.status).toBe('unavailable');
    expect(snap.error).toContain('unparseable');
    expect(results[0].ok).toBe(true);
    expect(results[0].splitBrainUnknown).toBe(true);
  });

  test('pm2 jlist valid JSON non-array → unavailable (shape failure, not absent)', () => {
    execSync.mockImplementation(execFactory({ jlist: '{"oops":true}', netstat: NETSTAT_ORPHAN }));
    const snap = sb.annotateSplitBrain([{ ...WEB }]);
    expect(snap.status).toBe('unavailable');
    expect(snap.error).toContain('not an array');
  });

  test('listener enumeration failure + PM2 online → uncertainty surfaced, no flip', () => {
    execSync.mockImplementation(execFactory({
      jlist: jlistWith(ONLINE),
      netstat: new Error('netstat ETIMEDOUT'),
    }));
    const results = [{ ...WEB }];
    sb.annotateSplitBrain(results);
    expect(results[0].ok).toBe(true);
    expect(results[0].splitBrainUnknown).toBe(true);
    expect(results[0].splitBrainNote).toContain('ownership unverified');
  });

  test('listener enumeration failure + PM2 not online → SPLIT-BRAIN (unknown orphan pid)', () => {
    execSync.mockImplementation(execFactory({
      jlist: jlistWith(WAITING),
      netstat: new Error('netstat ETIMEDOUT'),
    }));
    const results = [{ ...WEB }];
    sb.annotateSplitBrain(results);
    expect(results[0].state).toBe('SPLIT-BRAIN');
    expect(results[0].orphanPids).toEqual([]);
    expect(results[0].reason).toContain('listener table unavailable');
  });

  test('expired cache + failed refresh within MAX_STALE → stale detection, flagged not silent', () => {
    execSync.mockImplementation(execFactory({ jlist: jlistWith(WAITING), netstat: '' }));
    sb.annotateSplitBrain([{ ...WEB }]); // fresh snapshot: WAITING

    now += 30_000; // past TTL, within MAX_STALE
    execSync.mockImplementation(execFactory({
      jlist: new Error('pm2 jlist failed'),
      netstat: NETSTAT_ORPHAN,
    }));
    const results = [{ ...WEB }];
    const snap = sb.annotateSplitBrain(results);
    expect(snap.status).toBe('stale');
    expect(snap.ageMs).toBe(30_000);
    // Stale WAITING snapshot + answered port still flags split-brain, but the
    // reason carries the staleness disclosure — never silent.
    expect(results[0].state).toBe('SPLIT-BRAIN');
    expect(results[0].reason).toContain('stale');
  });

  test('cache older than MAX_STALE + failed refresh → unavailable, no flip', () => {
    execSync.mockImplementation(execFactory({ jlist: jlistWith(ONLINE), netstat: NETSTAT_PM2 }));
    sb.annotateSplitBrain([{ ...WEB }]);

    now += 121_000; // past TTL and past MAX_STALE
    execSync.mockImplementation(execFactory({
      jlist: new Error('pm2 jlist failed'),
      netstat: NETSTAT_ORPHAN,
    }));
    const results = [{ ...WEB }];
    const snap = sb.annotateSplitBrain(results);
    expect(snap.status).toBe('unavailable');
    expect(results[0].ok).toBe(true);
    expect(results[0].splitBrainUnknown).toBe(true);
  });

  test('snapshot shared within a cycle: one jlist call for many endpoints', () => {
    execSync.mockImplementation(execFactory({ jlist: jlistWith(ONLINE), netstat: NETSTAT_PM2 }));
    const results = [
      { name: 'heidi-web', url: 'http://127.0.0.1:3000/api/health', ok: true, state: 'HEALTHY' },
      { name: 'heidi-core', url: 'http://127.0.0.1:3459/health', ok: true, state: 'HEALTHY' },
    ];
    sb.annotateSplitBrain(results);
    const jlistCalls = execSync.mock.calls.filter((c) => c[0] === 'pm2 jlist');
    expect(jlistCalls).toHaveLength(1);
  });
});
