'use strict';

/**
 * scripts/protoforge-opportunity-scheduler.js -- hermetic tests.
 *
 * `runCycle(deps)` takes its mission-runner, its Supabase client, and its
 * lock as injectable dependencies (mirrors tests/unit/system-health-
 * producer.test.js's convention for scripts/system-health-scheduler.js).
 * No test here spawns a real child process, makes a real network call, or
 * touches the real .protoforge-scout.lock file.
 *
 * PROTOFORGE_SCOUT_LOG_PATH is set to an isolated temp file BEFORE
 * requiring the module below, so every log() call this suite triggers
 * (runCycle logs unconditionally, it isn't behind an injectable dep)
 * lands there instead of the real logs/protoforge-opportunity-scheduler.log
 * -- that file previously accumulated fake cycle lines (fabricated
 * timestamps, pid=424242, synthetic error text) from exactly this test
 * file, indistinguishable from genuine scheduler activity without cross-
 * referencing the PM2-captured log as a tiebreaker.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const TEST_LOG_PATH = path.join(os.tmpdir(), `protoforge-scheduler-test-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
process.env.PROTOFORGE_SCOUT_LOG_PATH = TEST_LOG_PATH;

const { runCycle, killChildTree } = require('../../scripts/protoforge-opportunity-scheduler');
const { MissionRunLock } = require('../../scripts/mission-run-lock');

afterAll(() => {
  delete process.env.PROTOFORGE_SCOUT_LOG_PATH;
  try { fs.unlinkSync(TEST_LOG_PATH); } catch (_) { /* fine if it was never created */ }
});

/** Minimal chainable Supabase stub: .from().select().order().limit() resolves to `result`. */
function supabaseReturning(sequence) {
  let i = 0;
  return {
    from() {
      return {
        select() {
          return {
            order() {
              return {
                limit: async () => {
                  const r = sequence[Math.min(i, sequence.length - 1)];
                  i += 1;
                  return r;
                },
              };
            },
          };
        },
      };
    },
  };
}

const row = (runAt) => ({ data: [{ run_at: runAt }], error: null });
const empty = { data: [], error: null };
const failed = (message) => ({ data: null, error: { message } });

const missionRun = (over = {}) => async () => ({ timedOut: false, code: 0, stdout: '{}', stderr: '', ...over });

/** A lock double that always grants, for tests where locking isn't the thing under test. */
function alwaysAvailableLock() {
  return { acquire: jest.fn(() => ({ acquired: true, reclaimedStale: false })), release: jest.fn(), isActive: () => false };
}

describe('runCycle: Test A -- normal scheduled execution', () => {
  it('reports ok+persisted when the mission runs and run_at genuinely advances', async () => {
    const supabase = supabaseReturning([empty, row('2026-01-01T00:00:05Z')]);
    const lock = alwaysAvailableLock();
    const result = await runCycle({ runMissionScript: missionRun(), supabase, lock });
    expect(result).toMatchObject({ ok: true, persisted: true, runAt: '2026-01-01T00:00:05Z' });
    expect(lock.acquire).toHaveBeenCalledTimes(1);
    expect(lock.release).toHaveBeenCalledTimes(1);
  });
});

describe('runCycle: Test B -- overlapping execution is rejected, not run', () => {
  it('skips the cycle entirely when the lock is already held -- never touches the mission runner or Supabase', async () => {
    const runMissionScript = jest.fn();
    const supabase = { from: jest.fn() };
    const lock = {
      acquire: jest.fn(() => ({ acquired: false, reason: 'active', holder: { pid: 424242, startedAt: '2026-01-01T00:00:00Z' } })),
      release: jest.fn(),
    };
    const result = await runCycle({ runMissionScript, supabase, lock });
    expect(result).toMatchObject({ ok: true, skipped: true, persisted: false, reason: 'overlap' });
    expect(runMissionScript).not.toHaveBeenCalled();
    expect(supabase.from).not.toHaveBeenCalled();
    // A skip never held the lock, so it must not try to release one it never acquired.
    expect(lock.release).not.toHaveBeenCalled();
  });
});

