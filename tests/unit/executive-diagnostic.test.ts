/**
 * ExecutiveDiagnostic unit tests — Tier 1 (hermetic, no sockets, no git).
 *
 * Proves the self-observation contract:
 *   - every dimension classifies into the 5-state vocabulary
 *   - UNKNOWN never collapses into HEALTHY
 *   - stale goals, dead loops, and pending authorizations surface correctly
 *   - deployment drift compares runtime HEAD against the qualified baseline
 *   - a failing dependency degrades its dimension, never the collection
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  collectExecutiveDiagnostic,
  overallStatus,
  type DiagnosticDimension,
  type ExecutiveDiagnosticDeps,
} from '../../lib/heidi/ExecutiveDiagnostic';

const NOW = new Date('2026-09-20T12:00:00Z').getTime();
const HOUR = 60 * 60 * 1000;
const iso = (msAgo: number) => new Date(NOW - msAgo).toISOString();

type FakeQuery = (sql: string, params?: unknown[]) => { rows: Array<Record<string, unknown>> };

function makeDeps(query: FakeQuery, over: Partial<ExecutiveDiagnosticDeps> = {}): ExecutiveDiagnosticDeps {
  return {
    pool: { query: async (sql, params) => query(sql, params) },
    goals: { getPendingWork: async () => [] },
    registry: { getSummary: () => ({ total: 10, available: 10, unavailable: 0 }) },
    repoDir: os.tmpdir(),
    gitInfo: () => ({ head: 'd89747b', branch: 'clean-main' }),
    expectedDeployment: { deployedHead: 'd89747b', branch: 'clean-main' },
    ownerAuthJournalPath: path.join(os.tmpdir(), `no-such-journal-${Math.random()}.jsonl`),
    now: () => NOW,
    ...over,
  };
}

/** A pool whose canned answers match the SQL shape each dimension emits. */
function healthyQuery(): FakeQuery {
  return (sql) => {
    if (sql.includes('SELECT 1')) return { rows: [{ ok: 1 }] };
    if (sql.includes("event_type = 'cognitive_cycle'"))
      return { rows: [{ latest: iso(60_000), timeouts_24h: 0, cycles_24h: 1400 }] };
    if (sql.includes('protoforge_mission_runs')) return { rows: [{ latest: iso(20 * HOUR) }] };
    if (sql.includes('FROM memories')) return { rows: [{ latest: iso(5 * 60_000) }] };
    if (sql.includes('operator_escalations')) return { rows: [{ open_total: 7222, open_24h: 0 }] };
    throw new Error(`unstubbed query: ${sql}`);
  };
}

function dim(report: { dimensions: DiagnosticDimension[] }, name: string): DiagnosticDimension {
  const d = report.dimensions.find((x) => x.name === name);
  if (!d) throw new Error(`dimension ${name} missing`);
  return d;
}

describe('overallStatus', () => {
  test('empty report is UNKNOWN, never HEALTHY', () => {
    expect(overallStatus([])).toBe('UNKNOWN');
  });
  test('UNKNOWN outranks HEALTHY', () => {
    const dims = [
      { name: 'a', status: 'HEALTHY', detail: '' },
      { name: 'b', status: 'UNKNOWN', detail: '' },
    ] as DiagnosticDimension[];
    expect(overallStatus(dims)).toBe('UNKNOWN');
  });
  test('FAILED beats everything', () => {
    const dims = [
      { name: 'a', status: 'DEGRADED', detail: '' },
      { name: 'b', status: 'FAILED', detail: '' },
      { name: 'c', status: 'BLOCKED', detail: '' },
    ] as DiagnosticDimension[];
    expect(overallStatus(dims)).toBe('FAILED');
  });
});

