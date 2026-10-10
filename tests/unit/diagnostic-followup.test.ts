/**
 * DiagnosticFollowup unit tests — Tier 1 (hermetic, no sockets, no git).
 *
 * Proves the investigation contract:
 *   - findings carry evidence, not adjectives
 *   - no diagnostic baseline is itself a finding, not silence
 *   - HEALTHY dimensions produce no findings
 *   - a wedged loop (timeouts, no successes) escalates to human_review
 *   - a live-but-timing-out loop is a bounded_task, not a human interrupt
 *   - investigator failure degrades that finding to UNKNOWN, never crashes
 */

import {
  collectDiagnosticFollowup,
  type DiagnosticFinding,
  type FollowupDeps,
} from '../../lib/heidi/DiagnosticFollowup';
import type { DiagnosticDimension } from '../../lib/heidi/ExecutiveDiagnostic';

const NOW = new Date('2026-09-21T12:00:00Z').getTime();

function dim(name: string, status: DiagnosticDimension['status'], detail = 'x'): DiagnosticDimension {
  return { name, status, detail };
}

function diagnosticEvent(dimensions: DiagnosticDimension[]) {
  return {
    id: 'diag-1',
    created_at: new Date(NOW - 10 * 60_000).toISOString(),
    payload: { overall: 'DEGRADED', dimensions },
  };
}

type FakeQuery = (sql: string, params?: unknown[]) => { rows: Array<Record<string, unknown>> };

function makeDeps(query: FakeQuery, over: Partial<FollowupDeps> = {}): FollowupDeps {
  return {
    pool: { query: async (sql, params) => query(sql, params) },
    repoDir: 'C:/nonexistent',
    gitInfo: () => ({ head: '826d8a2', branch: 'clean-main', dirtyFiles: 42 }),
    now: () => NOW,
    ...over,
  };
}

function find(report: { findings: DiagnosticFinding[] }, name: string): DiagnosticFinding {
  const f = report.findings.find((x) => x.dimension === name);
  if (!f) throw new Error(`finding ${name} missing`);
  return f;
}

