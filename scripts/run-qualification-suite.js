#!/usr/bin/env node
'use strict';
/**
 * Tier 4 qualification runner.
 *
 * tests/qualification/ holds ten standalone TypeScript programs named
 * `test-*.ts` -- a PREFIX, not the `.test.ts` suffix Jest and `node --test`
 * look for. They were therefore invisible to every runner in the repo and
 * reachable only by copying a command out of
 * HYDI_CONTINUOUS_RUNTIME_QUALIFICATION_REPORT.md.
 *
 * The naming is not a mistake: each file is a `main()`-style program, not a
 * Jest suite, so `test-*.ts` is correct for what they are. They were renamed
 * by nobody and should stay that way -- what was missing was a deliberate
 * command, which is this file.
 *
 * These are Tier 4. They are slow by design (one is a 500-cycle soak) and
 * several expect a live local runtime. Nothing here belongs in a fast gate.
 *
 *   node scripts/run-qualification-suite.js --list
 *   node scripts/run-qualification-suite.js --only test-daemon-audit
 *   node scripts/run-qualification-suite.js            (runs all, sequentially)
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const DIR = path.join(ROOT, 'tests', 'qualification');

function discover() {
  try {
    return fs.readdirSync(DIR).filter((f) => /^test-.*\.ts$/.test(f)).sort();
  } catch {
    return [];
  }
}

const args = process.argv.slice(2);
const files = discover();

if (!files.length) {
  console.error(`No qualification programs found in ${DIR}`);
  process.exit(1);
}

if (args.includes('--list')) {
  console.log(`Tier 4 qualification programs (${files.length}) in tests/qualification/:`);
  for (const f of files) console.log('  ' + f);
  console.log('\nRun one:  node scripts/run-qualification-suite.js --only <name-without-.ts>');
  process.exit(0);
}

const onlyIdx = args.indexOf('--only');
const selected = onlyIdx >= 0 && args[onlyIdx + 1]
  ? files.filter((f) => f === `${args[onlyIdx + 1]}.ts` || f === args[onlyIdx + 1])
  : files;

if (!selected.length) {
  console.error(`No qualification program matched '${args[onlyIdx + 1]}'. Use --list to see them.`);
  process.exit(1);
}

console.log(`Running ${selected.length} Tier 4 qualification program(s). These are slow and expect a live local runtime.\n`);

const results = [];
for (const f of selected) {
  const started = Date.now();
  process.stdout.write(`--- ${f} ... `);
  const r = spawnSync('npx', ['tsx', path.join('tests', 'qualification', f)], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
  });
  const ms = Date.now() - started;
  const ok = r.status === 0;
  results.push({ file: f, ok, exitCode: r.status, ms });
  console.log(`${ok ? 'PASS' : 'FAIL'} (${(ms / 1000).toFixed(1)}s, exit ${r.status})`);
}

console.log('\n=== Tier 4 qualification summary ===');
for (const r of results) {
  console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.file.padEnd(46)} ${(r.ms / 1000).toFixed(1)}s`);
}
const failed = results.filter((r) => !r.ok);
console.log(`  ${results.length - failed.length}/${results.length} passed`);

// A Tier 4 failure is a real result, not a crash of this runner.
process.exit(failed.length ? 1 : 0);
