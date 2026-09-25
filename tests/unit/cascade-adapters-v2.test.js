'use strict';

/**
 * CASCADE V2 adapter confidence. The live path quarantines below 0.75
 * (CASCADE_V2_README.md), so these pin that a well-formed event in each
 * adapter's own shape scores its source reliability, applied once, and that
 * completeness is judged on what the adapter extracted.
 */

const {
  BaseAdapter,
  SystemAdapter,
  LocalAdapter,
  VercelAdapter,
  SupabaseAdapter,
  UserAdapter,
} = require('../../modules/cascade-adapters-v2');

const GATE = 0.75;

describe('CASCADE V2 adapter confidence', () => {
  it.each([
    ['system', new SystemAdapter(), { type: 'error', component: 'db', data: { service: 'database', status: 'down' } }, 1.0],
    ['local', new LocalAdapter(), { level: 'error', module: 'api', error: 'x', data: { error_code: 'MODULE_NOT_FOUND' } }, 0.85],
    ['vercel', new VercelAdapter(), { id: 'd1', type: 'build.failed', deployment_id: 'd1', status: 'ERROR' }, 0.9],
    ['supabase', new SupabaseAdapter(), { id: 's1', type: 'postgres_error', table: 't', error: 'deadlock' }, 0.95],
    ['user', new UserAdapter(), { action: 'login', user_id: 'u1' }, 0.7],
  ])('scores a well-formed %s event at its source reliability, applied once', (_src, adapter, raw, expected) => {
    expect(adapter.normalize(raw).confidence).toBeCloseTo(expected, 10);
  });

  it('passes the gate for well-formed events that carry no raw `payload` field', () => {
    // These adapters read `data` and named fields; the raw event never has `payload`.
    expect(new SystemAdapter().normalize({ type: 'error', data: { service: 'database', status: 'down' } }).confidence).toBeGreaterThanOrEqual(GATE);
    // test-cascade-v2.js's "Valid ... with high confidence" local event.
    const local = new LocalAdapter().normalize({ id: 'test-valid-1', type: 'error', module: 'database', error: 'Cannot find module "pg"' });
    expect(local.confidence).toBeGreaterThanOrEqual(GATE);
  });

  it('keeps user events below the gate: their reliability alone is 0.7 (CASCADE_V2_README.md)', () => {
    expect(new UserAdapter().normalize({ action: 'login', user_id: 'u1' }).confidence).toBeLessThan(GATE);
  });

  it('judges emptiness on what the adapter extracted, ignoring undefined placeholders', () => {
    // The system adapter always writes component/metric/... keys; with nothing
    // behind them the event is empty and is quarantined.
    const empty = new SystemAdapter().normalize({ type: 'error' });
    expect(Object.keys(empty.payload).length).toBeGreaterThan(0);
    expect(empty.confidence).toBeCloseTo(0.7, 10);
    expect(empty.confidence).toBeLessThan(GATE);

    expect(new VercelAdapter().normalize({}).confidence).toBeLessThan(GATE);
  });

  it('still deducts for a malformed raw timestamp', () => {
    const base = { type: 'error', data: { service: 'database', status: 'down' } };
    expect(new SystemAdapter().normalize({ ...base, timestamp: 'not-a-date' }).confidence).toBeCloseTo(0.8, 10);
  });

  it('keeps confidence within [0, 1] and tracks the distribution', () => {
    const adapter = new UserAdapter();
    const c = adapter.normalize({ timestamp: 'bad' }).confidence;
    expect(c).toBeGreaterThanOrEqual(0);
    expect(c).toBeLessThanOrEqual(1);
    expect(adapter.stats.eventsProcessed).toBe(1);
    expect(adapter.stats.confidenceDistribution.reject).toBe(1);
  });

  it('adds confidence and adapter_version alongside the canonical fields', () => {
    const e = new SystemAdapter().normalize({ id: 'x', type: 'error', data: { a: 1 } });
    expect(e).toMatchObject({ event_id: 'x', source: 'system', type: 'error', adapter_version: 'v2' });
    expect(typeof e.confidence).toBe('number');
  });

  it('keeps protoforge-core\'s infrastructure_alert content instead of dropping it', () => {
    // src/server.js sends exactly this shape to the system adapter.
    const e = new SystemAdapter().normalize({
      id: 'infra_1', type: 'error', layer: 'power', alert: { severity: 'critical', message: 'UPS on battery' }, zoneId: 'z1',
    });
    expect(e.payload).toMatchObject({ layer: 'power', alert: { severity: 'critical', message: 'UPS on battery' }, zoneId: 'z1' });
    expect(e.confidence).toBe(1);
  });

  it('keeps a raw `payload` object for system events, as test-cascade-v2.js sends them', () => {
    const e = new SystemAdapter().normalize({ id: 'u1', type: 'error', payload: { weird_signal: true } });
    expect(e.payload.weird_signal).toBe(true);
  });

  it('keeps a top-level error_code for local events, as test-cascade-v2.js sends them', () => {
    const e = new LocalAdapter().normalize({ id: 'v1', type: 'error', module: 'database', error_code: 'MODULE_NOT_FOUND', error: 'x' });
    expect(e.payload).toMatchObject({ module: 'database', error_code: 'MODULE_NOT_FOUND', error: 'x' });
  });

  it('keeps unmapped user fields and does not duplicate the ones it renamed', () => {
    const e = new UserAdapter().normalize({ action: 'login', ipAddress: '10.0.0.1', userAgent: 'ua', referrer: 'r' });
    expect(e.payload).toMatchObject({ action: 'login', ip_address: '10.0.0.1', user_agent: 'ua', referrer: 'r' });
    expect(e.payload).not.toHaveProperty('ipAddress');
    expect(e.payload).not.toHaveProperty('userAgent');
  });

  it('leaves envelope fields out of the payload and lets `data` win, as before', () => {
    const e = new SystemAdapter().normalize({
      id: 'x', type: 'error', timestamp: '2026-09-25T00:00:00.000Z', status: 'top', payload: { status: 'payload' }, data: { status: 'data' },
    });
    for (const key of ['id', 'type', 'level', 'timestamp', 'data', 'payload']) expect(e.payload).not.toHaveProperty(key);
    expect(e.payload.status).toBe('data');
  });

  it('does not spread a non-object payload or data per character', () => {
    const e = new SystemAdapter().normalize({ type: 'error', payload: 'abc', data: 'de', metric: 'cpu' });
    expect(e.payload).not.toHaveProperty('0');
    expect(e.payload.metric).toBe('cpu');
  });

  it('leaves the vercel and supabase payloads, which already kept the whole raw event, unchanged', () => {
    const raw = { id: 'd1', type: 'build.failed', deployment_id: 'd1', extra: 1 };
    expect(new VercelAdapter().normalize(raw).payload).toMatchObject({ ...raw, deployment_id: 'd1' });
    const sraw = { id: 's1', type: 'postgres_error', table: 't', extra: 2 };
    expect(new SupabaseAdapter().normalize(sraw).payload).toMatchObject(sraw);
  });

  it('falls back to 0.5 reliability for an unmapped source', () => {
    const adapter = new BaseAdapter('mystery');
    expect(adapter.calculateConfidence({}, { type: 'x', payload: { a: 1 } })).toBeCloseTo(0.5, 10);
  });
});
