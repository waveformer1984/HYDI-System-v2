#!/usr/bin/env node
'use strict';
/**
 * Migration Idempotency Lint
 * ----------------------------------------------------------------------------
 * Fails if a migration file contains bare (non-idempotent) DDL/DML:
 *   - CREATE TABLE without IF NOT EXISTS
 *   - CREATE INDEX without IF NOT EXISTS
 *   - CREATE POLICY without IF NOT EXISTS or a DO $$ exception guard
 *   - INSERT without ON CONFLICT or a DO $$ exception guard
 *
 * Usage:
 *   node scripts/lint-migration-idempotency.js [file1.sql file2.sql ...]
 *
 * If no files are passed, lints all *.sql files in supabase/migrations/
 * (excluding *.sql.skip).
 *
 * Exit 0 = all migrations are idempotent, exit 1 = one or more are not.
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MIGRATIONS_DIR = path.resolve(ROOT, 'supabase', 'migrations');

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
  // Search backwards for $$ ... DO or $$ ... BEGIN
  // Simple heuristic: find the nearest $$ before pos, then check if DO or
  // BEGIN appears before it.
  const before = stripped.slice(0, pos);
  const lastDollar = before.lastIndexOf('$$');
  if (lastDollar === -1) return false;
  // Count $$ occurrences before pos — if odd, we're inside a dollar-quoted block
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
      line: sql.slice(0, sql.indexOf(match[0])).split('\n').length,
      message: `CREATE POLICY without IF NOT EXISTS or DO $$ exception guard`,
      snippet: match[0],
    });
  }

  // INSERT without ON CONFLICT or DO $$ guard
  const insertRe = /\bINSERT\s+INTO\b(?!.*\bON\s+CONFLICT\b)/gi;
  while ((match = insertRe.exec(stripped)) !== null) {
    if (isInDoBlock(stripped, match.index)) continue;
    // Allow INSERT inside a DO block (exception-guarded)
    errors.push({
      line: sql.slice(0, sql.indexOf(match[0])).split('\n').length,
      message: `INSERT without ON CONFLICT or DO $$ exception guard`,
      snippet: match[0].slice(0, 60),
    });
  }

  return { file: rel, errors };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
function main() {
  let files;
  const args = process.argv.slice(2);

  if (args.length > 0) {
    files = args.map((f) => path.resolve(f));
  } else {
    files = fs.readdirSync(MIGRATIONS_DIR)
      .filter((f) => f.endsWith('.sql') && !f.endsWith('.sql.skip'))
      .map((f) => path.resolve(MIGRATIONS_DIR, f));
  }

  let totalErrors = 0;
  for (const file of files) {
    if (!fs.existsSync(file)) {
      console.error(`✗ file not found: ${file}`);
      totalErrors++;
      continue;
    }
    const { file: rel, errors } = lintFile(file);
    if (errors.length === 0) {
      console.log(`✓ ${rel}`);
    } else {
      console.log(`✗ ${rel} (${errors.length} issue(s))`);
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
