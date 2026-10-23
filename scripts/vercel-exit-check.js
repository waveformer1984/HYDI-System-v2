#!/usr/bin/env node
/**
 * vercel-exit-check.js — proof nothing in the tracked tree still points
 * at a live Vercel surface. The companion half of the Vercel-cancel human
 * action: this covers the REPO; the action's instructions cover the two
 * surfaces no script here can see (Stripe dashboard webhook endpoints,
 * DNS records).
 *
 *   node scripts/vercel-exit-check.js   → exit 0 when clean, 1 when any
 *   tracked file references *.vercel.app or a Vercel deploy URL.
 *
 * Docs that DESCRIBE the exit (VERCEL_EXIT_PLAN.md, this file) and
 * historical/secret-remediation reports are exempt — they must be able
 * to name what is being removed.
 */
'use strict';

const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// Files allowed to mention vercel.app because they document the exit or
// record where a secret USED to live. Matching is basename-aware so the
// list can't silently swallow a real deployment reference.
const EXEMPT = new Set([
  'docs/VERCEL_EXIT_PLAN.md',
  'docs/HISTORICAL_SECRET_REMEDIATION_REPORT.md',
  'scripts/vercel-exit-check.js',
]);

const NEEDLE = /vercel\.app/i;

function trackedFiles(root) {
  const out = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 20 * 1024 * 1024 });
  return out.split('\n').map((l) => l.trim()).filter(Boolean);
}

function main() {
  let files;
  try {
    files = trackedFiles(ROOT);
  } catch (e) {
    console.error(`vercel-exit-check: cannot list tracked files — ${e instanceof Error ? e.message : 'unknown'}`);
    return 2;
  }
  const hits = [];
  for (const rel of files) {
    if (EXEMPT.has(rel.replace(/\\/g, '/'))) continue;
    const p = path.join(ROOT, rel);
    let text;
    try { text = fs.readFileSync(p, 'utf8'); } catch { continue; }
    text.split(/\r?\n/).forEach((line, i) => {
      if (NEEDLE.test(line)) hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  if (!hits.length) {
    console.log('vercel-exit-check: CLEAN — no tracked file references *.vercel.app');
    return 0;
  }
  console.error(`vercel-exit-check: ${hits.length} reference(s) to *.vercel.app remain:`);
  for (const h of hits.slice(0, 40)) console.error(`  ${h}`);
  if (hits.length > 40) console.error(`  …and ${hits.length - 40} more`);
  return 1;
}

if (require.main === module) {
  process.exitCode = main();
}

module.exports = { main };
