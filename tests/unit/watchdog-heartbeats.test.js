'use strict';

const { deriveHeartbeats, postHeartbeats } = require('../../lib/realtime/watchdogHeartbeats');
const { trackedSubsystems, KNOWN_SUBSYSTEMS } = require('../../lib/realtime/subsystems');
const { verifyServiceToken } = require('../../lib/auth/verifyServiceToken');

const healthy = [
  { name: 'protoforge-core', ok: true, state: 'HEALTHY' },
  { name: 'heidi-web', ok: true, state: 'HEALTHY' },
  { name: 'heidi-mobile-chat', ok: true, state: 'HEALTHY' },
  { name: 'supabase_db', ok: true, statusCode: 200 },
  { name: 'supabase_rest', ok: true, statusCode: 200 },
  { name: 'supabase_kong', ok: true, statusCode: 200 },
  { name: 'ollama', ok: true, state: 'HEALTHY' },
];
const status = (beats) => Object.fromEntries(beats.map((b) => [b.subsystem, b.status]));
const swap = (name, patch) => healthy.map((r) => (r.name === name ? { ...r, ...patch } : r));

describe('deriveHeartbeats', () => {
  test('all healthy -> hydi_core, database, memory healthy', () => {
    expect(status(deriveHeartbeats(healthy))).toEqual({ hydi_core: 'healthy', database: 'healthy', memory: 'healthy' });
  });

  test('protoforge-core down is critical for hydi_core only', () => {
    expect(status(deriveHeartbeats(swap('protoforge-core', { ok: false, state: 'UNAVAILABLE' }))))
      .toEqual({ hydi_core: 'critical', database: 'healthy', memory: 'healthy' });
  });

  test('heidi-web alive but DEGRADED makes hydi_core degraded', () => {
    expect(status(deriveHeartbeats(swap('heidi-web', { ok: true, state: 'DEGRADED' }))).hydi_core).toBe('degraded');
  });

  test('ollama down degrades memory; postgres down is critical for database and memory', () => {
    expect(status(deriveHeartbeats(swap('ollama', { ok: false })))).toMatchObject({ memory: 'degraded', database: 'healthy' });
    expect(status(deriveHeartbeats(swap('supabase_db', { ok: false })))).toMatchObject({ memory: 'critical', database: 'critical' });
  });

  test('subsystems with no observed inputs are not reported', () => {
    expect(deriveHeartbeats([{ name: 'ollama', ok: true, state: 'HEALTHY' }]).map((b) => b.subsystem)).toEqual(['memory']);
    expect(deriveHeartbeats([])).toEqual([]);
  });

  test('every reported subsystem is one hydi_subsystem_status accepts', () => {
    for (const b of deriveHeartbeats(healthy)) expect(KNOWN_SUBSYSTEMS).toContain(b.subsystem);
  });
});

describe('trackedSubsystems', () => {
  test('defaults to what the watchdog observes', () => {
    expect(trackedSubsystems({})).toEqual(['hydi_core', 'database', 'memory']);
  });
  test('env override keeps only known names; all-invalid falls back', () => {
    expect(trackedSubsystems({ HYDI_TRACKED_SUBSYSTEMS: 'ursula, hydi_core,bogus,ursula' })).toEqual(['ursula', 'hydi_core']);
    expect(trackedSubsystems({ HYDI_TRACKED_SUBSYSTEMS: 'bogus' })).toEqual(['hydi_core', 'database', 'memory']);
  });
});

describe('postHeartbeats', () => {
  const beats = deriveHeartbeats(healthy);

  test('posts each beat with a valid service token', async () => {
    const calls = [];
    const fetchImpl = async (url, opts) => { calls.push({ url, opts }); return { ok: true, status: 200 }; };
    const out = await postHeartbeats(beats, { baseUrl: 'http://127.0.0.1:3000/', secret: 's3cret', fetchImpl });
    expect(out.every((o) => o.ok)).toBe(true);
    expect(calls).toHaveLength(3);
    expect(calls[0].url).toBe('http://127.0.0.1:3000/api/heartbeat');
    expect(verifyServiceToken(calls[0].opts.headers['x-hydi-service-token'], 's3cret').valid).toBe(true);
    expect(JSON.parse(calls[0].opts.body)).toMatchObject({ subsystem: 'hydi_core', status: 'healthy' });
  });

  test('never throws: missing secret, HTTP errors and network errors come back as outcomes', async () => {
    expect((await postHeartbeats(beats, { baseUrl: 'x', secret: '' })).every((o) => !o.ok)).toBe(true);
    const bad = await postHeartbeats(beats, { baseUrl: 'http://h', secret: 's', fetchImpl: async () => ({ ok: false, status: 401 }) });
    expect(bad[0]).toMatchObject({ ok: false, status: 401 });
    const down = await postHeartbeats(beats, { baseUrl: 'http://h', secret: 's', fetchImpl: async () => { throw new Error('ECONNREFUSED'); } });
    expect(down[0]).toMatchObject({ ok: false, error: 'ECONNREFUSED' });
  });
});