describe('runCycle: Test C -- mission failure', () => {
  it('reports NOT persisted when the mission exits nonzero and writes nothing', async () => {
    const supabase = supabaseReturning([row('2026-01-01T00:00:00Z'), row('2026-01-01T00:00:00Z')]); // run_at did not advance
    const lock = alwaysAvailableLock();
    const result = await runCycle({ runMissionScript: missionRun({ code: 1, stderr: 'boom' }), supabase, lock });
    expect(result.ok).toBe(false);
    expect(result.persisted).toBe(false);
    expect(result.reason).toMatch(/did not advance/);
  });

  it('still releases the lock when the mission runner itself throws', async () => {
    const supabase = supabaseReturning([empty]);
    const lock = alwaysAvailableLock();
    const throwing = async () => { throw new Error('mission crashed'); };
    await expect(runCycle({ runMissionScript: throwing, supabase, lock })).rejects.toThrow('mission crashed');
    expect(lock.release).toHaveBeenCalledTimes(1); // the `finally` block, not a happy-path-only release
  });
});

describe('runCycle: Test D -- mission timeout', () => {
  it('reports CYCLE FAILED with reason=timeout and never claims persistence', async () => {
    const supabase = supabaseReturning([empty]);
    const lock = alwaysAvailableLock();
    const result = await runCycle({ runMissionScript: missionRun({ timedOut: true, code: null }), supabase, lock });
    expect(result).toMatchObject({ ok: false, persisted: false, reason: 'timeout' });
    expect(lock.release).toHaveBeenCalledTimes(1);
  });
});

describe('runCycle: Test E -- scheduler restart (stale lock from a prior crashed instance)', () => {
  it('a fresh scheduler process still completes a real cycle despite a stale lock left by a previous one', async () => {
    // Simulate: the previous scheduler process crashed mid-cycle and never
    // released its lock. A NEW instance (this test) must still be able to
    // run -- proving a restart is not permanently wedged by its own past self.
    const realLock = new MissionRunLock(require('path').join(require('os').tmpdir(), `scheduler-restart-test-${Date.now()}.lock`));
    require('fs').writeFileSync(realLock.lockPath, JSON.stringify({ pid: 999999, startedAt: new Date().toISOString() }));

    const supabase = supabaseReturning([empty, row('2026-01-01T00:00:05Z')]);
    const result = await runCycle({ runMissionScript: missionRun(), supabase, lock: realLock });

    expect(result).toMatchObject({ ok: true, persisted: true });
    expect(require('fs').existsSync(realLock.lockPath)).toBe(false); // released cleanly after use
  });
});

describe('runCycle: Test J -- persistence failure', () => {
  it('reports NOT_PERSISTED, not a false success, when reading the result back fails', async () => {
    const supabase = supabaseReturning([empty, failed('connection reset')]);
    const lock = alwaysAvailableLock();
    const result = await runCycle({ runMissionScript: missionRun(), supabase, lock });
    expect(result.ok).toBe(false);
    expect(result.persisted).toBe(false);
    expect(result.reason).toBe('connection reset');
  });

  it('reports a clear failure (not a crash) when Supabase credentials are entirely missing', async () => {
    const lock = alwaysAvailableLock();
    const originalUrl = process.env.SUPABASE_URL;
    const originalKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    try {
      const result = await runCycle({ runMissionScript: missionRun(), lock }); // no supabase dep -- forces getSupabase()
      expect(result.ok).toBe(false);
      expect(result.reason).toMatch(/SUPABASE_URL/);
    } finally {
      if (originalUrl !== undefined) process.env.SUPABASE_URL = originalUrl;
      if (originalKey !== undefined) process.env.SUPABASE_SERVICE_ROLE_KEY = originalKey;
    }
  });
});

describe('Test G -- graceful shutdown: killChildTree really stops a process (real, disposable, non-HYDI child)', () => {
  it('terminates a genuinely running child process rather than leaving it orphaned', async () => {
    const { spawn } = require('child_process');
    // A harmless, disposable child that would otherwise run for 30s -- not
    // any part of HYDI, spawned only to prove killChildTree actually works.
    const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 30000)']);
    await new Promise((resolve) => setTimeout(resolve, 200)); // let it actually start

    killChildTree(child);
    const exited = await new Promise((resolve) => {
      const timer = setTimeout(() => resolve(false), 5000);
      child.on('exit', () => { clearTimeout(timer); resolve(true); });
    });
    expect(exited).toBe(true);
  }, 10000);

  it('is a no-op for an already-exited child (does not throw)', async () => {
    const { spawn } = require('child_process');
    const child = spawn(process.execPath, ['-e', '']);
    await new Promise((resolve) => child.on('exit', resolve));
    expect(() => killChildTree(child)).not.toThrow();
  });

  it('is a no-op for null/undefined', () => {
    expect(() => killChildTree(null)).not.toThrow();
    expect(() => killChildTree(undefined)).not.toThrow();
  });
});
