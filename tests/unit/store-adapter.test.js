/**
 * lib/store adapter selection + contract tests (Phase 3).
 * No network: SupabaseStore is exercised with an injected fake client
 * shape via createStore env selection only — insertEvent/health are
 * tested against a stubbed client by monkey-patching require cache is
 * overkill; instead we test NullStore + PostgresStore fully and
 * SupabaseStore's not-configured path, plus selection logic.
 */
const { createStore, getStore, NullStore } = require('../../lib/store');
const { PostgresStore } = require('../../lib/store/postgres-store');
const { SupabaseStore } = require('../../lib/store/supabase-store');

describe('lib/store selection', () => {
  it('returns NullStore when nothing is configured', () => {
    const s = createStore({});
    expect(s).toBeInstanceOf(NullStore);
    expect(s.isAvailable()).toBe(false);
  });

  it('returns SupabaseStore when supabase env is present', () => {
    const s = createStore({ SUPABASE_URL: 'http://localhost:54321', SUPABASE_SERVICE_ROLE_KEY: 'k' });
    expect(s).toBeInstanceOf(SupabaseStore);
    expect(s.name).toBe('supabase');
    expect(s.isAvailable()).toBe(true);
  });

  it('HYDI_STORE=postgres wins and returns the stub', () => {
    const s = createStore({ HYDI_STORE: 'postgres', HYDI_PG_URL: 'postgres://x', SUPABASE_URL: 'http://x', SUPABASE_SERVICE_ROLE_KEY: 'k' });
    expect(s).toBeInstanceOf(PostgresStore);
  });

  it('HYDI_STORE=supabase forces supabase even with HYDI_PG_URL set', () => {
    const s = createStore({ HYDI_STORE: 'supabase', HYDI_PG_URL: 'postgres://x', SUPABASE_URL: 'http://x', SUPABASE_ANON_KEY: 'a' });
    expect(s).toBeInstanceOf(SupabaseStore);
  });
});

describe('NullStore', () => {
  it('reports unavailable and never throws on insertEvent', async () => {
    const s = new NullStore();
    const h = await s.health();
    expect(h.status).toBe('unavailable');
    await expect(s.insertEvent({ event_type: 'boot' })).resolves.toEqual({ ok: false, reason: 'no-store' });
  });
});

describe('PostgresStore stub', () => {
  it('is a loud stub: configured flag set, operations refuse', async () => {
    const s = new PostgresStore({ connectionString: 'postgres://localhost/hydi' });
    expect(s.configured).toBe(true);
    expect(s.isAvailable()).toBe(false);
    const h = await s.health();
    expect(h.status).toBe('unimplemented');
    await expect(s.insertEvent({})).resolves.toMatchObject({ ok: false });
    expect(() => s.from('heidi_events')).toThrow(/not implemented/);
  });
});

describe('SupabaseStore', () => {
  it('unconfigured client reports unavailable without throwing', async () => {
    const s = new SupabaseStore({ url: null, key: null });
    expect(s.isAvailable()).toBe(false);
    const h = await s.health();
    expect(h.status).toBe('unavailable');
    await expect(s.insertEvent({})).resolves.toEqual({ ok: false, reason: 'not-configured' });
    expect(() => s.from('x')).toThrow(/not configured/);
  });
});

describe('getStore', () => {
  it('returns a singleton', () => {
    expect(getStore()).toBe(getStore());
  });
});
