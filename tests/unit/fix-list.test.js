'use strict';

/**
 * fix-list v1 — pure-module tests on fixtures, covering the real cases
 * from 2026-10-29: the rezonate EADDRINUSE loop, the daemon pid split,
 * a stray ProcessContainerFork, an unreadable jlist, a dead DB, and
 * action_refused counts.
 */
const fs = require('fs');
const path = require('path');
const { buildFixList, itemId } = require('../../lib/observation/fix-list');

const NOW = Date.parse('2026-10-29T19:00:00Z');

const snapshotWithStray = {
  issues: [
    { severity: 'crit', source: 'strays', id: 'stray-3792', text: 'PM2 fork pid 3792 serves :3001 while rezonate-app is waiting restart — run Stop-Process -Id 3792' },
    { severity: 'warn', source: 'storage', id: 'disk-c', text: 'C: drive 89% full' },
  ],
  straysChecked: true,
};

const driftWithLoop = {
  healthy: false, state: 'NOT_ONLINE',
  details: { rows: [
    { name: 'rezonate-app', verdict: 'NOT_ONLINE', verdicts: ['NOT_ONLINE'], suggestion: 'pm2 restart rezonate-app' },
    { name: 'hydi-daemon', verdict: 'OK', verdicts: ['OK'], suggestion: null },
  ] },
};

const daemonStatusSplit = {
  pid: 9276, state: 'running', cycleCount: 2, consecutiveFailures: 0,
  provenance: { gitSha: 'c7559844', pid: 9276 },
};

const backlogStale = { awaitingApproval: 3, blocked: 1, oldestSec: 7200 };
const refusedCounts = { rows: [{ verdict: 'AUTHORIZATION_REQUIRED', count: 4 }, { verdict: 'DEV_PATCH_DISABLED', count: 2 }] };

function byKind(list, kind) { return list.items.filter((i) => i.kind === kind); }
function byId(list, id) { return list.items.find((i) => i.id === id); }

describe('buildFixList — item production', () => {
  it('flags the NOT_ONLINE drift row as CRIT with the restart template', () => {
    const out = buildFixList({ drift: driftWithLoop, now: NOW });
    const item = byKind(out, 'drift')[0];
    expect(item.subject).toBe('rezonate-app');
    expect(item.level).toBe('CRIT');
    expect(item.proposedFix.command).toBe('pm2 restart rezonate-app');
    expect(item.proposedFix.risk).toBe('R1');
  });

  it('flags the daemon status-vs-PM2 pid split as CRIT (the 9276 case)', () => {
    const out = buildFixList({ daemonStatus: daemonStatusSplit, pm2DaemonPid: 19208, now: NOW });
    const item = byKind(out, 'daemon_pid_mismatch')[0];
    expect(item.level).toBe('CRIT');
    expect(item.detail).toContain('9276');
    expect(item.proposedFix.type).toBe('daemon_reconcile');
    expect(item.proposedFix.wouldNeedApproval).toBe(true);
  });

  it('turns a stray fork into a CRIT item with the stop command', () => {
    const out = buildFixList({ snapshot: snapshotWithStray, now: NOW });
    const item = byKind(out, 'stray_pid')[0];
    expect(item.level).toBe('CRIT');
    expect(item.proposedFix.command).toContain('Stop-Process -Id 3792');
  });

  it('an unreadable jlist is its own UNKNOWN item, not silence', () => {
    const out = buildFixList({ drift: { error: 'pm2 jlist failed' }, now: NOW });
    const item = byKind(out, 'pm2_unreadable')[0];
    expect(item.level).toBe('UNKNOWN');
  });

  it('an unreachable DB is an UNKNOWN item, never zero refusals', () => {
    const out = buildFixList({ actionRefused: { unreachable: true, error: 'connection refused' }, now: NOW });
    const item = byKind(out, 'db_unreachable')[0];
    expect(item.level).toBe('UNKNOWN');
  });

  it('summarizes action_refused counts by verdict as INFO under the spike threshold', () => {
    const out = buildFixList({ actionRefused: refusedCounts, now: NOW });
    const item = byKind(out, 'action_refused_spike')[0];
    expect(item.detail).toContain('AUTHORIZATION_REQUIRED=4');
    expect(item.level).toBe('INFO');
  });

  it('stale mission backlog ranks WARN with the human-approval fix', () => {
    const out = buildFixList({ backlog: backlogStale, now: NOW });
    const item = byKind(out, 'mission_backlog')[0];
    expect(item.level).toBe('WARN');
    expect(item.proposedFix.type).toBe('human');
    expect(item.proposedFix.wouldNeedApproval).toBe(true);
  });
});

describe('buildFixList — ranking + dedupe', () => {
  it('ranks CRIT first, then persistence (passes), then blast radius', () => {
    const inputs = { drift: driftWithLoop, snapshot: snapshotWithStray, daemonStatus: daemonStatusSplit, pm2DaemonPid: 19208, backlog: backlogStale, actionRefused: refusedCounts, now: NOW };
    const out = buildFixList(inputs);
    const levels = out.items.map((i) => i.level);
    const firstWarn = levels.indexOf('WARN');
    const firstCrit = levels.indexOf('CRIT');
    expect(firstCrit).toBeGreaterThanOrEqual(0);
    expect(firstWarn === -1 || firstWarn > firstCrit).toBe(true);
    // second pass with previous=first output increments passes, keeps ids
    const second = buildFixList({ ...inputs, previous: out, now: NOW + 60000 });
    expect(second.items.length).toBe(out.items.length);
    expect(second.items[0].passes).toBe(2);
    expect(second.items[0].firstSeen).toBe(out.items[0].firstSeen);
    expect(second.items.map((i) => i.id)).toEqual(out.items.map((i) => i.id));
  });
});

describe('fix-list module boundaries', () => {
  it('never imports the executor, mission creator, or child_process write paths', () => {
    const src = fs.readFileSync(path.join(__dirname, '../../lib/observation/fix-list.js'), 'utf8');
    expect(src).not.toMatch(/require\(['"]child_process['"]\)/);
    expect(src).not.toMatch(/ActionExecutor|action-executor/);
    expect(src).not.toMatch(/createMission|memory\.createMission/);
    expect(src).not.toMatch(/execSync|execFile|spawn\(/);
  });
});
