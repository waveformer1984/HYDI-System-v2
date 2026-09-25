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

  it('falls back to 0.5 reliability for an unmapped source', () => {
    const adapter = new BaseAdapter('mystery');
    expect(adapter.calculateConfidence({}, { type: 'x', payload: { a: 1 } })).toBeCloseTo(0.5, 10);
  });
});
