/**
 * Command Center telemetry-alert contract — deterministic, mocked
 * telemetry only. Proves the banner surfaces each failure state with
 * the right severity and never relabels STALE/UNAVAILABLE as healthy.
 */
import { buildTelemetryAlerts } from '../../lib/workspace-telemetry';

describe('workspace telemetry banner contract', () => {
  test('all-HEALTHY telemetry produces no alert rows', () => {
    expect(buildTelemetryAlerts({
      supabaseRestTelemetry: { status: 'HEALTHY', ms: 200 },
      servicesTelemetry: { status: 'HEALTHY', ms: 8000 },
      ollamaTelemetry: { status: 'HEALTHY', ms: 60 },
    })).toEqual([]);
  });

  test('missing/null engineering block produces no rows (not a failure)', () => {
    expect(buildTelemetryAlerts(null)).toEqual([]);
    expect(buildTelemetryAlerts(undefined)).toEqual([]);
    expect(buildTelemetryAlerts({})).toEqual([]);
  });

  test('TIMEOUT surfaces as critical with the probe bound', () => {
    const [a] = buildTelemetryAlerts({ supabaseRestTelemetry: { status: 'TIMEOUT', ms: 2000 } });
    expect(a.service).toBe('Supabase REST');
    expect(a.status).toBe('TIMEOUT');
    expect(a.severity).toBe('critical');
    expect(a.detail).toContain('2s');
    expect(a.blockingNote).toContain('Chat infrastructure');
  });

  test('UNAVAILABLE surfaces as critical, not as healthy-but-old', () => {
    const [a] = buildTelemetryAlerts({ servicesTelemetry: { status: 'UNAVAILABLE', ms: 0 } });
    expect(a.service).toBe('PM2');
    expect(a.severity).toBe('critical');
    expect(a.detail).toContain('warming');
    // explicitly not a freshness claim
    expect(a.detail).not.toContain('ago');
  });

  test('STALE surfaces as informational with the age, never as failure', () => {
    const [a] = buildTelemetryAlerts({ servicesTelemetry: { status: 'STALE', ageMs: 30_000 } });
    expect(a.service).toBe('PM2');
    expect(a.status).toBe('STALE');
    expect(a.severity).toBe('info');
    expect(a.detail).toContain('30s ago');
    expect(a.blockingNote).toContain('Non-blocking');
  });

  test('DEGRADED surfaces as warning', () => {
    const [a] = buildTelemetryAlerts({ supabaseRestTelemetry: { status: 'DEGRADED', ms: 900 } });
    expect(a.severity).toBe('warning');
    expect(a.status).toBe('DEGRADED');
  });

  test('multiple degraded probes produce one row each', () => {
    const alerts = buildTelemetryAlerts({
      supabaseRestTelemetry: { status: 'TIMEOUT', ms: 2000 },
      servicesTelemetry: { status: 'STALE', ageMs: 45_000 },
      ollamaTelemetry: { status: 'HEALTHY', ms: 50 },
    });
    expect(alerts.map(a => a.service)).toEqual(['Supabase REST', 'PM2']);
    expect(alerts.find(a => a.service === 'Ollama')).toBeUndefined();
  });
});
