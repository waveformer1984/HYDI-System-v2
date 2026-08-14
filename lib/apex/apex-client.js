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
 *   - idempotent event processing state
 *   - no cloud or Supabase dependency
 */

const fs = require('fs');
const path = require('path');

function getDataDir() {
  return process.env.APEX_DATA_DIR || path.join(process.cwd(), 'data', 'apex');
}

function getMapFile() { return path.join(getDataDir(), 'project-map.json'); }
function getEventsFile() { return path.join(getDataDir(), 'events.jsonl'); }
function getProcessedFile() { return path.join(getDataDir(), 'processed-event-ids.json'); }

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

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) {
    return fallback;
  }
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    return fallback;
  }
}

function saveJson(file, data) {
  atomicWrite(file, JSON.stringify(data, null, 2));
}

function loadMap() {
  return loadJson(getMapFile(), {});
}

function saveMap(map) {
  saveJson(getMapFile(), map);
}

function getProjectMapping(apexVentureId) {
  return loadMap()[apexVentureId];
}

function ensureProjectMapping(apexVentureId, rezonateProjectId) {
  const map = loadMap();
  const existing = map[apexVentureId];
  if (existing && existing.rezonate_project_id) {
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

function loadProcessedIds() {
  return loadJson(getProcessedFile(), []);
}

function saveProcessedIds(ids) {
  saveJson(getProcessedFile(), ids);
}

function isProcessed(eventId) {
  return loadProcessedIds().includes(eventId);
}

function markProcessed(eventId) {
  const ids = loadProcessedIds();
  if (!ids.includes(eventId)) {
    ids.push(eventId);
    saveProcessedIds(ids);
  }
}

function recordEvent(event) {
  ensureDir(getEventsFile());
  const line = JSON.stringify({
    ...event,
    ingested_at: new Date().toISOString(),
  }) + '\n';
  fs.appendFileSync(getEventsFile(), line, 'utf8');
  return { ok: true, recorded: true };
}

function recordEpisode(apexProjectId, episode) {
  ensureDir(getEventsFile());
  const line = JSON.stringify({
    type: 'APEX_EPISODE',
    apex_project_id: apexProjectId,
    episode,
    ingested_at: new Date().toISOString(),
  }) + '\n';
  fs.appendFileSync(getEventsFile(), line, 'utf8');
  return { ok: true, recorded: true };
}

function listEvents(limit = 100) {
  const eventsFile = getEventsFile();
  if (!fs.existsSync(eventsFile)) {
    return [];
  }
  const lines = fs.readFileSync(eventsFile, 'utf8').trim().split('\n').filter(Boolean);
  const events = lines.map((l) => {
    try { return JSON.parse(l); } catch (e) { return null; }
  }).filter(Boolean);
  return events.slice(-limit);
}

function listEpisodes(apexProjectId, limit = 100) {
  return listEvents(limit).filter((e) => e.apex_project_id === apexProjectId);
}

function getHealth() {
  const map = loadMap();
  const events = listEvents(1000);
  const processed = loadProcessedIds();
  return {
    ok: true,
    mappings: Object.keys(map).length,
    events_recorded: events.length,
    processed_ids: processed.length,
    data_dir: getDataDir(),
  };
}

module.exports = {
  getProjectMapping,
  ensureProjectMapping,
  getHealth,
  recordEvent,
  recordEpisode,
  listEvents,
  listEpisodes,
  isProcessed,
  markProcessed,
  getMapFile,
  getEventsFile,
  getProcessedFile,
};
