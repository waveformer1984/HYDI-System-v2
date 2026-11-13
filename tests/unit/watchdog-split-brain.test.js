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
