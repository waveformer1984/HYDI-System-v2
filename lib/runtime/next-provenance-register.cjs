'use strict';

/**
 * Node-only Next.js instrumentation helpers. Loaded from instrumentation.ts
 * through a runtime require indirection so next dev webpack never traces fs.
 */

const { createRequire } = require('module');
const path = require('path');

async function registerNextProvenance(processName, opts = {}) {
  const root = opts.cwd || process.cwd();
  const req = createRequire(path.join(root, 'package.json'));
  const { recordProcessProvenance } = req(path.join(root, 'lib', 'runtime', 'provenance.js'));
  const extra = opts.cwd ? { cwd: opts.cwd } : undefined;
  await recordProcessProvenance(processName, extra);
}

async function registerHeidiWebStandaloneProvenance() {
  await registerNextProvenance('heidi-web-standalone');
}

async function registerUrsulaLocalProvenance() {
  const repoRoot = path.resolve(process.cwd(), '..', '..');
  await registerNextProvenance('ursula-local', { cwd: repoRoot });
}

module.exports = {
  registerHeidiWebStandaloneProvenance,
  registerUrsulaLocalProvenance,
};