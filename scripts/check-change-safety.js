#!/usr/bin/env node
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const ZERO = '0'.repeat(40);
const LARGE_CHANGE_LABEL = 'large-change-approved';
const MAX_FILES = 300;
const FORBIDDEN_DIRECTORY = /(^|\/)(coverage|vendor|data|\.runtime|logs)\//;

function patterns() {
  const jwtPrefix = 'eyJhbGci' + 'Oi';
  const livePrefixes = ['sk_' + 'live_', 'rk_' + 'live_', 'whsec' + '_'];
  const begin = '-----' + 'BEGIN ';
  const end = '-----' + 'END ';
  return {
    jwt: new RegExp(`${jwtPrefix}[A-Za-z0-9._-]*`, 'g'),
    live: new RegExp(`(?:${livePrefixes.join('|')})[A-Za-z0-9_-]*`, 'g'),
    privateBlock: new RegExp(`${begin}([A-Z0-9 ]*PRIVATE KEY)-----[\\s\\S]*?${end}\\1-----`, 'g'),
    privateBegin: new RegExp(`${begin}[A-Z0-9 ]*PRIVATE KEY-----`, 'g'),
  };
}

function sensitiveMatches(content) {
  const text = String(content || '');
  const p = patterns();
  const matches = [];
  for (const value of text.match(p.jwt) || []) matches.push({ kind: 'JWT', value });
  for (const value of text.match(p.live) || []) matches.push({ kind: 'live credential', value });
  const blocks = text.match(p.privateBlock) || [];
  for (const value of blocks) matches.push({ kind: 'private key block', value });
  const withoutBlocks = blocks.reduce((remaining, block) => remaining.replace(block, ''), text);
  for (const value of withoutBlocks.match(p.privateBegin) || []) matches.push({ kind: 'private key block', value });
  return matches;
}

function isKnownFakeFixture(file, match) {
  const normalized = file.replace(/\\/g, '/');
  if (!normalized.startsWith('tests/fixtures/')) return false;
  return /(known[-_ ]?fake|fake|dummy|placeholder|example|test)/i.test(match.value);
}

function newlyAddedMatches(before, after) {
  const oldCounts = new Map();
  for (const match of sensitiveMatches(before)) {
    const key = `${match.kind}\0${match.value}`;
    oldCounts.set(key, (oldCounts.get(key) || 0) + 1);
  }
  const added = [];
  for (const match of sensitiveMatches(after)) {
    const key = `${match.kind}\0${match.value}`;
    const remaining = oldCounts.get(key) || 0;
    if (remaining) oldCounts.set(key, remaining - 1);
    else added.push(match);
  }
  return added;
}

function isForbiddenGeneratedPath(file) {
  const normalized = file.replace(/\\/g, '/');
  return FORBIDDEN_DIRECTORY.test(normalized) || /\.log$/i.test(normalized);
}

function evaluateChange({ changedFiles = [], addedFiles = [], snapshots = [], labels = [] }) {
  const errors = [];
  const uniqueChanged = [...new Set(changedFiles)];
  const labelSet = new Set(labels);

  if (uniqueChanged.length > MAX_FILES && !labelSet.has(LARGE_CHANGE_LABEL)) {
    errors.push(`change touches ${uniqueChanged.length} files (maximum ${MAX_FILES}); add the "${LARGE_CHANGE_LABEL}" PR label`);
  }
  for (const file of [...new Set(addedFiles)]) {
    if (isForbiddenGeneratedPath(file)) errors.push(`${file}: generated/runtime path may not be added`);
  }
  for (const snapshot of snapshots) {
    for (const match of newlyAddedMatches(snapshot.before, snapshot.after)) {
      if (!isKnownFakeFixture(snapshot.path, match)) {
        errors.push(`${snapshot.path}: added ${match.kind}`);
      }
    }
  }
  return errors;
}

function git(args, { allowFailure = false } = {}) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.status !== 0 && !allowFailure) {
    throw new Error(`git ${args[0]} failed`);
  }
  return result.status === 0 ? result.stdout : null;
}

function nulList(args) {
  const output = git(args);
  return output.split('\0').filter(Boolean);
}

function parseArgs(argv) {
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--base' || argv[i] === '--head' || argv[i] === '--labels') {
      values[argv[i].slice(2)] = argv[i + 1] || '';
      i += 1;
    }
  }
  return values;
}

function resolveBase(base, head) {
  if (base && base !== ZERO) return base;
  const mergeBase = git(['merge-base', head, 'origin/clean-main'], { allowFailure: true });
  if (mergeBase && mergeBase.trim()) return mergeBase.trim();
  const parent = git(['rev-parse', `${head}^`], { allowFailure: true });
  if (parent && parent.trim()) return parent.trim();
  throw new Error('unable to determine comparison base');
}

function readBlob(revision, file) {
  return git(['show', `${revision}:${file}`], { allowFailure: true }) || '';
}

function run(argv = process.argv.slice(2), env = process.env) {
  const args = parseArgs(argv);
  const head = args.head || 'HEAD';
  const base = resolveBase(args.base || env.CHANGE_SAFETY_BASE || '', head);
  const labels = String(args.labels || env.CHANGE_SAFETY_LABELS || '').split(/[\n,]/).map((s) => s.trim()).filter(Boolean);
  const changedFiles = nulList(['diff', '--name-only', '-z', base, head, '--']);
  const addedFiles = nulList(['diff', '--name-only', '-z', '--diff-filter=ACR', base, head, '--']);
  const inspectedFiles = nulList(['diff', '--name-only', '-z', '--diff-filter=ACMR', base, head, '--']);
  const snapshots = inspectedFiles.map((file) => ({
    path: file,
    before: readBlob(base, file),
    after: readBlob(head, file),
  }));
  const errors = evaluateChange({ changedFiles, addedFiles, snapshots, labels });
  if (errors.length) {
    for (const error of errors) console.error(`[change-safety] ${error}`);
    console.error(`[change-safety] FAILED with ${errors.length} violation(s)`);
    return 1;
  }
  console.log(`[change-safety] passed (${changedFiles.length} changed file(s))`);
  return 0;
}

if (require.main === module) {
  try {
    process.exitCode = run();
  } catch (error) {
    console.error(`[change-safety] unable to inspect change: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 1;
  }
}

module.exports = {
  MAX_FILES,
  LARGE_CHANGE_LABEL,
  evaluateChange,
  isForbiddenGeneratedPath,
  isKnownFakeFixture,
  newlyAddedMatches,
  sensitiveMatches,
  run,
};
