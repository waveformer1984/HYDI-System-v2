/**
 * DeploymentReconciliation tests — Tier 1 (hermetic, all OS seams injected).
 *
 * The invariant under test: a deployment is QUALIFIED only when the process
 * PM2 believes is running is the same process actually executing cycles —
 * pid ancestry, canonical cwd, commit, singleton ownership, and live cycle
 * identity all agree. Any mismatch is DEPLOYMENT_DRIFT; anything
 * unobservable is UNKNOWN. "PM2 online" alone never qualifies.
 */

import fs from 'fs';
import os from 'os';
import path from 'path';
import {
  collectReconciliation,
  type ReconcileDeps,
  type Pm2Proc,
} from '../../lib/heidi/DeploymentReconciliation';

const CANON = 'C:\\Users\\Owner\\HYDI-System-v2';
const HEAD = '27aa9ee';

function tmpDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'recon-'));
}

function writeLock(dir: string, data: unknown): string {
  const f = path.join(dir, '.heidi-daemon.lock');
  fs.writeFileSync(f, JSON.stringify(data));
  return f;
}

function writeQualified(dir: string, head: string | null): string {
  const f = path.join(dir, 'qualified-deployment.json');
  fs.writeFileSync(f, JSON.stringify({ deployedHead: head }));
  return f;
}

/** pool stub: latest cycle row + system_dashboard status */
function makePool(cycle: { pid: number; commit: string; created_at: Date } | null, dashboard = 'OK') {
  return {
    query: async (sql: string) => {
      if (/system_dashboard/.test(sql)) return { rows: [{ current_status: dashboard }] };
      if (/cognitive_cycle/.test(sql)) {
        return {
          rows: cycle
            ? [{ created_at: cycle.created_at, pid: String(cycle.pid), commit: cycle.commit }]
            : [],
        };
      }
      return { rows: [] };
    },
  };
}

function pm2Proc(pid: number, status = 'online', cwd = CANON): Pm2Proc {
  return { pid, name: 'hydi-daemon', status, cwd, restarts: 3 };
}

/** parents map: lockPid → tsxCli → pm2Pid mimics the real fork chain */
function parentsOf(map: Record<number, number>) {
  return (pid: number) => map[pid] ?? null;
}

// Note: process.kill(pid,0) is used for liveness. Two distinct LIVE pids:
// LIVE stands in for the PM2-tracked pid; CHILD (the test process's real
// parent, guaranteed alive) stands in for the daemon child lock owner.
const LIVE = process.pid;
const CHILD = process.ppid ?? process.pid;
const DEAD = 99999999;

function baseDeps(
  dir: string,
  over: Partial<ReconcileDeps> & { lock?: Record<string, unknown>; qualifiedHead?: string | null } = {},
): ReconcileDeps {
  const { lock, qualifiedHead, ...rest } = over;
  const lockFile = writeLock(dir, lock ?? {
    pid: CHILD, commit: HEAD, cwd: CANON, startedAt: new Date().toISOString(),
  });
  const qualifiedFile = writeQualified(dir, qualifiedHead === undefined ? HEAD : qualifiedHead);
  return {
    pool: makePool({ pid: CHILD, commit: HEAD, created_at: new Date() }) as any,
    repoDir: CANON,
    lockFile,
    qualifiedFile,
    pm2List: async () => [pm2Proc(LIVE)],
    parentPid: parentsOf({ [CHILD]: LIVE }),
    now: () => Date.now(),
    ...rest,
  };
}