describe('collectExecutiveDiagnostic', () => {
  test('fully healthy system reports HEALTHY overall', async () => {
    const report = await collectExecutiveDiagnostic(makeDeps(healthyQuery()));
    expect(report.overall).toBe('HEALTHY');
    expect(report.dimensions.map((d) => d.name).sort()).toEqual([
      'authorizations',
      'capabilities',
      'cognitive_loop',
      'database',
      'escalations',
      'goals',
      'memory',
      'missions',
      'runtime_drift',
    ]);
    for (const d of report.dimensions) {
      expect(['HEALTHY', 'DEGRADED', 'BLOCKED', 'FAILED', 'UNKNOWN']).toContain(d.status);
    }
  });

  test('a dead database is FAILED, not silently skipped', async () => {
    const report = await collectExecutiveDiagnostic(
      makeDeps(() => {
        throw new Error('connection refused');
      }),
    );
    expect(dim(report, 'database').status).toBe('FAILED');
    expect(report.overall).toBe('FAILED');
  });

  test('a stale open goal degrades the goals dimension', async () => {
    const report = await collectExecutiveDiagnostic(
      makeDeps(healthyQuery(), {
        goals: {
          getPendingWork: async () => [
            { status: 'in_progress', title: 'parked', updatedAt: iso(72 * HOUR), createdAt: iso(72 * HOUR) },
          ],
        },
      }),
    );
    expect(dim(report, 'goals').status).toBe('DEGRADED');
    expect(report.overall).toBe('DEGRADED');
  });

  test('a dead cognitive loop is FAILED', async () => {
    const report = await collectExecutiveDiagnostic(
      makeDeps((sql) =>
        sql.includes("event_type = 'cognitive_cycle'")
          ? { rows: [{ latest: iso(5 * HOUR), timeouts_24h: 0, cycles_24h: 0 }] }
          : healthyQuery()(sql),
      ),
    );
    expect(dim(report, 'cognitive_loop').status).toBe('FAILED');
  });

  test('recent timeouts degrade an otherwise-live loop', async () => {
    const report = await collectExecutiveDiagnostic(
      makeDeps((sql) =>
        sql.includes("event_type = 'cognitive_cycle'")
          ? { rows: [{ latest: iso(60_000), timeouts_24h: 3, cycles_24h: 1400 }] }
          : healthyQuery()(sql),
      ),
    );
    expect(dim(report, 'cognitive_loop').status).toBe('DEGRADED');
  });

  test('pending owner authorizations classify BLOCKED', async () => {
    const journal = path.join(os.tmpdir(), `auth-journal-${Date.now()}.jsonl`);
    fs.writeFileSync(
      journal,
      [
        JSON.stringify({ id: 'a1', status: 'PENDING', expiresAt: null }),
        JSON.stringify({ id: 'a2', status: 'PENDING', expiresAt: null }),
        JSON.stringify({ id: 'a2', status: 'AUTHORIZED', expiresAt: null }),
      ].join('\n'),
    );
    try {
      const report = await collectExecutiveDiagnostic(
        makeDeps(healthyQuery(), { ownerAuthJournalPath: journal }),
      );
      const d = dim(report, 'authorizations');
      expect(d.status).toBe('BLOCKED');
      expect(d.metrics?.pending).toBe(1); // a2 was decided — only a1 pending
      expect(report.overall).toBe('BLOCKED');
    } finally {
      fs.unlinkSync(journal);
    }
  });

  test('runtime drift detects a commit that differs from the qualified deployment', async () => {
    const report = await collectExecutiveDiagnostic(
      makeDeps(healthyQuery(), {
        gitInfo: () => ({ head: 'aaaaaaa', branch: 'clean-main' }),
        expectedDeployment: { deployedHead: 'd89747b', branch: 'clean-main' },
      }),
    );
    expect(dim(report, 'runtime_drift').status).toBe('DEGRADED');
    expect(report.overall).toBe('DEGRADED');
  });

  test('no qualified baseline reports UNKNOWN — not HEALTHY', async () => {
    const report = await collectExecutiveDiagnostic(
      makeDeps(healthyQuery(), { expectedDeployment: null }),
    );
    expect(dim(report, 'runtime_drift').status).toBe('UNKNOWN');
    expect(report.overall).toBe('UNKNOWN');
  });

  test('a missing optional dependency marks only its dimension UNKNOWN', async () => {
    const report = await collectExecutiveDiagnostic(
      makeDeps(healthyQuery(), { goals: null, registry: null }),
    );
    expect(dim(report, 'goals').status).toBe('UNKNOWN');
    expect(dim(report, 'capabilities').status).toBe('UNKNOWN');
    expect(dim(report, 'database').status).toBe('HEALTHY');
    expect(report.overall).toBe('UNKNOWN');
  });

  test('a table that does not exist marks its dimension UNKNOWN, not HEALTHY', async () => {
    const report = await collectExecutiveDiagnostic(
      makeDeps((sql) => {
        if (sql.includes('protoforge_mission_runs')) throw new Error('relation does not exist');
        return healthyQuery()(sql);
      }),
    );
    expect(dim(report, 'missions').status).toBe('UNKNOWN');
    expect(report.overall).toBe('UNKNOWN');
  });
});
