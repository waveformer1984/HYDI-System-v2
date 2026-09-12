/**
 * System health producer.
 *
 * `/api/health` reported status:"degraded" with hydi_status:null forever, not
 * because anything was unhealthy but because nothing had ever written a row:
 *
 *   api/health.js:49   isHealthy = dashboard.current_status === 'OK' && ...
 *   system_dashboard   current_status = (SELECT status FROM system_health_runs
 *                                          ORDER BY run_at DESC LIMIT 1)
 *   system_health_runs 0 rows -> scalar subquery NULL -> "degraded"
 *
 * scripts/system-health-scheduler.js supplies the missing producer. The part
 * worth pinning down is not that it runs the check — it is that it refuses to
 * claim success unless a row actually landed, because true-system-health.js
 * swallows its own persistence errors ("Silently fail persistence").
 */

'use strict';

const path = require('path');
const scheduler = require('../../scripts/system-health-scheduler');

/** Minimal supabase stub: .from().select().order().limit() resolves to `result`. */
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

const healthRun = (over = {}) => async () => ({
  timedOut: false,
  code: 0,
  stdout: JSON.stringify({ status: 'OK', components: {} }),
  stderr: '',
  ...over,
});

describe('parseStatus', () => {
  it('reads the status out of --json output', () => {
    expect(scheduler.parseStatus(JSON.stringify({ status: 'OK' }))).toBe('OK');
    expect(scheduler.parseStatus(JSON.stringify({ status: 'CRITICAL' }))).toBe('CRITICAL');
  });

  it('tolerates leading human-readable log noise before the JSON', () => {
    const out = 'TRUE SYSTEM HEALTH CHECK\n====\n' + JSON.stringify({ status: 'WARNING' }, null, 2);
    expect(scheduler.parseStatus(out)).toBe('WARNING');
  });

  it('ignores dotenv tip braces that precede the report', () => {
    // Real shape: --json does not suppress the human-readable output, and
    // dotenv prints tips containing braces. Anchoring on the FIRST '{' lands on
    // "{ override: true }" and always fails to parse — which is why every cycle
    // logged status=unparsed.
    const noisy =
      'injected env (7) from .env // tip: override existing { override: true }\n\n' +
      'QUEUE HEALTH\n----------\n' +
      JSON.stringify({ status: 'CRITICAL', issues: ['x'] }, null, 2);
    expect(scheduler.parseStatus(noisy)).toBe('CRITICAL');
  });

  it('picks the report even when nested objects appear inside it', () => {
    const report = JSON.stringify(
      { status: 'WARNING', components: { queue: { status: 'OK' } } },
      null,
      2
    );
    expect(scheduler.parseStatus('{ tip: true }\n' + report)).toBe('WARNING');
  });

  it('returns null rather than guessing when output is unparseable', () => {
    expect(scheduler.parseStatus('not json at all')).toBeNull();
    expect(scheduler.parseStatus('')).toBeNull();
    expect(scheduler.parseStatus('{ broken')).toBeNull();
  });

  it('returns null when status is absent or not a string', () => {
    expect(scheduler.parseStatus(JSON.stringify({ components: {} }, null, 2))).toBeNull();
    expect(scheduler.parseStatus(JSON.stringify({ status: 42 }, null, 2))).toBeNull();
  });
});

describe('latestRunAt', () => {
  it('returns the newest run_at', async () => {
    const r = await scheduler.latestRunAt(supabaseReturning([row('2026-09-10T18:00:00Z')]));
    expect(r).toEqual({ value: '2026-09-10T18:00:00Z', error: null });
  });

  it('returns null for an empty table — not an error', async () => {
    expect(await scheduler.latestRunAt(supabaseReturning([empty]))).toEqual({ value: null, error: null });
  });

  it('surfaces a read error instead of pretending the table is empty', async () => {
    const r = await scheduler.latestRunAt(supabaseReturning([failed('permission denied')]));
    expect(r.value).toBeNull();
    expect(r.error).toBe('permission denied');
  });
});

