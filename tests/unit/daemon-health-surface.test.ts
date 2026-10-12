/**
 * Daemon status surface — behavioral tests.
 *
 * The contract these tests pin: a health surface must report what the
 * daemon last observed, never liveness-by-file-existence. The motivating
 * incident ran 6h of RECOVERABLE_FAILURE cycles while every external
 * signal stayed green because nothing read the daemon's own verdict.
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  writeDaemonStatus,
  readDaemonStatus,
  assessDaemonHealth,
  statusPath,
  DAEMON_STATUS_STALE_MS,
  type DaemonStatusSnapshot,
  type PersistenceTruth,
} from '../../lib/heidi/DaemonStatusSurface';

let root: string;
const OK_PERSISTENCE: PersistenceTruth = { pg: 'ok', rest: 'ok', checkedAt: new Date().toISOString() };

function snapshot(overrides: Partial<DaemonStatusSnapshot> = {}): DaemonStatusSnapshot {
  return {
    pid: 1234,
    state: 'running',
    cycleCount: 42,
    lastCycleAt: new Date().toISOString(),
    lastSuccessfulCycleAt: new Date().toISOString(),
    lastCycleOutcome: 'SUCCESS',
    consecutiveFailures: 0,
    lastError: null,
    lastErrorAt: null,
    persistence: OK_PERSISTENCE,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'daemon-surface-'));
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('writeDaemonStatus / readDaemonStatus', () => {
  it('round-trips a snapshot through the status file', () => {
    const snap = snapshot();
    expect(writeDaemonStatus(root, snap)).toBeNull();
    expect(fs.existsSync(statusPath(root))).toBe(true);
    expect(readDaemonStatus(root)).toEqual(snap);
  });

  it('leaves no temp file behind after the atomic rename', () => {
    writeDaemonStatus(root, snapshot());
    const leftovers = fs.readdirSync(root).filter((f) => f.includes('.tmp-'));
    expect(leftovers).toEqual([]);
  });

  it('returns an error string instead of throwing when the root is unwritable', () => {
    const missing = path.join(root, 'does', 'not', 'exist');
    const err = writeDaemonStatus(missing, snapshot());
    expect(typeof err).toBe('string');
  });

  it('readDaemonStatus returns null for a corrupt file', () => {
    fs.writeFileSync(statusPath(root), '{not json');
    expect(readDaemonStatus(root)).toBeNull();
  });
});

describe('assessDaemonHealth', () => {
  it('reports NOT_RUNNING when no status file exists', () => {
    const v = assessDaemonHealth(root);
    expect(v.healthy).toBe(false);
    expect(v.state).toBe('NOT_RUNNING');
  });

  it('reports CORRUPT when the file cannot be parsed', () => {
    fs.writeFileSync(statusPath(root), 'not-json-at-all');
    const v = assessDaemonHealth(root);
    expect(v.healthy).toBe(false);
    expect(v.state).toBe('CORRUPT');
  });

  it('reports HEALTHY for a fresh successful snapshot', () => {
    writeDaemonStatus(root, snapshot());
    const v = assessDaemonHealth(root);
    expect(v.healthy).toBe(true);
    expect(v.state).toBe('HEALTHY');
    expect(v.details.lastCycleOutcome).toBe('SUCCESS');
    expect(v.details.persistence?.pg).toBe('ok');
  });

  it('reports DEGRADED when the last cycle failed recoverably — the 2026-10-12 incident shape', () => {
    writeDaemonStatus(root, snapshot({
      lastCycleOutcome: 'RECOVERABLE_FAILURE',
      lastError: 'Cycle timed out after 30000ms',
      lastErrorAt: new Date().toISOString(),
    }));
    const v = assessDaemonHealth(root);
    expect(v.healthy).toBe(false);
    expect(v.state).toBe('DEGRADED');
    expect(v.reasons.join(' ')).toContain('RECOVERABLE_FAILURE');
  });

  it('reports DEGRADED on consecutive failures even when the outcome field lags', () => {
    writeDaemonStatus(root, snapshot({ lastCycleOutcome: null, consecutiveFailures: 3 }));
    const v = assessDaemonHealth(root);
    expect(v.healthy).toBe(false);
    expect(v.state).toBe('DEGRADED');
    expect(v.reasons.join(' ')).toContain('3 consecutive');
  });

  it('reports DEGRADED when a persistence probe found postgres down', () => {
    writeDaemonStatus(root, snapshot({
      persistence: { pg: 'down', rest: 'ok', checkedAt: new Date().toISOString() },
    }));
    const v = assessDaemonHealth(root);
    expect(v.healthy).toBe(false);
    expect(v.state).toBe('DEGRADED');
    expect(v.reasons.join(' ')).toContain('postgres');
  });

  it('reports DEGRADED when a persistence probe found the REST gateway down', () => {
    writeDaemonStatus(root, snapshot({
      persistence: { pg: 'ok', rest: 'down', checkedAt: new Date().toISOString() },
    }));
    const v = assessDaemonHealth(root);
    expect(v.healthy).toBe(false);
    expect(v.reasons.join(' ')).toContain('REST');
  });

  it('reports STALE for an old snapshot — a past SUCCESS proves nothing about now', () => {
    const old = new Date(Date.now() - DAEMON_STATUS_STALE_MS - 1000).toISOString();
    writeDaemonStatus(root, snapshot({ updatedAt: old }));
    const v = assessDaemonHealth(root);
    expect(v.healthy).toBe(false);
    expect(v.state).toBe('STALE');
  });

  it('reports STALE when updatedAt is unparseable', () => {
    writeDaemonStatus(root, snapshot({ updatedAt: 'not-a-date' }));
    expect(assessDaemonHealth(root).state).toBe('STALE');
  });

  it('staleness outranks a recorded failure — the verdict names the freshest problem', () => {
    const old = new Date(Date.now() - DAEMON_STATUS_STALE_MS - 1000).toISOString();
    writeDaemonStatus(root, snapshot({ lastCycleOutcome: 'HARD_FAILURE', updatedAt: old }));
    expect(assessDaemonHealth(root).state).toBe('STALE');
  });

  it('reports DEGRADED when the loop itself says failed or stopped', () => {
    writeDaemonStatus(root, snapshot({ state: 'failed' }));
    const v = assessDaemonHealth(root);
    expect(v.healthy).toBe(false);
    expect(v.state).toBe('DEGRADED');
    expect(v.reasons.join(' ')).toContain("'failed'");
  });

  it('a daemon that has not cycled yet but reports fresh and ok is HEALTHY (startup grace)', () => {
    writeDaemonStatus(root, snapshot({ cycleCount: 0, lastCycleAt: null, lastCycleOutcome: null }));
    const v = assessDaemonHealth(root);
    expect(v.healthy).toBe(true);
  });

  it('recovers to HEALTHY when a later snapshot shows recovery — verdict follows freshest evidence', () => {
    writeDaemonStatus(root, snapshot({ lastCycleOutcome: 'RECOVERABLE_FAILURE', consecutiveFailures: 2 }));
    expect(assessDaemonHealth(root).state).toBe('DEGRADED');
    writeDaemonStatus(root, snapshot());
    const v = assessDaemonHealth(root);
    expect(v.healthy).toBe(true);
    expect(v.state).toBe('HEALTHY');
  });
});
