'use strict';
const { LocalEventStore, assessFromSqlite } = require('../../evolution/local-event-store');

// Portable: passes in real-sqlite mode (your machine) and in-memory fallback (CI/Linux).
const iso = (ms) => new Date(ms).toISOString();

describe('local SQLite event store', () => {
  test('records events, windows by time, and assesses from the store', async () => {
    const store = await new LocalEventStore({ dbPath: ':memory:' }).init();
    const now = Date.now();
    const evs = [];
    for (let i = 0; i < 10; i++) evs.push({ verdict: 'REVIEW', division: 'revenue', elapsed_ms: 200, error_message: i < 4 ? 'boom' : null, created_at: iso(now - 1000 * i) });
    for (let i = 0; i < 6; i++) evs.push({ verdict: 'AUTO-APPROVE', division: 'galactic_bytes', elapsed_ms: 90, created_at: iso(now - 2000 * i) });
    evs.push({ verdict: 'BLOCK', division: 'stale', elapsed_ms: 100, created_at: iso(now - 48 * 3600 * 1000) }); // 48h old

    await store.recordMany(evs);

    const recent = await store.readRecent(24);
    expect(recent).toHaveLength(16); // 48h-old row excluded
    expect(recent.some((r) => r.division === 'stale')).toBe(false);

    const report = await assessFromSqlite(store, { windowHours: 24 });
    expect(report.total_events).toBe(16);
    expect(report.findings.some((f) => f.code === 'division_errors' && f.division === 'revenue')).toBe(true);

    await store.close();
  });
});