describe('runCycle — success requires evidence that a row landed', () => {
  it('reports PERSISTED only when run_at actually advanced', async () => {
    const res = await scheduler.runCycle({
      supabase: supabaseReturning([empty, row('2026-09-10T18:00:00Z')]),
      runHealthScript: healthRun(),
    });
    expect(res.persisted).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.status).toBe('OK');
    expect(res.runAt).toBe('2026-09-10T18:00:00Z');
  });

  it('reports NOT_PERSISTED when the health check exits 0 but wrote nothing', async () => {
    // The false green this guard exists for: true-system-health.js swallows
    // persistence failures, so a clean exit proves nothing about the write.
    const res = await scheduler.runCycle({
      supabase: supabaseReturning([empty, empty]),
      runHealthScript: healthRun(),
    });
    expect(res.persisted).toBe(false);
    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/did not advance/);
  });

  it('reports NOT_PERSISTED when run_at is unchanged from before the run', async () => {
    const same = '2026-09-10T17:00:00Z';
    const res = await scheduler.runCycle({
      supabase: supabaseReturning([row(same), row(same)]),
      runHealthScript: healthRun(),
    });
    expect(res.persisted).toBe(false);
    expect(res.reason).toMatch(/did not advance/);
  });

  it('a CRITICAL verdict that WAS recorded is a successful cycle', async () => {
    // Exit 1 means the system is critical, not that the scheduler failed.
    const res = await scheduler.runCycle({
      supabase: supabaseReturning([empty, row('2026-09-10T18:05:00Z')]),
      runHealthScript: healthRun({ code: 1, stdout: JSON.stringify({ status: 'CRITICAL' }, null, 2) }),
    });
    expect(res.persisted).toBe(true);
    expect(res.ok).toBe(true);
    expect(res.status).toBe('CRITICAL');
  });

  it('a timeout fails the cycle and never claims persistence', async () => {
    const res = await scheduler.runCycle({
      supabase: supabaseReturning([empty, row('2026-09-10T18:10:00Z')]),
      runHealthScript: async () => ({ timedOut: true, code: null, stdout: '', stderr: '' }),
    });
    expect(res.ok).toBe(false);
    expect(res.persisted).toBe(false);
    expect(res.reason).toBe('timeout');
  });

  it('a read-back failure is NOT_PERSISTED, not an assumed success', async () => {
    const res = await scheduler.runCycle({
      supabase: supabaseReturning([empty, failed('connection reset')]),
      runHealthScript: healthRun(),
    });
    expect(res.persisted).toBe(false);
    expect(res.reason).toBe('connection reset');
  });

  it('never reports persisted:true without an advanced run_at', async () => {
    const cases = [
      { supabase: supabaseReturning([empty, empty]), runHealthScript: healthRun() },
      { supabase: supabaseReturning([empty, failed('x')]), runHealthScript: healthRun() },
      {
        supabase: supabaseReturning([empty, row('t')]),
        runHealthScript: async () => ({ timedOut: true, code: null, stdout: '', stderr: '' }),
      },
    ];
    for (const c of cases) {
      const res = await scheduler.runCycle(c);
      expect(res.persisted).toBe(false);
    }
  });
});

describe('wiring — the producer is actually scheduled', () => {
  it('is registered as a PM2 app', () => {
    const apps = require('../../ecosystem.config.js').apps;
    const app = apps.find((a) => a.name === 'hydi-system-health');
    expect(app).toBeDefined();
    expect(app.script).toBe('scripts/system-health-scheduler.js');
    expect(app.autorestart).toBe(true);
  });

  it('runs on an interval rather than once at boot', () => {
    const app = require('../../ecosystem.config.js').apps.find((a) => a.name === 'hydi-system-health');
    expect(Number(app.env.SYSTEM_HEALTH_INTERVAL_MS)).toBeGreaterThan(0);
    expect(Number(app.env_production.SYSTEM_HEALTH_INTERVAL_MS)).toBeGreaterThan(0);
  });

  it('targets the real health writer', () => {
    const fs = require('fs');
    const src = fs.readFileSync(path.resolve(__dirname, '../../scripts/system-health-scheduler.js'), 'utf8');
    expect(src).toContain('true-system-health.js');
    // Must spawn, not require: the CLI self-executes and process.exit(1)s on
    // CRITICAL, which would kill the scheduler.
    expect(src).toContain('spawn(');
    expect(src).not.toMatch(/require\(HEALTH_SCRIPT\)/);
  });
});
