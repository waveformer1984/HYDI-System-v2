'use strict';

const fs = require('fs');
const path = require('path');
const { fingerprintGap } = require('./fingerprints');
const { redactRecord } = require('./redact');

const SCHEMA_VERSION = 2;

function dir(root = process.cwd()) {
  return path.join(root, '.runtime', 'self-improvement');
}

function missionsPath(root) {
  return path.join(dir(root), 'missions.jsonl');
}

function indexPath(root) {
  return path.join(dir(root), 'index.json');
}

function ensureDir(root) {
  fs.mkdirSync(dir(root), { recursive: true });
}

function loadIndex(root) {
  try {
    const raw = JSON.parse(fs.readFileSync(indexPath(root), 'utf8'));
    if (raw.schema_version === SCHEMA_VERSION) return raw;
  } catch {
    /* empty */
  }
  return {
    schema_version: SCHEMA_VERSION,
    fingerprints: {},
    by_gap_id: {},
    updated_at: null,
  };
}

function saveIndex(root, index) {
  ensureDir(root);
  index.updated_at = new Date().toISOString();
  const tmp = `${indexPath(root)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2));
  fs.renameSync(tmp, indexPath(root));
}

/**
 * @returns {object[]}
 */
function loadAllMissions(root) {
  const file = missionsPath(root);
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

/**
 * @param {object} record
 */
function appendMissionRecord(root, record) {
  ensureDir(root);
  const fp = fingerprintGap(record.gap || record);
  const row = redactRecord({
    schema_version: SCHEMA_VERSION,
    recorded_at: new Date().toISOString(),
    mission_id: record.mission_id,
    problem_fingerprint: fp,
    gap_id: record.gap?.id || record.gap_id,
    original_evidence: record.baseline || record.original_evidence,
    root_cause_hypothesis: record.gap?.is_symptom === false ? 'established' : 'symptom',
    proposed_intervention: record.gap?.proposed_outcome,
    tests_executed: record.tests_executed || record.progress?.filter((p) => p.step === 'test'),
    verification: record.verification,
    outcome_class: record.outcome_class,
    regression_status: record.regression_status,
    approval_status: record.approval_status || 'owner_requested',
    proof_label: record.proof_label,
    lifecycle_stage: record.lifecycle_stage,
    related_commits: record.related_commits || [],
    related_prs: record.related_prs || [],
    progress: record.progress,
    brief: record.brief,
    duplicate_of: record.duplicate_of || null,
    deferred: Boolean(record.deferred),
    gap: record.gap
      ? {
          id: record.gap.id,
          observed_problem: record.gap.observed_problem,
          acceptance_check: record.gap.acceptance_check,
        }
      : undefined,
  });
  fs.appendFileSync(missionsPath(root), `${JSON.stringify(row)}\n`);

  const index = loadIndex(root);
  index.fingerprints[fp] = index.fingerprints[fp] || [];
  index.fingerprints[fp].push(row.mission_id);
  index.by_gap_id[row.gap_id] = index.by_gap_id[row.gap_id] || [];
  index.by_gap_id[row.gap_id].push(row.mission_id);
  saveIndex(root, index);
  return row;
}

module.exports = {
  SCHEMA_VERSION,
  dir,
  loadAllMissions,
  loadIndex,
  appendMissionRecord,
  missionsPath,
};