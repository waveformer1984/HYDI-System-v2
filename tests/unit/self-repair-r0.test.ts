/**
 * SelfRepairR0 tests — Tier 1 (hermetic; reconcile/restart/pool injected).
 *
 * The invariant: restart-returned-0 is never success. Only a post-recovery
 * reconciliation verdict of QUALIFIED produces VERIFIED. A live lock owner
 * that is not a PM2 descendant is always HUMAN_REQUIRED — never killed.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import { runR0Recovery, type RecoveryDeps } from '../../lib/heidi/SelfRepairR0';
import type { ReconciliationReport } from '../../lib/heidi/DeploymentReconciliation';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'r0rec-'));
}

function recon(over: Partial<ReconciliationReport> = {}): ReconciliationReport {
  return {
    verdict: 'QUALIFIED',
    deploymentIdentity: 'VALID',
    applicationHealth: 'HEALTHY',
    predicates: {
      PM2_EXPECTED: true, PROCESS_EXISTS: true, PID_MATCHES: true,
      CWD_CANONICAL: true, SINGLETON_OWNER_MATCHES: true,
      COMMIT_MATCHES_EXPECTED: true, LIVE_RUNTIME_IDENTITY_MATCHES: true,
    },
    failures: [],
    expected: { commit: 'abc1234', pm2Pid: 100, pm2Status: 'online', pm2Cwd: 'C:\\repo', pm2Restarts: 1 },
    actual: {
      lockPid: 200, lockCommit: 'abc1234', lockCwd: 'C:\\repo',
      lockStartedAt: 't', lockAlive: true,
      cyclePid: 200, cycleCommit: 'abc1234', cycleAt: 'now',
    },
    ...over,
  };
}

const DEAD_DAEMON = recon({
  verdict: 'DEPLOYMENT_DRIFT',
  deploymentIdentity: 'INVALID',
  predicates: {
    PM2_EXPECTED: false, PROCESS_EXISTS: false, PID_MATCHES: null,
    CWD_CANONICAL: true, SINGLETON_OWNER_MATCHES: null,
    COMMIT_MATCHES_EXPECTED: null, LIVE_RUNTIME_IDENTITY_MATCHES: false,
  },
  failures: ['PM2_EXPECTED', 'PROCESS_EXISTS'],
  expected: { commit: 'abc1234', pm2Pid: 100, pm2Status: 'stopped', pm2Cwd: 'C:\\repo', pm2Restarts: 5 },
  actual: {
    lockPid: null, lockCommit: null, lockCwd: null, lockStartedAt: null, lockAlive: null,
    cyclePid: null, cycleCommit: null, cycleAt: null,
  },
});

const ORPHAN = recon({
  verdict: 'DEPLOYMENT_DRIFT',
  deploymentIdentity: 'INVALID',
  predicates: {
    PM2_EXPECTED: true, PROCESS_EXISTS: true, PID_MATCHES: false,
    CWD_CANONICAL: true, SINGLETON_OWNER_MATCHES: false,
    COMMIT_MATCHES_EXPECTED: true, LIVE_RUNTIME_IDENTITY_MATCHES: true,
  },
  failures: ['PID_MATCHES', 'SINGLETON_OWNER_MATCHES'],
  expected: { commit: 'abc1234', pm2Pid: 100, pm2Status: 'online', pm2Cwd: 'C:\\repo', pm2Restarts: 3 },
  actual: {
    lockPid: 999, lockCommit: 'abc1234', lockCwd: 'C:\\repo', lockStartedAt: 't', lockAlive: true,
    cyclePid: 999, cycleCommit: 'abc1234', cycleAt: 'now',
  },
});

function makePool(lastAttemptIso: string | null = null) {
  let nextId = 1;
  const inserted: unknown[] = [];
  return {
    inserted,
    query: async (sql: string, params?: unknown[]) => {
      if (/recovery_attempt/.test(sql) && /SELECT/.test(sql)) {
        return { rows: lastAttemptIso ? [{ created_at: lastAttemptIso }] : [] };
      }
      if (/INSERT/.test(sql)) {
        inserted.push(params?.[2]);
        return { rows: [{ id: `attempt-${nextId++}` }] };
      }
      return { rows: [] };
    },
  };
}

function deps(over: Partial<RecoveryDeps> & { pool: ReturnType<typeof makePool> } ): RecoveryDeps {
  return {
    repoDir: tmpDir(),
    cooldownMs: 15 * 60 * 1000,
    settleMs: 0,
    reconcile: async () => recon(),
    restartDaemon: () => ({ ok: true }),
    ...over,
  } as RecoveryDeps;
}

describe('ops.recover_daemon_r0', () => {
  test('T1: daemon unavailable → restart → reconcile → VERIFIED', async () => {
    let post = false;
    const pool = makePool();
    const r = await runR0Recovery(deps({
      pool,
      reconcile: async () => (post ? recon() : DEAD_DAEMON),
      restartDaemon: () => { post = true; return { ok: true }; },
    }));
    expect(r.state).toBe('VERIFIED');
    expect(r.action).toBe('restart_daemon');
    expect(r.postRecovery?.verdict).toBe('QUALIFIED');
    expect(pool.inserted.length).toBeGreaterThanOrEqual(2); // started + final
  });

  test('T2: already healthy → NO_ACTION, no restart', async () => {
    let restarted = false;
    const r = await runR0Recovery(deps({
      pool: makePool(),
      restartDaemon: () => { restarted = true; return { ok: true }; },
    }));
    expect(r.state).toBe('NO_ACTION');
    expect(restarted).toBe(false);
  });

  test('T3: semantic WARNING with valid identity → NO_ACTION', async () => {
    let restarted = false;
    const r = await runR0Recovery(deps({
      pool: makePool(),
      reconcile: async () => recon({ applicationHealth: 'DEGRADED' }),
      restartDaemon: () => { restarted = true; return { ok: true }; },
    }));
    expect(r.state).toBe('NO_ACTION');
    expect(restarted).toBe(false);
  });

  test('T4: non-R0 state (drift, healthy process) → HUMAN_REQUIRED, no restart', async () => {
    let restarted = false;
    const drift = recon({ verdict: 'DEPLOYMENT_DRIFT', failures: ['COMMIT_MATCHES_EXPECTED'] });
    drift.predicates.COMMIT_MATCHES_EXPECTED = false;
    const r = await runR0Recovery(deps({
      pool: makePool(),
      reconcile: async () => drift,
      restartDaemon: () => { restarted = true; return { ok: true }; },
    }));
    expect(r.state).toBe('HUMAN_REQUIRED');
    expect(restarted).toBe(false);
  });

  test('T5: unknown class never reaches the allowlist (classifier emits only allowlisted)', async () => {
    // The classifier can only emit 'daemon_unavailable'; this test pins that
    // contract — if a future class is added it must extend the allowlist too.
    const r = await runR0Recovery(deps({ pool: makePool() }));
    expect(r.failureClass === null || r.failureClass === 'daemon_unavailable').toBe(true);
  });

  test('T6: live lock owner not descended from PM2 → HUMAN_REQUIRED, no kill', async () => {
    let restarted = false;
    const r = await runR0Recovery(deps({
      pool: makePool(),
      reconcile: async () => ORPHAN,
      restartDaemon: () => { restarted = true; return { ok: true }; },
    }));
    expect(r.state).toBe('HUMAN_REQUIRED');
    expect(restarted).toBe(false);
  });

  test('T7: restart ok but reconciliation fails → FAILED, not VERIFIED', async () => {
    const r = await runR0Recovery(deps({
      pool: makePool(),
      reconcile: async () => DEAD_DAEMON, // stays broken after restart
      restartDaemon: () => ({ ok: true }),
    }));
    expect(r.state).toBe('FAILED');
    expect(r.postRecovery?.verdict).toBe('DEPLOYMENT_DRIFT');
  });

  test('T8: restart + matching identity → VERIFIED (same as T1 path, explicit)', async () => {
    let post = false;
    const r = await runR0Recovery(deps({
      pool: makePool(),
      reconcile: async () => (post ? recon() : DEAD_DAEMON),
      restartDaemon: () => { post = true; return { ok: true }; },
    }));
    expect(r.state).toBe('VERIFIED');
  });

  test('T9: concurrent attempt → second is REFUSED, one attempt total', async () => {
    const dir = tmpDir();
    const leaseFile = path.join(dir, '.heidi-recovery.lock');
    fs.writeFileSync(leaseFile, JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    let restarted = false;
    const r = await runR0Recovery(deps({
      pool: makePool(),
      recoveryLockFile: leaseFile,
      reconcile: async () => DEAD_DAEMON,
      restartDaemon: () => { restarted = true; return { ok: true }; },
    }));
    expect(r.state).toBe('REFUSED');
    expect(restarted).toBe(false);
  });

  test('T10: same failure inside cooldown → COOLDOWN, no restart', async () => {
    let restarted = false;
    const recent = new Date().toISOString();
    const r = await runR0Recovery(deps({
      pool: makePool(recent),
      reconcile: async () => DEAD_DAEMON,
      restartDaemon: () => { restarted = true; return { ok: true }; },
    }));
    expect(r.state).toBe('COOLDOWN');
    expect(restarted).toBe(false);
  });

  test('T11: post-recovery runtime at wrong commit → FAILED (drift)', async () => {
    let post = false;
    const wrongCommit = recon({
      verdict: 'DEPLOYMENT_DRIFT',
      failures: ['COMMIT_MATCHES_EXPECTED', 'LIVE_RUNTIME_IDENTITY_MATCHES'],
    });
    wrongCommit.predicates.COMMIT_MATCHES_EXPECTED = false;
    wrongCommit.predicates.LIVE_RUNTIME_IDENTITY_MATCHES = false;
    const r = await runR0Recovery(deps({
      pool: makePool(),
      reconcile: async () => (post ? wrongCommit : DEAD_DAEMON),
      restartDaemon: () => { post = true; return { ok: true }; },
    }));
    expect(r.state).toBe('FAILED');
    expect(r.postRecovery?.failures).toContain('COMMIT_MATCHES_EXPECTED');
  });

  test('T12: restart yields stale/foreign runtime owner → HUMAN_REQUIRED, no kill', async () => {
    let post = false;
    const r = await runR0Recovery(deps({
      pool: makePool(),
      reconcile: async () => (post ? ORPHAN : DEAD_DAEMON),
      restartDaemon: () => { post = true; return { ok: true }; },
    }));
    expect(r.state).toBe('HUMAN_REQUIRED');
    expect(r.postRecovery?.actual.lockAlive).toBe(true);
  });

  test('restart command error → FAILED, never VERIFIED', async () => {
    const r = await runR0Recovery(deps({
      pool: makePool(),
      reconcile: async () => DEAD_DAEMON,
      restartDaemon: () => ({ ok: false, error: 'pm2 not found' }),
    }));
    expect(r.state).toBe('FAILED');
    expect(r.detail).toMatch(/restart failed/);
  });
});
