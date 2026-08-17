const fs = require('fs');
const path = require('path');
const { loadManifest, validateManifest } = require('../../../packages/application-manifest/src/index');
const { CapabilityPolicy } = require('../../../packages/capability-policy/src/index');

function toKebab(input) {
  return String(input)
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .replace(/[\s_]+/g, '-')
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function resolveAppDir(name) {
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..');
  const absPath = path.isAbsolute(name) ? name : null;

  if (absPath && fs.existsSync(absPath) && fs.statSync(absPath).isDirectory()) {
    return absPath;
  }

  const inApplications = path.join(repoRoot, 'protoforge-applications', toKebab(name));
  if (fs.existsSync(inApplications)) return inApplications;

  const inSwitchboard = path.join(repoRoot, 'switchboard');
  if (toKebab(name) === 'switchboard' && fs.existsSync(path.join(inSwitchboard, 'manifest.json'))) {
    return inSwitchboard;
  }

  return null;
}

function checkStructure(appDir) {
  const errors = [];
  const required = ['package.json', 'README.md', 'manifest.json', 'src/index.js'];
  for (const file of required) {
    const p = path.join(appDir, file);
    if (!fs.existsSync(p)) {
      errors.push(`missing required file: ${file}`);
    }
  }

  const testsDir = path.join(appDir, 'tests');
  if (!fs.existsSync(testsDir)) {
    errors.push('missing tests directory');
  }

  return errors;
}

function validate(name, policy, options = {}) {
  if (!name || typeof name !== 'string') {
    return { ok: false, errors: ['application name or path is required'] };
  }

  const appDir = resolveAppDir(name);
  if (!appDir) {
    return { ok: false, errors: [`application not found: ${name}`] };
  }

  const manifestPath = path.join(appDir, 'manifest.json');
  const loaded = loadManifest(manifestPath);
  if (!loaded.ok) {
    return { ok: false, errors: [loaded.error] };
  }

  const manifest = loaded.manifest;
  const schema = validateManifest(manifest);
  const structure = checkStructure(appDir);

  const errors = [...schema.errors, ...structure];
  const warnings = [];

  if (manifest.deprecated) {
    warnings.push(`application ${manifest.name} is deprecated`);
  }

  if (policy) {
    const policyResult = policy.validate(manifest);
    if (!policyResult.ok) {
      errors.push(...policyResult.errors);
    }
  } else if (options.requirePolicy) {
    warnings.push('no capability policy provided; skipping policy validation');
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    manifest,
    appDir
  };
}

module.exports = {
  toKebab,
  resolveAppDir,
  validate
};
