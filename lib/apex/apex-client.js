'use strict';

/**
 * Local, one-way Apex Archive ingestion client for the Heidi control plane.
 *
 * This module does NOT read or mutate Apex Archive's internal files. It is
 * called only after the outbox events have been ingested by the bridge.
 *
 * It provides:
 *   - one authoritative HYDI project identity mapping per Apex venture
 *   - append-only local event records for audit/replay
 *   - no cloud or Supabase dependency
 */

const fs = require('fs');
const path = require('path');

const APEX_DATA_DIR = process.env.APEX_DATA_DIR || path.join(process.cwd(), 'data', 'apex');
const MAP_FILE = path.join(APEX_DATA_DIR, 'project-map.json');
const EVENTS_FILE = path.join(APEX_DATA_DIR, 'events.jsonl');

function ensureDir(file) {
  const dir = path.dirname(file);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function atomicWrite(file, data) {
  ensureDir(file);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function loadMap() {
  if (!fs.existsSync(MAP_FILE)) {
    return {};
  }
  try {
    return JSON.parse(fs.readFileSync(MAP_FILE, 'utf8'));
  } catch (e) {
    return {};
  }
}

function saveMap(map) {
  atomicWrite(MAP_FILE, JSON.stringify(map, null, 2));
}

function getOrCreateProjectMapping(apexVentureId, rezonateProjectId) {
  const map = loadMap();
  const existing = map[apexVentureId];
  if (existing) {
    return existing;
  }
  map[apexVentureId] = {
    apex_venture_id: apexVentureId,
    rezonate_project_id: rezonateProjectId,
    created_at: new Date().toISOString(),
  };
  saveMap(map);
  return map[apexVentureId];
}

function recordEvent(event) {
  ensureDir(EVENTS_FILE);
  const line = JSON.stringify({
    ...event,
    ingested_at: new Date().toISOString(),
  }) + '\n';
  fs.appendFileSync(EVENTS_FILE, line, 'utf8');
  return { ok: true, recorded: true };
}

function listEvents(limit = 100) {
  if (!fs.existsSync(EVENTS_FILE)) {
    return [];
  }
  const lines = fs.readFileSync(EVENTS_FILE, 'utf8').trim().split('\n').filter(Boolean);
  const events = lines.map((l) => {
    try { return JSON.parse(l); } catch (e) { return null; }
  }).filter(Boolean);
  return events.slice(-limit);
}

module.exports = {
  getOrCreateProjectMapping,
  recordEvent,
  listEvents,
  MAP_FILE,
  EVENTS_FILE,
};
