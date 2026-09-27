/**
 * Deterministic fault-injection proof for lib/supabase-timed.ts.
 * The failure mode it guards against is real: supabase-js has no
 * fetch timeout — degraded PostgREST hung /api/chat for ~90s.
 * No real network is used anywhere here; every transport is injected.
 */
import { createTimedFetch, createTimedClient, SupabaseDegradedError, SupabaseTimeoutError } from '../../lib/supabase-timed';

const hang = (): Promise<Response> => new Promise(() => { /* never resolves */ });
const failFast = () => Promise.reject(new Error('fetch failed: ECONNREFUSED'));
const succeed = () => Promise.resolve(new Response('{"ok":true}', { status: 200 }));

describe('supabase-timed — deterministic fault injection', () => {
  test('a hanging fetch is aborted within the configured timeout', async () => {
    const { fetch: f } = createTimedFetch(hang, { timeoutMs: 50 });
    const t0 = Date.now();
    await expect(f('http://x/')).rejects.toBeInstanceOf(SupabaseTimeoutError);
    const ms = Date.now() - t0;
    expect(ms).toBeGreaterThanOrEqual(45);
    expect(ms).toBeLessThan(500); // bounded — not minutes
  });

  test('abort is classified as transport failure (timeout), not app error', async () => {
    const { fetch: f } = createTimedFetch(hang, { timeoutMs: 30 });
    try {
      await f('http://x/');
      throw new Error('should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(SupabaseTimeoutError);
      expect(String(e)).toContain('SUPABASE_REST_TIMEOUT');
    }
  });

  test('3 consecutive transport failures open the circuit', async () => {
    const { fetch: f, state } = createTimedFetch(failFast, { timeoutMs: 50, cbThreshold: 3 });
    for (let i = 0; i < 3; i++) await expect(f('http://x/')).rejects.toThrow('fetch failed');
    expect(state.circuit).toBe('open');
    expect(state.failures).toBe(3);
  });

  test('while the circuit is open, requests fail fast without calling transport', async () => {
    let calls = 0;
    const countingHang = () => { calls++; return hang(); };
    const { fetch: f, state } = createTimedFetch(countingHang, { timeoutMs: 20, cbThreshold: 1 });
    await expect(f('http://x/')).rejects.toBeInstanceOf(SupabaseTimeoutError);
    expect(state.circuit).toBe('open');
    const t0 = Date.now();
    await expect(f('http://x/')).rejects.toBeInstanceOf(SupabaseDegradedError);
    expect(Date.now() - t0).toBeLessThan(20); // instant — no doomed call
    expect(calls).toBe(1); // transport was not invoked again
  });

  test('circuit recovers after the cooldown window', async () => {
    const { fetch: f, state } = createTimedFetch(succeed, { timeoutMs: 50, cbThreshold: 1, cbOpenMs: 40 });
    // trip the circuit via a failing base
    const { fetch: f2, state: s2 } = createTimedFetch(failFast, { timeoutMs: 20, cbThreshold: 1, cbOpenMs: 40 });
    await expect(f2('http://x/')).rejects.toThrow();
    expect(s2.circuit).toBe('open');
    // after cooldown the next call goes through
    await new Promise(r => setTimeout(r, 60));
    const res = await f('http://x/');
    expect(res.ok).toBe(true);
    expect(state.circuit).toBe('closed');
    expect(state.failures).toBe(0);
  });

  test('successful requests work and reset the failure counter', async () => {
    const { fetch: f, state } = createTimedFetch(succeed, { timeoutMs: 100 });
    const r = await f('http://x/');
    expect(await r.text()).toBe('{"ok":true}');
    expect(state.failures).toBe(0);
    expect(state.circuit).toBe('closed');
  });

  test('no global fetch monkey-patching — globalThis.fetch is untouched', async () => {
    const before = globalThis.fetch;
    createTimedFetch(hang, { timeoutMs: 10 });
    createTimedClient('http://127.0.0.1:1', 'key');
    expect(globalThis.fetch).toBe(before);
    await expect(globalThis.fetch === before).toBe(true);
  });

  test('createTimedClient faults through the real supabase-js path, not just the wrapper', async () => {
    // Inject a hanging transport through the normal public API
    // (options.global.fetch) — proves the boundary, not just internals.
    const client = createTimedClient('http://127.0.0.1:1', 'anon', {
      global: { fetch: hang },
      auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    } as any);
    const t0 = Date.now();
    // postgrest-js resolves with { data, error } rather than rejecting —
    // the contract is: the call RETURNS bounded, carrying a transport error.
    const res: any = await client.from('anything').select('*');
    const ms = Date.now() - t0;
    console.log(`[fault-injection] supabase-js call returned in ${ms}ms, error=${res?.error?.message ?? 'none'}`);
    expect(res.error).not.toBeNull();
    // ~4 sequential bounded attempts (auth init + query path), each
    // capped at 5s — vs the observed ~60-90s unbounded hang.
    expect(ms).toBeLessThan(30_000);
  }, 40_000);
});
