#!/usr/bin/env node
'use strict';
/**
 * Repository Identity Gate
 * ----------------------------------------------------------------------------
 * Verifies that the current working directory is the canonical HYDI-System-v2
 * repository. Fails if:
 *   - not a Git repository
 *   - Git remote does not match the canonical remote
 *   - working directory is not the canonical path
 *   - the current branch is not an expected branch
 *
 * Usage:
 *   node scripts/verify-canonical.js
 *   npm run verify:canonical
 *
 * Exit 0 = canonical identity confirmed, exit 1 = identity mismatch.
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const EXPECTED_REMOTE = 'https://github.com/waveformer1984/HYDI-System-v2.git';
const EXPECTED_PATH = 'C:\\Users\\Owner\\HYDI-System-v2';
// Allow these branches as valid working branches
const ALLOWED_BRANCHES = ['clean-main', 'feat/local-dev-automation'];

const CLR = {
  reset: '\x1b[0m', bold: '\x1b[1m',
  red: '\x1b[31m', green: '\x1b[32m', yellow: '\x1b[33m', cyan: '\x1b[36m',
};
const color = (code, s) => `${code}${s}${CLR.reset}`;
const tag = `${CLR.bold}[canonical]${CLR.reset}`;
function ok(msg)   { console.log(`${tag} ${color(CLR.green, '✓')} ${msg}`); }
function fail(msg) { console.error(`${tag} ${color(CLR.red, '✗')} ${msg}`); }
function info(msg) { console.log(`${tag} ${color(CLR.cyan, 'ℹ')} ${msg}`); }

function run(cmd) {
  try {
    return execSync(cmd, { encoding: 'utf8', timeout: 10000 }).trim();
  } catch (_) {
    return null;
  }
}

function main() {
  console.log(`${tag} ${CLR.bold}Repository Identity Gate${CLR.reset}`);
  let blocking = false;

  // 1. Check we're in a Git repository
  const gitRoot = run('git rev-parse --show-toplevel');
  if (!gitRoot) {
    fail('not a Git repository — run from C:\\Users\\Owner\\HYDI-System-v2');
    process.exit(1);
  }

  // 2. Check path matches canonical
  const normalizedRoot = path.resolve(gitRoot);
  const normalizedExpected = path.resolve(EXPECTED_PATH);
  if (normalizedRoot !== normalizedExpected) {
    fail(`working directory is not canonical`);
    fail(`  expected: ${EXPECTED_PATH}`);
    fail(`  actual:   ${normalizedRoot}`);
    info(`if you are in a stale clone (HYDI_System, F:\\HYDI_System, etc.), switch to the canonical path`);
    blocking = true;
  } else {
    ok(`canonical path: ${normalizedRoot}`);
  }

  // 3. Check remote
  const remote = run('git remote get-url origin');
  if (!remote) {
    fail('no Git remote named "origin"');
    blocking = true;
  } else if (remote !== EXPECTED_REMOTE) {
    fail(`Git remote mismatch`);
    fail(`  expected: ${EXPECTED_REMOTE}`);
    fail(`  actual:   ${remote}`);
    if (remote.includes('ghp_') || remote.includes('@github.com')) {
      fail('SECURITY: remote URL contains an embedded credential — remove it with:');
      fail('  git remote set-url origin https://github.com/waveformer1984/HYDI-System-v2.git');
    }
    blocking = true;
  } else {
    ok(`canonical remote: ${remote}`);
  }

  // 4. Check branch (warning only — agents may work on feature branches)
  const branch = run('git rev-parse --abbrev-ref HEAD');
  if (branch) {
    if (ALLOWED_BRANCHES.includes(branch)) {
      ok(`branch: ${branch}`);
    } else {
      info(`branch: ${branch} (not in allowed list ${ALLOWED_BRANCHES.join(', ')}) — proceed with caution`);
    }
  }

  // 5. Check CANONICAL.md exists
  if (!fs.existsSync(path.join(gitRoot, 'CANONICAL.md'))) {
    fail('CANONICAL.md not found — this may not be the canonical repository');
    blocking = true;
  } else {
    ok('CANONICAL.md present');
  }

  // Summary
  if (blocking) {
    fail('CANONICAL IDENTITY GATE FAILED — do not proceed until identity is confirmed');
    process.exit(1);
  }
  ok('canonical identity confirmed — safe to proceed');
  process.exit(0);
}

main();
