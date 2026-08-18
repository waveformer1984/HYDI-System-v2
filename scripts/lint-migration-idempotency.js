#!/usr/bin/env node
'use strict';
/**
 * Migration Idempotency Lint (with ratchet)
 * ----------------------------------------------------------------------------
 * Fails if a migration file contains bare (non-idempotent) DDL/DML:
 *   - CREATE TABLE without IF NOT EXISTS
 *   - CREATE INDEX without IF NOT EXISTS
 *   - CREATE POLICY without IF NOT EXISTS or a DO $$ exception guard
 *   - INSERT without ON CONFLICT or a DO $$ exception guard
 *
 * Ratchet mode (--ratchet):
 *   Existing violations are captured in a baseline file. The lint only fails
 *   on NEW violations — violations not in the baseline. This allows technical
 *   debt to remain temporarily while preventing it from increasing.
 *
 * Usage:
 *   node scripts/lint-migration-idempotency.js [file1.sql ...]   # lint all or specified
 *   node scripts/lint-migration-idempotency.js --generate-baseline # create/update baseline
 *   node scripts/lint-migration-idempotency.js --ratchet           # fail only on NEW violations
 *   node scripts/lint-migration-idempotency.js --ratchet --verbose  # show baseline hits too
 *
 * If no files are passed, lints all *.sql files in supabase/migrations/
 *   (excluding *.sql.skip).
 *
 * Exit 0 = all migrations are idempotent (or no new violations in ratchet mode)
 * Exit 1 = violations found (or new violations in ratchet mode)
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.resolve(ROOT, 'supabase', 'migrations');
const BASELINE_FILE = path.resolve(ROOT, 'supabase', 'migration-lint-baseline.json');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Strip SQL comments and string literals so we only lint real statements. */
function stripCommentsAndStrings(sql) {
  let out = '';
  let i = 0;
  while (i < sql.length) {
    // Line comment --
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      continue;
    }
    // Block comment /* */
    if (sql[i] === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    // Single-quoted string
    if (sql[i] === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      out += "''"; // placeholder
      continue;
    }
    // Dollar-quoted string $$ ... $$ (covers DO $$ ... $$ blocks)
    if (sql[i] === '$' && sql[i + 1] === '$') {
      out += '$$'; // keep the $$ marker so we can detect DO blocks
      i += 2;
      while (i < sql.length && !(sql[i] === '$' && sql[i + 1] === '$')) i++;
      i += 2;
      out += '$$';
      continue;
    }
    out += sql[i];
    i++;
  }
  return out;
}

/** Check if a statement at a given position is inside a DO $$ ... $$ block. */
function isInDoBlock(stripped, pos) {
  const before = stripped.slice(0, pos);
  const lastDollar = before.lastIndexOf('$$');
  if (lastDollar === -1) return false;
  const dollarCount = (before.match(/\$\$/g) || []).length;
  return dollarCount % 2 === 1;
}

function lintFile(filePath) {
  const rel = path.relative(ROOT, filePath);
  const sql = fs.readFileSync(filePath, 'utf8');
  const stripped = stripCommentsAndStrings(sql);
  const errors = [];

  // CREATE TABLE without IF NOT EXISTS
  let match;
  const createTableRe = /\bCREATE\s+TABLE\b(?!.*\bIF\s+NOT\s+EXISTS\b)/gi;
  while ((match = createTableRe.exec(stripped)) !== null) {
    if (isInDoBlock(stripped, match.index)) continue;
    errors.push({
      file: rel,
      line: sql.slice(0, sql.indexOf(match[0])).split('\n').length,
      message: `CREATE TABLE without IF NOT EXISTS`,
      snippet: match[0],
    });
  }

  // CREATE [UNIQUE] INDEX without IF NOT EXISTS
  const createIndexRe = /\bCREATE\s+(?:UNIQUE\s+)?INDEX\b(?!.*\bIF\s+NOT\s+EXISTS\b)/gi;
  while ((match = createIndexRe.exec(stripped)) !== null) {
    if (isInDoBlock(stripped, match.index)) continue;
    errors.push({
      file: rel,
      line: sql.slice(0, sql.indexOf(match[0])).split('\n').length,
      message: `CREATE INDEX without IF NOT EXISTS`,
      snippet: match[0],
    });
  }

  // CREATE POLICY without IF NOT EXISTS or DO $$ guard
  const createPolicyRe = /\bCREATE\s+POLICY\b(?!.*\bIF\s+NOT\s+EXISTS\b)/gi;
  while ((match = createPolicyRe.exec(stripped)) !== null) {
    if (isInDoBlock(stripped, match.index)) continue;
    errors.push({
      file: rel,
      line: sql.slice(0, sql.indexOf(match[0])).split('\n').length,
      message: `CREATE POLICY without IF NOT EXISTS or DO $$ exception guard`,
      snippet: match[0],
    });
  }

  // INSERT without ON CONFLICT or DO $$ guard
  const insertRe = /\bINSERT\s+INTO\b(?!.*\bON\s+CONFLICT\b)/gi;
  while ((match = insertRe.exec(stripped)) !== null) {
    if (isInDoBlock(stripped, match.index)) continue;
    errors.push({
      file: rel,
      line: sql.slice(0, sql.indexOf(match[0])).split('\n').length,
      message: `INSERT without ON CONFLICT or DO $$ exception guard`,
      snippet: match[0].slice(0, 60),
    });
  }

  return { file: rel, errors };
}

