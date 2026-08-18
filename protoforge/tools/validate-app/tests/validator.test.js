const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { toKebab, resolveAppDir, validate } = require('../src/validator');
const { CapabilityPolicy } = require('../../../packages/capability-policy/src/index');

function createAppDir(name) {
  const dir = path.join(os.tmpdir(), `val-app-${name}-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
    name,
    version: '0.1.0',
    capabilities: ['builder'],
    eventsProduced: ['builder.blueprint.created'],
    eventsConsumed: ['protoforge.decision'],
    providers: ['json-store'],
    dependencies: { services: ['supabase'], packages: [] }
  }));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: toKebab(name), version: '0.1.0' }));
  fs.writeFileSync(path.join(dir, 'README.md'), `# ${name}`);
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'module.exports = {};');
  return dir;
}

describe('validate-app', () => {
  it('converts app name to kebab-case', () => {
    assert.strictEqual(toKebab('Proto YI'), 'proto-yi');
    assert.strictEqual(toKebab('Build a Mind'), 'build-a-mind');
  });

  it('requires a name', () => {
    const result = validate('');
    assert.strictEqual(result.ok, false);
  });

  it('fails when app not found', () => {
    const result = validate('missing-app-xyz');
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors[0].includes('not found'));
  });

  it('validates a complete generated app', () => {
    const dir = createAppDir('Proto YI');
    const result = validate(dir);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.manifest.name, 'Proto YI');
  });

  it('fails when manifest is invalid', () => {
    const dir = path.join(os.tmpdir(), `val-bad-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({ name: '' }));
    const result = validate(dir);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('name')));
  });

  it('fails when required files are missing', () => {
    const dir = path.join(os.tmpdir(), `val-missing-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify({
      name: 'x',
      version: '0.1.0'
    }));
    const result = validate(dir);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('package.json')));
    assert.ok(result.errors.some(e => e.includes('tests directory')));
  });

  it('validates against a capability policy', () => {
    const dir = createAppDir('Proto YI');
    const policy = new CapabilityPolicy({
      'proto yi': {
        allowedEventsProduced: ['builder.blueprint.created'],
        allowedEventsConsumed: ['protoforge.decision'],
        requiredServices: ['supabase', 'json-store']
      }
    });
    const result = validate(dir, policy);
    assert.strictEqual(result.ok, true);
  });

  it('rejects app that violates capability policy', () => {
    const dir = createAppDir('Proto YI');
    const policy = new CapabilityPolicy({
      'proto yi': {
        allowedEventsProduced: [],
        allowedEventsConsumed: [],
        requiredServices: ['missing-service']
      }
    });
    const result = validate(dir, policy);
    assert.strictEqual(result.ok, false);
    assert.ok(result.errors.some(e => e.includes('builder.blueprint.created') || e.includes('missing-service')));
  });

  it('warns when app is deprecated', () => {
    const dir = createAppDir('Old App');
    const manifest = JSON.parse(fs.readFileSync(path.join(dir, 'manifest.json'), 'utf-8'));
    manifest.deprecated = true;
    fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
    const result = validate(dir);
    assert.strictEqual(result.ok, true);
    assert.ok(result.warnings.some(w => w.includes('deprecated')));
  });

  it('resolves a path with manifest', () => {
    const dir = createAppDir('Finder');
    const resolved = resolveAppDir(dir);
    assert.strictEqual(resolved, dir);
  });
});