describe('collectDiagnosticFollowup', () => {
  test('no diagnostic event produces an explicit UNKNOWN-ish finding, not silence', async () => {
    const report = await collectDiagnosticFollowup(
      makeDeps(() => ({ rows: [] })),
    );
    expect(report.diagnosticEventId).toBeNull();
    expect(report.findings).toHaveLength(1);
    expect(report.findings[0].dimension).toBe('executive_diagnostic');
    expect(report.verdict).not.toBe('HEALTHY');
  });

  test('all-HEALTHY diagnostic produces zero findings and HEALTHY verdict', async () => {
    const report = await collectDiagnosticFollowup(
      makeDeps((sql) =>
        sql.includes('executive_diagnostic')
          ? { rows: [diagnosticEvent([dim('database', 'HEALTHY'), dim('goals', 'HEALTHY')])] }
          : { rows: [] },
      ),
    );
    expect(report.findings).toHaveLength(0);
    expect(report.verdict).toBe('HEALTHY');
  });

  test('timeouts with continued successes → bounded_task, not human_required', async () => {
    const q: FakeQuery = (sql) => {
      if (sql.includes('executive_diagnostic'))
        return { rows: [diagnosticEvent([dim('cognitive_loop', 'DEGRADED')])] };
      if (sql.includes("payload->>'outcome' = 'timeout'\n     ORDER BY"))
        return { rows: [{ created_at: 't', consecutive_failures: 0, cycle_timeout_ms: 30000 }] };
      if (sql.includes('date_trunc'))
        return { rows: [{ hr: 'h1', n: 39 }] };
      if (sql.includes('GROUP BY 1'))
        return { rows: [{ outcome: 'success', n: 1400, avg_ms: 9000 }, { outcome: 'timeout', n: 39, avg_ms: null }] };
      return { rows: [] };
    };
    const report = await collectDiagnosticFollowup(makeDeps(q));
    const f = find(report, 'cognitive_loop');
    expect(f.suggestedFollowup).toBe('bounded_task');
    expect(f.humanRequired).toBe(false);
    expect(f.evidence.timeouts24h).toBe(39);
    expect(report.verdict).toBe('DEGRADED');
  });

  test('timeouts with NO successes → human_review', async () => {
    const q: FakeQuery = (sql) => {
      if (sql.includes('executive_diagnostic'))
        return { rows: [diagnosticEvent([dim('cognitive_loop', 'FAILED')])] };
      if (sql.includes('date_trunc')) return { rows: [{ hr: 'h1', n: 50 }] };
      if (sql.includes('GROUP BY 1')) return { rows: [{ outcome: 'timeout', n: 50, avg_ms: null }] };
      return { rows: [] };
    };
    const report = await collectDiagnosticFollowup(makeDeps(q));
    const f = find(report, 'cognitive_loop');
    expect(f.humanRequired).toBe(true);
    expect(f.suggestedFollowup).toBe('human_review');
    expect(report.verdict).toBe('BLOCKED');
  });

  test('escalation investigation reports distinct-key ratio and categories', async () => {
    const q: FakeQuery = (sql) => {
      if (sql.includes('executive_diagnostic'))
        return { rows: [diagnosticEvent([dim('escalations', 'DEGRADED')])] };
      if (sql.includes('DISTINCT COALESCE'))
        return { rows: [{ distinct_keys: 12, total: 243 }] };
      if (sql.includes('GROUP BY 1, 2'))
        return { rows: [{ category: 'stuck_job', title: 'Job stuck', count: 200 }] };
      if (sql.includes('GROUP BY 1 ORDER BY 2'))
        return { rows: [{ category: 'stuck_job', n: 240 }, { category: 'test', n: 3 }] };
      return { rows: [] };
    };
    const report = await collectDiagnosticFollowup(makeDeps(q));
    const f = find(report, 'escalations');
    expect(f.evidence.newOpen24h).toBe(243);
    expect(f.evidence.distinctKeys24h).toBe(12);
    expect(f.suggestedFollowup).toBe('bounded_task');
    expect(f.taskTemplate).toBe('ops.investigate_escalation_growth');
  });

  test('runtime drift finding reports head vs qualified and dirty count', async () => {
    const report = await collectDiagnosticFollowup(
      makeDeps(
        (sql) =>
          sql.includes('executive_diagnostic')
            ? { rows: [diagnosticEvent([dim('runtime_drift', 'DEGRADED')])] }
            : { rows: [] },
        {
          gitInfo: () => ({ head: 'aaaaaaa', branch: 'clean-main', dirtyFiles: 42 }),
          // no expectedDeployment file at repoDir — baseline file absent → UNKNOWN internally
        },
      ),
    );
    const f = find(report, 'runtime_drift');
    expect(f.evidence.head).toBe('aaaaaaa');
    expect(f.evidence.dirtyFiles).toBe(42);
  });

  test('investigator failure produces UNKNOWN finding, not a crash', async () => {
    const report = await collectDiagnosticFollowup(
      makeDeps((sql) => {
        if (sql.includes('executive_diagnostic'))
          return { rows: [diagnosticEvent([dim('escalations', 'DEGRADED')])] };
        throw new Error('relation operator_escalations does not exist');
      }),
    );
    const f = find(report, 'escalations');
    expect(f.severity).toBe('UNKNOWN');
    expect(f.humanRequired).toBe(true);
    expect(report.verdict).toBe('BLOCKED');
  });

  test('generic dimensions without investigators carry their evidence forward', async () => {
    const report = await collectDiagnosticFollowup(
      makeDeps((sql) =>
        sql.includes('executive_diagnostic')
          ? {
              rows: [
                diagnosticEvent([
                  { name: 'memory', status: 'DEGRADED', detail: 'no memory stored in 30h', metrics: { lastMemoryAgeMs: 108000000 } },
                ]),
              ],
            }
          : { rows: [] },
      ),
    );
    const f = find(report, 'memory');
    expect(f.evidence.diagnosticDetail).toContain('30h');
    expect(f.humanRequired).toBe(false);
    expect(report.verdict).toBe('DEGRADED');
  });
});