// ---------------------------------------------------------------------------
// Baseline management
// ---------------------------------------------------------------------------

/** A violation key is a stable identifier: file:message:line.
 *  We use file+message+line as the identity. If a violation moves lines
 *  within the same file, it's treated as a new violation (conservative). */
function violationKey(v) {
  return `${v.file}:${v.message}:${v.line}`;
}

function loadBaseline() {
  if (!fs.existsSync(BASELINE_FILE)) return null;
  try {
    const data = JSON.parse(fs.readFileSync(BASELINE_FILE, 'utf8'));
    return new Set(data.violations || []);
  } catch (e) {
    console.error(`⚠ baseline file exists but is invalid: ${e.message}`);
    return null;
  }
}

function generateBaseline(allResults) {
  const violations = [];
  for (const { file, errors } of allResults) {
    for (const e of errors) {
      violations.push(violationKey({ file, ...e }));
    }
  }
  violations.sort();
  const baseline = {
    generated: new Date().toISOString(),
    description: 'Baseline of pre-existing migration idempotency violations. The ratchet allows these but fails on any NEW violation.',
    count: violations.length,
    violations,
  };
  fs.writeFileSync(BASELINE_FILE, JSON.stringify(baseline, null, 2) + '\n');
  console.log(`✅ baseline written to ${path.relative(ROOT, BASELINE_FILE)}`);
  console.log(`   ${violations.length} violations captured across ${allResults.filter(r => r.errors.length > 0).length} files`);
  console.log(`   Run with --ratchet to enforce: only NEW violations will fail.`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function main() {
  const args = process.argv.slice(2);
  const ratchetMode = args.includes('--ratchet');
  const generateMode = args.includes('--generate-baseline');
  const verbose = args.includes('--verbose');
  const fileArgs = args.filter(a => !a.startsWith('--'));

  let files;
  if (fileArgs.length > 0) {
    files = fileArgs.map((f) => path.resolve(f));
  } else {
    files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && !f.endsWith('.sql.skip'))
      .map((f) => path.resolve(MIGRATIONS_DIR, f));
  }

  // Lint all files
  const allResults = [];
  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.error(`✗ file not found: ${file}`);
      allResults.push({ file: path.relative(ROOT, file), errors: [{ file: path.relative(ROOT, file), line: 0, message: 'file not found', snippet: '' }] });
      continue;
    }
    allResults.push(lintFile(file));
  }

  // --generate-baseline mode: write baseline and exit
  if (generateMode) {
    generateBaseline(allResults);
    process.exit(0);
  }

  // --ratchet mode: only fail on NEW violations
  if (ratchetMode) {
    const baseline = loadBaseline();
    if (!baseline) {
      console.error('❌ --ratchet mode requires a baseline. Run --generate-baseline first.');
      process.exit(1);
    }

    let newViolations = 0;
    let baselineHits = 0;
    for (const { file, errors } of allResults) {
      if (errors.length === 0) {
        console.log(`✓ ${file}`);
        continue;
      }
      const newForFile = [];
      for (const e of errors) {
        const key = violationKey({ file, ...e });
        if (baseline.has(key)) {
          baselineHits++;
          if (verbose) {
            console.log(`  [baseline] ${file}:${e.line} ${e.message}`);
          }
        } else {
          newForFile.push(e);
        }
      }
      if (newForFile.length > 0) {
        console.log(`✗ ${file} (${newForFile.length} NEW violation(s))`);
        for (const e of newForFile) {
          console.log(`  line ${e.line}: ${e.message} — "${e.snippet}"`);
        }
        newViolations += newForFile.length;
      } else if (errors.length > 0 && !verbose) {
        console.log(`~ ${file} (${errors.length} baseline violation(s) — grandfathered)`);
      }
    }

    if (newViolations > 0) {
      console.error(`\n❌ ${newViolations} NEW idempotency violation(s) found (baseline has ${baseline.size})`);
      console.error('   These are NOT in the baseline. Fix them or update the baseline with --generate-baseline.');
      process.exit(1);
    }
    console.log(`\n✅ ratchet passed: 0 new violations (${baselineHits} baseline violations grandfathered)`);
    process.exit(0);
  }

  // Default mode: fail on ALL violations (original behavior)
  let totalErrors = 0;
  for (const { file, errors } of allResults) {
    if (errors.length === 0) {
      console.log(`✓ ${file}`);
    } else {
      console.log(`✗ ${file} (${errors.length} issue(s))`);
      for (const e of errors) {
        console.log(`  line ${e.line}: ${e.message} — "${e.snippet}"`);
      }
      totalErrors += errors.length;
    }
  }

  if (totalErrors > 0) {
    console.error(`\n❌ ${totalErrors} idempotency issue(s) found across ${files.length} file(s)`);
    process.exit(1);
  }
  console.log(`\n✅ all ${files.length} migration file(s) are idempotent`);
  process.exit(0);
}

main();
