'use strict';
/**
 * Local SQLite event source for the self-improvement loop.
 *
 * Lets you record pipeline events locally and read them back for assessment WITHOUT
 * Supabase — so measure->analyze->recommend can run on local data while Supabase is
 * unavailable. Falls back to an in-memory array if sqlite3 isn't loadable (same pattern
 * as heidi-core/memory/sqlite-store.js).
 *
 * Usage:
 *   const { LocalEventStore, assessFromSqlite } = require('./evolution/local-event-store');
 *   const store = await new LocalEventStore({ dbPath: './data/heidi_events_local.db' }).init();
 *   await store.record({ verdict: 'REVIEW', division: 'revenue', elapsed_ms: 220, error_message: null });
 *   const report = await assessFromSqlite(store, { windowHours: 24 });
 *
 * To populate it from the live pipeline, call store.record(...) wherever the agent
 * currently logs a heidi_events row (see heidi-core/heidi-agent.js logEvent).
 */
let sqlite3 = null;
try { sqlite3 = require('sqlite3'); } catch (_) { /* in-memory fallback */ }

const SCHEMA = `CREATE TABLE IF NOT EXISTS heidi_events_local (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  verdict TEXT, division TEXT, elapsed_ms INTEGER,
  error_message TEXT, created_at TEXT NOT NULL
);`;

function normalize(ev) {
  return {
    verdict: ev.verdict ?? null,
    division: ev.division ?? null,
    elapsed_ms: Number.isFinite(Number(ev.elapsed_ms)) ? Number(ev.elapsed_ms) : null,
    error_message: ev.error || ev.error_message || null,
    created_at: ev.created_at || new Date().toISOString(), // always ISO -> lexical window compare is correct
  };
}

class LocalEventStore {
  constructor(opts = {}) {
    this.dbPath = opts.dbPath || ':memory:';
    this.db = null;
    this.mem = [];
    this.usingSqlite = Boolean(sqlite3);
  }

  async init() {
    if (!this.usingSqlite) return this; // in-memory fallback
    await new Promise((res, rej) => { this.db = new sqlite3.Database(this.dbPath, (e) => (e ? rej(e) : res())); });
    await this._run(SCHEMA);
    return this;
  }

  _run(sql, p = []) { return new Promise((res, rej) => this.db.run(sql, p, function (e) { e ? rej(e) : res(this); })); }
  _all(sql, p = []) { return new Promise((res, rej) => this.db.all(sql, p, (e, r) => (e ? rej(e) : res(r)))); }

  async record(ev) {
    const r = normalize(ev);
    if (!this.usingSqlite) { this.mem.push(r); return; }
    await this._run(
      'INSERT INTO heidi_events_local (verdict,division,elapsed_ms,error_message,created_at) VALUES (?,?,?,?,?)',
      [r.verdict, r.division, r.elapsed_ms, r.error_message, r.created_at]
    );
  }

  async recordMany(evs) { for (const e of evs) await this.record(e); }

  async readRecent(windowHours = 24) {
    const since = new Date(Date.now() - windowHours * 3600 * 1000).toISOString();
    if (!this.usingSqlite) return this.mem.filter((r) => r.created_at >= since);
    return this._all(
      'SELECT verdict,division,elapsed_ms,error_message,created_at FROM heidi_events_local WHERE created_at >= ? LIMIT 100000',
      [since]
    );
  }

  async close() { if (this.db) await new Promise((r) => this.db.close(() => r())); }
}

/** Convenience: run the assessment directly from a local SQLite store. */
async function assessFromSqlite(store, opts = {}) {
  const { assess } = require('./self-assessment');
  const windowHours = opts.windowHours || 24;
  return assess(await store.readRecent(windowHours), { windowHours });
}

module.exports = { LocalEventStore, assessFromSqlite };
