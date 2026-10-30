'use strict';

/**
 * fix-list collector — the thin IO half. Gathers every input
 * lib/observation/fix-list.js needs, reusing what the running system
 * already reads:
 *
 *   drift        -> lib/runtime/collect.js collectRuntimeAudit (the same
 *                   read-only pm2 jlist + git the CLI runs; an unreadable
 *                   jlist comes back as UNKNOWN, not silence)
 *   daemonStatus -> .heidi-daemon-status.json (the daemon's own evidence)
 *   pm2DaemonPid -> ~/.pm2/pids/hydi-daemon-*.pid (PM2's tracked pid)
 *   actionRefused-> heidi_events via the daemon's PG config
 *                   (PG_HOST/PG_PORT/PG_DATABASE/PG_USER/PG_PASSWORD,
 *                   same defaults as scripts/heidi-daemon.ts). An
 *                   unreachable DB is evidence, not zero.
 *   backlog      -> heidi-core/data/heidi_memory.db missions table via
 *                   sqlite3 (same package memory/sqlite-store.js uses)
 *   previous     -> .runtime/fixlist/current.json (dedupe + persistence)
 *
 * v1 never runs a mutating command, never creates a mission, never
 * touches the action executor.
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

function readJson(file) {
  try {
    let raw = fs.readFileSync(file, 'utf8');
    if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
    return JSON.parse(raw);
  } catch { return null; }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function pm2DaemonPid() {
  const dir = path.join(os.homedir(), '.pm2', 'pids');
  try {
    const f = fs.readdirSync(dir).find((n) => /^hydi-daemon-\d+\.pid$/.test(n));
    if (!f) return null;
    const pid = Number(fs.readFileSync(path.join(dir, f), 'utf8').trim());
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch { return null; }
}

async function driftRows() {
  try {
    const { collectRuntimeAudit } = require('../runtime/collect');
    // Wait at most 4s: the whole fix-list step is bounded at 15s, and a
    // slow `pm2 jlist` (~28s on Frank) keeps running in the background so
    // the next pass reads its result from the shared cache.
    const audit = await collectRuntimeAudit({ timeoutMs: 4000, waitMs: 4000 });
    return audit;
  } catch (e) {
    return { error: e && e.message ? e.message : 'collectRuntimeAudit failed' };
  }
}

async function refusedCounts() {
  let Pool;
  try { Pool = require('pg').Pool; }
  catch { return { unreachable: true, error: 'pg module unavailable' }; }
  const pool = new Pool({
    host: process.env.PG_HOST || '127.0.0.1',
    port: parseInt(process.env.PG_PORT || '54322', 10),
    database: process.env.PG_DATABASE || 'postgres',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    max: 1,
    connectionTimeoutMillis: 4000,
    statement_timeout: 4000,
  });
  try {
    const r = await pool.query(
      `SELECT verdict, COUNT(*) AS count FROM heidi_events
       WHERE event_type='action_refused' AND created_at > now() - interval '1 day'
       GROUP BY verdict ORDER BY 2 DESC`);
    return { rows: r.rows };
  } catch (e) {
    return { unreachable: true, error: e && e.message ? e.message.slice(0, 120) : 'query failed' };
  } finally {
    try { await pool.end(); } catch { /* ignore */ }
  }
}

function missionBacklog(root) {
  const dbFile = path.join(root, 'heidi-core', 'data', 'heidi_memory.db');
  if (!fs.existsSync(dbFile)) return null;
  let sqlite3;
  try { sqlite3 = require('sqlite3').verbose(); }
  catch { return null; }
  return new Promise((resolve) => {
    const db = new sqlite3.Database(dbFile, sqlite3.OPEN_READONLY, (err) => {
      if (err) return resolve(null);
      db.all(
        `SELECT status, COUNT(*) AS n, MIN(created_at) AS oldest FROM missions
         WHERE status IN ('awaiting_approval','blocked') GROUP BY status`,
        [], (qerr, rows) => {
          try { db.close(); } catch { /* ignore */ }
          if (qerr || !Array.isArray(rows)) return resolve(null);
          const now = Date.now();
          const a = rows.find((x) => x.status === 'awaiting_approval');
          const b = rows.find((x) => x.status === 'blocked');
          const oldestIso = [a && a.oldest, b && b.oldest].filter(Boolean).sort()[0] || null;
          resolve({
            awaitingApproval: a ? Number(a.n) || 0 : 0,
            blocked: b ? Number(b.n) || 0 : 0,
            oldestSec: oldestIso ? Math.max(0, Math.round((now - Date.parse(oldestIso)) / 1000)) : 0,
          });
        });
    });
  });
}

/**
 * Gather everything buildFixList needs except the frank snapshot
 * (the observer pass already built it). Each source fails closed to
 * null / {unreachable:true} — never throws into the observer pass.
 */
async function collectFixListInputs(root, { snapshot } = {}) {
  const [drift, actionRefused, backlog] = await Promise.all([
    driftRows(), refusedCounts(), missionBacklog(root),
  ]);
  return {
    snapshot: snapshot || null,
    drift,
    daemonStatus: readJson(path.join(root, '.heidi-daemon-status.json')),
    pm2DaemonPid: pm2DaemonPid(),
    actionRefused,
    backlog,
    previous: readJson(path.join(root, '.runtime', 'fixlist', 'current.json')),
  };
}

module.exports = { collectFixListInputs, readJson, writeJsonAtomic };
