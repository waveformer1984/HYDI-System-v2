#!/usr/bin/env node
'use strict';

const { spawn } = require('child_process');
const fs = require('fs').promises;
const path = require('path');
const ArchitectureAudit = require('../src/hydi-v3/ArchitectureAudit');
const RepositoryAuditor = require('../src/hydi-v4/RepositoryAuditor');

const rootDir = path.resolve(__dirname, '..');
const reportDir = path.join(rootDir, 'data', 'validation');

function run(command, args) {
  return new Promise((resolve) => {
    const isWindows = process.platform === 'win32';
    const executable = isWindows ? process.env.ComSpec || 'cmd.exe' : command;
    const commandArgs = isWindows
      ? ['/d', '/s', '/c', [command, ...args].join(' ')]
      : args;
    const child = spawn(executable, commandArgs, {
      cwd: rootDir,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let output = '';
    const relay = (stream, target) => stream.on('data', (chunk) => {
      const text = chunk.toString();
      output += text;
      target.write(text);
    });
    relay(child.stdout, process.stdout);
    relay(child.stderr, process.stderr);
    child.once('error', (error) => resolve({ ok: false, error: error.message, code: null, output }));
    child.once('exit', (code) => resolve({ ok: code === 0, code, output }));
  });
}

async function main() {
  const full = process.argv.includes('--full');
  const release = process.argv.includes('--release');
  const startedAt = Date.now();
  const v3Audit = await new ArchitectureAudit({ rootDir }).run();
  const v4Auditor = new RepositoryAuditor(null, { rootDir, sourceDirs: ['src/hydi-v4'] });
  await v4Auditor.scan();
  const v4Audit = v4Auditor.generateReport();
  const tests = await run('npx', [
    'jest',
    ...(full ? [] : ['tests/unit/hydi-v4']),
    '--detectOpenHandles',
    '--runInBand',
    '--forceExit',
    '--no-coverage',
    '--silent',
  ]);
  tests.openHandlesDetected = /Jest has detected the following\s+\d+ open handles/i.test(tests.output || '');
  tests.ok = tests.ok && !tests.openHandlesDetected;
  delete tests.output;
  const lint = full ? await run('npx', ['eslint', 'src/hydi-v4', 'tests/unit/hydi-v4']) : { ok: true, skipped: true };
  delete lint.output;
  const security = full ? await run('node', ['scripts/security-audit.js']) : { ok: true, skipped: true };
  delete security.output;
  const architectureOk = v3Audit.summary.passed && v4Audit.circularImportCount === 0;
  const passed = tests.ok && lint.ok && security.ok && architectureOk;
  const report = {
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startedAt,
    mode: full ? 'full' : 'v4',
    release,
    passed,
    gates: {
      tests,
      lint,
      security,
      architecture: {
        ok: architectureOk,
        v3Score: v3Audit.summary.score,
        v3Issues: v3Audit.summary.issueCounts,
        v4CircularImports: v4Audit.circularImportCount,
        v4TimerImbalances: v4Audit.timerLeakCount,
        v4ResourceLeaks: v4Audit.resourceLeakCount,
      },
    },
  };
  await fs.mkdir(reportDir, { recursive: true });
  const reportPath = path.join(reportDir, 'latest.json');
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exitCode = passed ? 0 : 1;
}

main().catch((error) => {
  process.stderr.write(`${error.stack || error.message}\n`);
  process.exitCode = 1;
});