describe('deployment reconciliation', () => {
  test('T1: full identity agreement → QUALIFIED', async () => {
    const dir = tmpDir();
    const r = await collectReconciliation(baseDeps(dir));
    expect(r.verdict).toBe('QUALIFIED');
    expect(r.deploymentIdentity).toBe('VALID');
    expect(r.applicationHealth).toBe('HEALTHY');
    expect(r.failures).toEqual([]);
  });

  test('T2: runtime commit differs from expected → DEPLOYMENT_DRIFT', async () => {
    const dir = tmpDir();
    const deps = baseDeps(dir, {
      lock: { pid: CHILD, commit: 'oldcommit', cwd: CANON },
      pool: makePool({ pid: CHILD, commit: 'oldcommit', created_at: new Date() }) as any,
    });
    const r = await collectReconciliation(deps);
    expect(r.verdict).toBe('DEPLOYMENT_DRIFT');
    expect(r.failures).toContain('COMMIT_MATCHES_EXPECTED');
    expect(r.failures).toContain('LIVE_RUNTIME_IDENTITY_MATCHES');
  });

  test('T3: lock owner is not a PM2 descendant → DEPLOYMENT_DRIFT', async () => {
    const dir = tmpDir();
    // lock owner alive but its parent chain leads to a dead pid, not PM2
    const deps = baseDeps(dir, { parentPid: parentsOf({ [CHILD]: DEAD }) });
    const r = await collectReconciliation(deps);
    expect(r.verdict).toBe('DEPLOYMENT_DRIFT');
    expect(r.failures).toContain('PID_MATCHES');
    expect(r.failures).toContain('SINGLETON_OWNER_MATCHES');
  });

  test('T4: PM2 cwd outside canonical repo → DEPLOYMENT_DRIFT', async () => {
    const dir = tmpDir();
    const deps = baseDeps(dir, {
      pm2List: async () => [pm2Proc(LIVE, 'online', 'C:\\Users\\Owner\\HYDI_System')],
    });
    const r = await collectReconciliation(deps);
    expect(r.verdict).toBe('DEPLOYMENT_DRIFT');
    expect(r.failures).toContain('CWD_CANONICAL');
  });

  test('T5: lock held by a dead stale owner while PM2 reports online → DRIFT', async () => {
    const dir = tmpDir();
    // stale owner: lock pid dead; PM2 online; live cycle written by stale pid
    const deps = baseDeps(dir, {
      lock: { pid: DEAD, commit: HEAD, cwd: CANON },
      pool: makePool({ pid: DEAD, commit: HEAD, created_at: new Date() }) as any,
    });
    const r = await collectReconciliation(deps);
    expect(r.verdict).toBe('DEPLOYMENT_DRIFT');
    // The stale owner wrote the cycle rows itself, so live-cycle identity
    // is self-consistent — ancestry + liveness are what expose the orphan.
    expect(r.failures).toEqual(
      expect.arrayContaining(['PROCESS_EXISTS', 'PID_MATCHES', 'SINGLETON_OWNER_MATCHES']),
    );
  });

  test('T6: application degradation does not invalidate deployment identity', async () => {
    const dir = tmpDir();
    const deps = baseDeps(dir, {
      pool: makePool({ pid: CHILD, commit: HEAD, created_at: new Date() }, 'WARNING') as any,
    });
    const r = await collectReconciliation(deps);
    expect(r.verdict).toBe('QUALIFIED');
    expect(r.deploymentIdentity).toBe('VALID');
    expect(r.applicationHealth).toBe('DEGRADED');
  });

  test('T9: PM2 online alone never qualifies — no cycle identity → UNKNOWN', async () => {
    const dir = tmpDir();
    // no runtimeIdentity rows at all
    const deps = baseDeps(dir, { pool: makePool(null) as any });
    const r = await collectReconciliation(deps);
    expect(r.verdict).not.toBe('QUALIFIED');
    expect(r.deploymentIdentity).not.toBe('VALID');
  });

  test('stale cycle (older than freshness window) is not live proof', async () => {
    const dir = tmpDir();
    const deps = baseDeps(dir, {
      pool: makePool({ pid: CHILD, commit: HEAD, created_at: new Date(Date.now() - 30 * 60 * 1000) }) as any,
    });
    const r = await collectReconciliation(deps);
    expect(r.verdict).toBe('DEPLOYMENT_DRIFT');
    expect(r.failures).toContain('LIVE_RUNTIME_IDENTITY_MATCHES');
  });

  test('cycle written by a different pid than lock owner → DRIFT', async () => {
    const dir = tmpDir();
    const deps = baseDeps(dir, {
      pool: makePool({ pid: LIVE + 1, commit: HEAD, created_at: new Date() }) as any,
    });
    const r = await collectReconciliation(deps);
    expect(r.verdict).toBe('DEPLOYMENT_DRIFT');
    expect(r.failures).toContain('LIVE_RUNTIME_IDENTITY_MATCHES');
  });

  test('missing lock file → UNKNOWN, not drift, not qualified', async () => {
    const dir = tmpDir();
    const deps = baseDeps(dir);
    fs.unlinkSync(deps.lockFile!);
    const r = await collectReconciliation(deps);
    expect(r.verdict).toBe('UNKNOWN');
    expect(r.deploymentIdentity).toBe('UNPROVEN');
  });

  test('missing qualified baseline → UNKNOWN (expected commit unobservable)', async () => {
    const dir = tmpDir();
    const deps = baseDeps(dir);
    fs.unlinkSync(deps.qualifiedFile!);
    const r = await collectReconciliation(deps);
    expect(r.verdict).toBe('UNKNOWN');
  });

  test('expectedCommit override qualifies a new head the file does not know', async () => {
    const dir = tmpDir();
    const deps = baseDeps(dir, {
      qualifiedHead: 'previoushead', // qualified file still on old head
      lock: { pid: CHILD, commit: 'newhead', cwd: CANON },
      expectedCommit: 'newhead',
      pool: makePool({ pid: CHILD, commit: 'newhead', created_at: new Date() }) as any,
    });
    const r = await collectReconciliation(deps);
    expect(r.verdict).toBe('QUALIFIED');
  });
});
