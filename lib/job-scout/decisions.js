'use strict';
/**
 * Shared decisions.json format for the job scout — the single writer
 * contract used by BOTH decision surfaces:
 *
 *   - Ursula → Freelance (apps/ursula-frontend/src/lib/job-scout-store.ts)
 *   - Heidi mobile BFF (pages/api/heidi-mobile/job-scout.js)
 *
 * File: <scoutDir>/decisions.json — a flat map:
 *   { "<lead-id>": { "status": "shortlisted"|"dismissed"|"applied", "at": "<iso>" } }
 *
 * 'clear' removes the entry. Writes are atomic (tmp + rename) and the
 * scout itself never writes this file — a scan can't overwrite a decision.
 * Keep in sync with job-scout-store.ts; tests/unit/job-scout-decisions.test.js
 * proves both writers emit byte-identical files.
 */

const fs = require('fs');
const path = require('path');

const DECISIONS = ['shortlisted', 'dismissed', 'applied'];
const ID_RE = /^[a-z]{2,16}:[A-Za-z0-9_-]{1,64}$/;

function isValidLeadId(id) {
  return typeof id === 'string' && ID_RE.test(id);
}

function scoutDir(env = process.env) {
  if (env.JOB_SCOUT_DIR) return path.resolve(env.JOB_SCOUT_DIR);
  return path.join(path.resolve(__dirname, '..', '..'), '.runtime', 'job-scout');
}

function readJson(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function readDecisions(dir = scoutDir()) {
  return readJson(path.join(dir, 'decisions.json'), {});
}

/**
 * Record (or clear) a decision. Returns the stored entry or null.
 * Throws on invalid id/status — callers map to 400.
 */
function setDecision(id, status, dir = scoutDir(), now = new Date()) {
  if (!isValidLeadId(id)) throw new Error('invalid lead id');
  if (status !== 'clear' && !DECISIONS.includes(status)) throw new Error('invalid status');
  const file = path.join(dir, 'decisions.json');
  const decisions = readDecisions(dir);
  if (status === 'clear') delete decisions[id];
  else decisions[id] = { status, at: now.toISOString() };
  fs.mkdirSync(dir, { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(decisions, null, 2));
  fs.renameSync(tmp, file);
  return decisions[id] || null;
}

/** Merge decisions into a leads array the way both UIs display them. */
function withDecisions(leads, decisions) {
  return (leads || []).map((l) => ({ ...l, decision: decisions[l.id] || null }));
}

module.exports = { DECISIONS, isValidLeadId, scoutDir, readDecisions, setDecision, withDecisions };
