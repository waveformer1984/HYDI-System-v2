#!/usr/bin/env node
'use strict';

/**
 * Rezonate Capability Contract integrity guard.
 *
 * Origin: docs/REZONATE_CAPABILITY_CONTRACT.md §4, P0.5.2 in
 * docs/REZONATE_CONSOLIDATION_PLAN.md. This exists because
 * apps/ursula-frontend/src/components/modules/RezonetteModule.tsx used to render
 * "Complete"/"Built" for every feature regardless of its real build status (fixed
 * 2026-08-13, P0.1). This script is what should have caught that at commit time.
 *
 * Checks:
 *   1. protoforge-applications/rezonate/capability-contract.json is valid JSON and
 *      matches the expected shape.
 *   2. Every capability entry (in `capabilities`, `_deprecated`) has all required
 *      fields, and `state` is one of the seven contract states.
 *   3. Every `VERIFIED` / `PRODUCTION` entry has a non-empty `evidence` string —
 *      a doc/README asserting "production" is not evidence.
 *   4. Every `id` is globally unique across `capabilities`, `_deprecated`, and
 *      `_unaudited`.
 *   5. `_unaudited` entries do not carry a `state` field — an item under review must
 *      not simultaneously claim a verified status.
 *   6. UI files registered in CONTRACT_CONSUMING_FILES do not hardcode a non-'planned'
 *      status literal as the fallback for a contract-backed component. The only
 *      sanctioned fallback (used when a component has no contractId, or its
 *      contractId isn't found in the contract at runtime) is 'planned' — anything
 *      else is exactly the class of bug this guard exists to catch.
 *
 * Exit code 0 = pass, 1 = fail. Run: node scripts/validate-rezonate-capability-contract.js
 */

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.join(__dirname, '..');
const CONTRACT_PATH = path.join(REPO_ROOT, 'protoforge-applications', 'rezonate', 'capability-contract.json');

const VALID_STATES = ['PLANNED', 'SCAFFOLD', 'PARTIAL', 'FUNCTIONAL', 'VERIFIED', 'PRODUCTION', 'DEPRECATED'];
const STATES_REQUIRING_EVIDENCE = ['VERIFIED', 'PRODUCTION'];
const REQUIRED_FIELDS = ['id', 'name', 'category', 'state', 'module_path', 'evidence', 'last_verified', 'verified_by', 'consumers', 'notes'];

// Files that are expected to consume the contract. Add to this list as more UI
// surfaces are wired up (see docs/REZONATE_CONSOLIDATION_PLAN.md P0.5.1/P1.9).
const CONTRACT_CONSUMING_FILES = [
  path.join(REPO_ROOT, 'apps', 'ursula-frontend', 'src', 'components', 'modules', 'RezonetteModule.tsx'),
];

const errors = [];
const warnings = [];

function fail(msg) {
  errors.push(msg);
}

function warn(msg) {
  warnings.push(msg);
}

// ---------------------------------------------------------------------------
// 1. Load and shape-check the contract
// ---------------------------------------------------------------------------

if (!fs.existsSync(CONTRACT_PATH)) {
  console.error(`FATAL: contract file not found at ${CONTRACT_PATH}`);
  process.exit(1);
}

let contract;
try {
  contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, 'utf8'));
} catch (e) {
  console.error(`FATAL: contract file is not valid JSON: ${e.message}`);
  process.exit(1);
}

if (!Array.isArray(contract.state_enum) || contract.state_enum.length !== VALID_STATES.length) {
  fail(`contract.state_enum is missing or does not have exactly ${VALID_STATES.length} entries`);
} else {
  for (const s of VALID_STATES) {
    if (!contract.state_enum.includes(s)) fail(`contract.state_enum is missing required state '${s}'`);
  }
}

