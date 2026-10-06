'use strict';

/**
 * Durable JSON store for Human Actions — tasks HYDI assigns to a human
 * operator because only a human can perform them (credentials, funding,
 * approvals outside the system, physical steps). A record is durable
 * evidence: instructions given, verification spec, derived results —
 * never secret values.
 */

const fs = require('fs');
const path = require('path');

function storePath() {
  if (process.env.HYDI_HUMAN_ACTIONS_FILE) return process.env.HYDI_HUMAN_ACTIONS_FILE;
  const fromModule = path.join(__dirname, '..', '..', 'data', 'human-actions.json');
  // Bundled contexts (Next/webpack) relocate __dirname under .next/server —
  // fall back to the process cwd (repo root in every runtime we support).
  if (fs.existsSync(path.dirname(fromModule))) return fromModule;
  return path.join(process.cwd(), 'data', 'human-actions.json');
}

function load() {
  try { return JSON.parse(fs.readFileSync(storePath(), 'utf8')); }
  catch { return { version: 1, actions: [] }; }
}

function save(db) {
  const p = storePath();
  fs.mkdirSync(path.dirname(p), { recursive: true });
  const tmp = p + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, p); // atomic replace — a crash never leaves a torn file
}

module.exports = { storePath, load, save };
