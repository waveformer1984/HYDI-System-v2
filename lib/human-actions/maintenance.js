'use strict';

/**
 * Maintenance windows — ported from the retired
 * src/heidi-executive/MaintenanceMode.js (salvage triage doc).
 *
 * Durable per-component suppression: while a component is under declared
 * maintenance, detection does not mint new actions for it and the resolver
 * sweep does not attempt recovery on it — auto-recovery must never fight
 * the operator mid-maintenance (e.g. `docker compose down` during an
 * upgrade would otherwise mint crash-loop actions and restart attempts).
 *
 * State: .hydi-operational/maintenance.json — durable across restarts,
 * written atomically. Windows expire by wall clock; an expired window is
 * lazily pruned on read. Scope entries are component names
 * ('docker:container-supabase_db_X', 'postgres-tcp', ...) or '*'.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

function defaultPath() {
  return process.env.HYDI_MAINTENANCE_FILE
    || path.join(process.cwd(), '.hydi-operational', 'maintenance.json');
}

function load(filePath = defaultPath()) {
  try {
    const d = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    return Array.isArray(d.windows) ? d.windows : [];
  } catch {
    return [];
  }
}

function save(windows, filePath = defaultPath()) {
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  const tmp = filePath + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify({ windows }, null, 2));
  fs.renameSync(tmp, filePath);
}

function expired(w, now) {
  const t = w.until != null ? w.until : (Date.parse(w.startTime) || 0) + (w.expectedDurationMs || 3600000);
  return now > t;
}

/** Live windows, pruning expired ones durably. */
function activeWindows(now = Date.now(), filePath = defaultPath()) {
  const ws = load(filePath);
  const live = ws.filter((w) => !expired(w, now));
  if (live.length !== ws.length) save(live, filePath);
  return live;
}

/** Is `component` under an active maintenance window? '*' matches all. */
function isSuppressed(component, now = Date.now(), filePath = defaultPath()) {
  for (const w of activeWindows(now, filePath)) {
    const scope = w.scope || [];
    if (scope.includes('*') || scope.includes(component)) {
      return { active: true, maintenance: w };
    }
  }
  return { active: false };
}

function startMaintenance(record = {}, filePath = defaultPath()) {
  const ws = load(filePath);
  const w = {
    id: record.id || `mnt-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    scope: record.scope || ['*'],
    startTime: record.startTime || new Date().toISOString(),
    until: record.until ?? ((record.startTime ? Date.parse(record.startTime) : Date.now()) + (record.expectedDurationMs || 3600000)),
    reason: record.reason || '',
    source: record.source || 'operator',
  };
  ws.push(w);
  save(ws, filePath);
  return w;
}

function endMaintenance(id, filePath = defaultPath()) {
  const ws = load(filePath);
  const next = ws.filter((w) => w.id !== id);
  if (next.length === ws.length) return false;
  save(next, filePath);
  return true;
}

module.exports = { isSuppressed, activeWindows, startMaintenance, endMaintenance, load, defaultPath };
