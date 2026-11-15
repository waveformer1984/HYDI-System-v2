'use strict';

const fs = require('fs');
const path = require('path');

const SCHEMA_VERSION = 1;

function storeDir(root = process.cwd()) {
  return path.join(root, '.runtime', 'self-improvement');
}

function activePath(root) {
  return path.join(storeDir(root), 'active-mission.json');
}

function historyPath(root) {
  return path.join(storeDir(root), 'history.jsonl');
}

function ensureDir(root) {
  fs.mkdirSync(storeDir(root), { recursive: true });
}

/**
 * @returns {object|null}
 */
function loadActiveMission(root = process.cwd()) {
  try {
    const raw = fs.readFileSync(activePath(root), 'utf8');
    const m = JSON.parse(raw);
    if (m && m.schema_version === SCHEMA_VERSION) return m;
  } catch {
    /* none */
  }
  return null;
}

/**
 * @param {object} mission
 */
function saveActiveMission(root, mission) {
  ensureDir(root);
  const payload = { ...mission, schema_version: SCHEMA_VERSION, updated_at: new Date().toISOString() };
  const tmp = `${activePath(root)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2));
  fs.renameSync(tmp, activePath(root));
  return payload;
}

function clearActiveMission(root) {
  try {
    fs.unlinkSync(activePath(root));
  } catch {
    /* absent */
  }
}

/**
 * @param {object} record
 */
function appendHistory(root, record) {
  ensureDir(root);
  fs.appendFileSync(historyPath(root), `${JSON.stringify({ ...record, at: new Date().toISOString() })}\n`);
}

module.exports = {
  SCHEMA_VERSION,
  storeDir,
  loadActiveMission,
  saveActiveMission,
  clearActiveMission,
  appendHistory,
};