if (!Array.isArray(contract.capabilities)) {
  console.error('FATAL: contract.capabilities is not an array');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2-5. Per-entry validation
// ---------------------------------------------------------------------------

const seenIds = new Map(); // id -> which list it appeared in, for uniqueness check

function checkEntry(entry, listName, requireEvidence) {
  const label = `[${listName}] ${entry && entry.id ? entry.id : '(missing id)'}`;

  if (!entry || typeof entry !== 'object') {
    fail(`${label}: entry is not an object`);
    return;
  }

  for (const field of REQUIRED_FIELDS) {
    if (!(field in entry)) fail(`${label}: missing required field '${field}'`);
  }

  if (entry.id) {
    if (seenIds.has(entry.id)) {
      fail(`Duplicate capability id '${entry.id}' — first seen in [${seenIds.get(entry.id)}], also in [${listName}]`);
    } else {
      seenIds.set(entry.id, listName);
    }
  }

  if (entry.state !== undefined && !VALID_STATES.includes(entry.state)) {
    fail(`${label}: invalid state '${entry.state}' — must be one of ${VALID_STATES.join(', ')}`);
  }

  if (requireEvidence && STATES_REQUIRING_EVIDENCE.includes(entry.state)) {
    if (typeof entry.evidence !== 'string' || entry.evidence.trim().length === 0) {
      fail(`${label}: state '${entry.state}' requires a non-empty 'evidence' string, found: ${JSON.stringify(entry.evidence)}`);
    }
  }

  if (entry.consumers !== undefined && !Array.isArray(entry.consumers)) {
    fail(`${label}: 'consumers' must be an array`);
  }
}

for (const entry of contract.capabilities) checkEntry(entry, 'capabilities', true);
for (const entry of contract._deprecated || []) checkEntry(entry, '_deprecated', true);

const VALID_DISPOSITIONS = ['DEPRECATED', 'RETAINED', 'RETAINED_FOR_COMPATIBILITY', 'PENDING_DECISION'];
for (const entry of contract._legacy_paths || []) {
  const label = `[_legacy_paths] ${entry && entry.path ? entry.path : '(missing path)'}`;
  if (!entry.path) fail(`${label}: missing 'path'`);
  if (!entry.disposition || !VALID_DISPOSITIONS.includes(entry.disposition)) {
    fail(`${label}: invalid or missing disposition '${entry.disposition}' — must be one of ${VALID_DISPOSITIONS.join(', ')}`);
  }
  if (!entry.reason || typeof entry.reason !== 'string') {
    fail(`${label}: missing 'reason' explaining the disposition`);
  }
}

if (!contract._canonical_path) {
  warn('contract._canonical_path is not set — no canonical frontend/API/persistence path has been declared (P0.5.3)');
} else {
  for (const field of ['frontend', 'api', 'persistence_current', 'persistence_target']) {
    if (!contract._canonical_path[field]) fail(`_canonical_path: missing '${field}'`);
  }
}

for (const entry of contract._unaudited || []) {
  const label = `[_unaudited] ${entry && entry.id ? entry.id : '(missing id)'}`;
  if (entry.id) {
    if (seenIds.has(entry.id)) {
      fail(`Duplicate capability id '${entry.id}' — first seen in [${seenIds.get(entry.id)}], also in [_unaudited]`);
    } else {
      seenIds.set(entry.id, '_unaudited');
    }
  }
  if ('state' in entry) {
    fail(`${label}: _unaudited entries must not carry a 'state' field (found '${entry.state}') — an item under review cannot simultaneously claim a verified status`);
  }
  if (!entry.reason || typeof entry.reason !== 'string') {
    fail(`${label}: _unaudited entries require a non-empty 'reason' string explaining why the state is not yet known`);
  }
}

// ---------------------------------------------------------------------------
// 6. UI drift check — no hardcoded non-'planned' fallback status
// ---------------------------------------------------------------------------
//
// Heuristic, deliberately narrow rather than a general-purpose lint: looks for the
// specific pattern this codebase uses (a `COMPONENTS_BASE`-style array of object
// literals with sibling `status:` and `contractId:` fields) and asserts every
// hardcoded `status:` literal in such a block is 'planned'. This will not catch every
// possible way someone could reintroduce hardcoded status — it catches the exact
// bug class that shipped once already, which is the point.

const STATUS_LITERAL_RE = /status:\s*'([a-zA-Z]+)'/g;
const CONTRACT_ID_ON_SAME_LINE_RE = /contractId:\s*(null|'[^']*')/;

for (const filePath of CONTRACT_CONSUMING_FILES) {
  if (!fs.existsSync(filePath)) {
    warn(`Contract-consuming file not found (may have moved): ${filePath}`);
    continue;
  }
  const src = fs.readFileSync(filePath, 'utf8');
  const lines = src.split('\n');
  lines.forEach((line, idx) => {
    if (!CONTRACT_ID_ON_SAME_LINE_RE.test(line)) return; // only check lines that are contract-backed component entries
    let m;
    STATUS_LITERAL_RE.lastIndex = 0;
    while ((m = STATUS_LITERAL_RE.exec(line))) {
      const literal = m[1];
      if (literal !== 'planned') {
        fail(
          `${path.relative(REPO_ROOT, filePath)}:${idx + 1}: hardcoded status literal '${literal}' on a ` +
          `contract-backed component entry. The only sanctioned fallback is 'planned' — real status must ` +
          `come from contractStateToDisplayStatus(), not a literal here. This is the exact bug class fixed ` +
          `2026-08-13 in RezonetteModule.tsx (P0.1).`
        );
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

console.log(`Rezonate Capability Contract validation`);
console.log(`Contract: ${path.relative(REPO_ROOT, CONTRACT_PATH)}`);
console.log(`Entries checked: ${contract.capabilities.length} capabilities, ${(contract._deprecated || []).length} deprecated, ${(contract._unaudited || []).length} unaudited`);
console.log(`UI files scanned: ${CONTRACT_CONSUMING_FILES.length}`);
console.log('');

if (warnings.length) {
  console.log(`WARNINGS (${warnings.length}):`);
  for (const w of warnings) console.log(`  - ${w}`);
  console.log('');
}

if (errors.length) {
  console.log(`FAILED — ${errors.length} error(s):`);
  for (const e of errors) console.log(`  - ${e}`);
  process.exit(1);
}

console.log('PASSED — contract is internally consistent and no UI drift detected.');
process.exit(0);
