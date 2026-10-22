// Local-only store. node:sqlite ships with Node >= 22.13 — no native build, no deps.
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec(`
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS pings (
      id INTEGER PRIMARY KEY, ts INTEGER NOT NULL, lat REAL, lon REAL, acc REAL,
      provider TEXT, battery INTEGER, charging INTEGER, UNIQUE(ts));
    CREATE INDEX IF NOT EXISTS pings_ts ON pings(ts);

    CREATE TABLE IF NOT EXISTS visits (
      id INTEGER PRIMARY KEY, start INTEGER NOT NULL, end INTEGER NOT NULL,
      lat REAL, lon REAL, place TEXT, division TEXT, UNIQUE(start));

    CREATE TABLE IF NOT EXISTS cal_events (
      uid TEXT PRIMARY KEY, start INTEGER, end INTEGER, title TEXT, division TEXT, source TEXT);

    CREATE TABLE IF NOT EXISTS revenue (
      id TEXT PRIMARY KEY, ts INTEGER, amount_cents INTEGER, currency TEXT, description TEXT, division TEXT);

    CREATE TABLE IF NOT EXISTS usage (
      day TEXT, pkg TEXT, minutes REAL, PRIMARY KEY(day, pkg));

    CREATE TABLE IF NOT EXISTS daily (
      day TEXT PRIMARY KEY, json TEXT, updated INTEGER);

    CREATE TABLE IF NOT EXISTS insights (
      id INTEGER PRIMARY KEY, day TEXT, kind TEXT, focus TEXT, text TEXT,
      confidence REAL, created INTEGER, UNIQUE(day, kind));

    CREATE TABLE IF NOT EXISTS actions (
      id INTEGER PRIMARY KEY, created INTEGER, insight_id INTEGER, type TEXT, payload TEXT,
      confidence REAL, verdict TEXT, reason TEXT, status TEXT, executed INTEGER);

    CREATE TABLE IF NOT EXISTS notifications (
      id INTEGER PRIMARY KEY, created INTEGER, deliver_at INTEGER, title TEXT, body TEXT, delivered INTEGER);

    CREATE TABLE IF NOT EXISTS focus_blocks (
      id INTEGER PRIMARY KEY, start INTEGER, end INTEGER, title TEXT, action_id INTEGER);

    CREATE TABLE IF NOT EXISTS audit (
      id INTEGER PRIMARY KEY, ts INTEGER, event TEXT, detail TEXT);
  `);
  return db;
}

export function audit(db, event, detail) {
  db.prepare('INSERT INTO audit (ts, event, detail) VALUES (?, ?, ?)')
    .run(Date.now(), event, typeof detail === 'string' ? detail : JSON.stringify(detail));
}
