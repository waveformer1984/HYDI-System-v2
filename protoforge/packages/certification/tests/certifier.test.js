const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { Certifier, isNamespaced, isDangerous } = require('../src/index');

function writeManifest(dir, manifest) {
  fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest));
}

function buildAppDir(manifest) {
  const dir = path.join(os.tmpdir(), `cert-app-${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'tests'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'module.exports = {};');
  fs.writeFileSync(path.join(dir, 'README.md'), `# App`);
  writeManifest(dir, manifest);
  return dir;
}

describe('Certifier', () => {
  it('identifies namespaced events', () => {
    assert.strictEqual(isNamespaced('project.created'), true);
    assert.strictEqual(isNamespaced('created'), false);
  });

  it('flags dangerous event names', () => {
    assert.strictEqual(isDangerous('system.delete.everything'), true);
    assert.strictEqual(isDangerous('project.created'), false);
  });

  it('certifies Proto YI', async () => {
    const certifier = new Certifier({ requireTests: true, requireDocs: true, requirePolicy: false });
    const result = await certifier.certify('proto-yi');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.report.name, 'Proto YI');
    assert.strictEqual(result.report.certified, true);
  });

  it('certifies Switchboard', async () => {
    const certifier = new Certifier({ requireTests: true, requireDocs: false, requirePolicy: false });
    const result = await certifier.certify('switchboard');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.report.name, 'Switchboard');
  });

  it('certifies Resonate', async () => {
    const certifier = new Certifier({ requirePolicy: false });
    const result = await certifier.certify('rezonate');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.report.name, 'Resonate');
  });

  it('rejects unknown application', async () => {
    const certifier = new Certifier({});
    const result = await certifier.certify('missing-xyz');
    assert.strictEqual(result.ok, false);
  });

  it('rejects missing manifest', async () => {
    const dir = path.join(os.tmpdir(), `cert-no-manifest-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    const certifier = new Certifier({});
    const result = await certifier.certify(dir);
    assert.strictEqual(result.ok, false);
  });

  it('rejects invalid semantic version', async () => {
    const dir = buildAppDir({
      name: 'Bad',
      version: 'not-a-version',
      capabilities: ['x'],
      eventsProduced: ['x.created'],
      eventsConsumed: [],
      providers: ['p'],
      dependencies: { services: [], packages: [] }
    });
    const certifier = new Certifier({});
    const result = await certifier.certify(dir);
    assert.strictEqual(result.ok, false);
    assert.ok(result.report.checks.manifest.errors.some(e => e.includes('version')));
  });

  it('rejects missing capabilities', async () => {
    const dir = buildAppDir({
      name: 'Bad',
      version: '0.1.0',
      capabilities: [],
      eventsProduced: ['x.created'],
      eventsConsumed: [],
      providers: ['p'],
      dependencies: { services: [], packages: [] }
    });
    const certifier = new Certifier({});
    const result = await certifier.certify(dir);
    assert.strictEqual(result.ok, false);
    assert.ok(result.report.checks.manifest.errors.some(e => e.includes('capability')));
  });

  it('rejects missing providers', async () => {
    const dir = buildAppDir({
      name: 'Bad',
      version: '0.1.0',
      capabilities: ['x'],
      eventsProduced: ['x.created'],
      eventsConsumed: [],
      providers: [],
      dependencies: { services: [], packages: [] }
    });
    const certifier = new Certifier({});
    const result = await certifier.certify(dir);
    assert.strictEqual(result.ok, false);
    assert.ok(result.report.checks.manifest.errors.some(e => e.includes('provider')));
  });

  it('rejects un-namespaced events', async () => {
    const dir = buildAppDir({
      name: 'Bad',
      version: '0.1.0',
      capabilities: ['x'],
      eventsProduced: ['created'],
      eventsConsumed: [],
      providers: ['p'],
      dependencies: { services: [], packages: [] }
    });
    const certifier = new Certifier({});
    const result = await certifier.certify(dir);
    assert.strictEqual(result.ok, false);
    const error = result.report.error || result.report.checks?.events?.errors?.[0];
    assert.ok(error && error.includes('dot-namespaced'));
  });

  it('rejects dangerous events', async () => {
    const dir = buildAppDir({
      name: 'Bad',
      version: '0.1.0',
      capabilities: ['x'],
      eventsProduced: ['system.delete.everything'],
      eventsConsumed: [],
      providers: ['p'],
      dependencies: { services: [], packages: [] }
    });
    const certifier = new Certifier({});
    const result = await certifier.certify(dir);
    assert.strictEqual(result.ok, false);
    assert.ok(result.report.checks.events.errors.some(e => e.includes('not allowed')));
  });

  it('rejects missing tests', async () => {
    const dir = path.join(os.tmpdir(), `cert-notests-${Date.now()}`);
    fs.mkdirSync(dir, { recursive: true });
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'index.js'), 'module.exports = {};');
    fs.writeFileSync(path.join(dir, 'README.md'), `# App`);
    writeManifest(dir, {
      name: 'NoTests',
      version: '0.1.0',
      capabilities: ['x'],
      eventsProduced: ['x.created'],
      eventsConsumed: [],
      providers: ['p'],
      dependencies: { services: [], packages: [] }
    });
    const certifier = new Certifier({ requireTests: true });
    const result = await certifier.certify(dir);
    assert.strictEqual(result.ok, false);
    assert.ok(result.report.checks.dependencies.errors.some(e => e.includes('tests')));
  });

  it('rejects missing README when required', async () => {
    const dir = buildAppDir({
      name: 'NoReadme',
      version: '0.1.0',
      capabilities: ['x'],
      eventsProduced: ['x.created'],
      eventsConsumed: [],
      providers: ['p'],
      dependencies: { services: [], packages: [] }
    });
    fs.unlinkSync(path.join(dir, 'README.md'));
    const certifier = new Certifier({ requireDocs: true });
    const result = await certifier.certify(dir);
    assert.strictEqual(result.ok, false);
    assert.ok(result.report.checks.dependencies.errors.some(e => e.includes('README')));
  });

  it('validates against a capability policy', async () => {
    const { CapabilityPolicy } = require('../../../packages/capability-policy/src/index');
    const dir = buildAppDir({
      name: 'Policy',
      version: '0.1.0',
      capabilities: ['x'],
      eventsProduced: ['x.created'],
      eventsConsumed: [],
      providers: ['p'],
      dependencies: { services: ['p'], packages: [] }
    });
    const policy = new CapabilityPolicy({
      policy: { allowedEventsProduced: ['y.created'] }
    });
    const certifier = new Certifier({ policy, requirePolicy: true });
    const result = await certifier.certify(dir);
    assert.strictEqual(result.ok, false);
    assert.ok(result.report.checks.policy.errors.some(e => e.includes('x.created')));
  });

  it('checks dependency graph', async () => {
    const dir = buildAppDir({
      name: 'GraphApp',
      version: '0.1.0',
      capabilities: ['x'],
      eventsProduced: ['x.created'],
      eventsConsumed: [],
      providers: ['p'],
      dependencies: { services: ['p'], packages: [] }
    });
    const certifier = new Certifier({});
    const result = await certifier.certify(dir);
    assert.strictEqual(result.report.checks.graph.ok, true);
  });

  it('includes all expected checks', async () => {
    const certifier = new Certifier({ requirePolicy: false });
    const result = await certifier.certify('proto-yi');
    const checkNames = Object.keys(result.report.checks);
    for (const name of ['manifest', 'capabilities', 'dependencies', 'lifecycle', 'events', 'diagnostics', 'policy', 'graph']) {
      assert.ok(checkNames.includes(name), `missing check: ${name}`);
    }
  });

  it('rejects deprecated applications', async () => {
    const dir = buildAppDir({
      name: 'Old',
      version: '0.1.0',
      capabilities: ['x'],
      eventsProduced: ['x.created'],
      eventsConsumed: [],
      providers: ['p'],
      dependencies: { services: [], packages: [] },
      deprecated: true
    });
    const certifier = new Certifier({});
    const result = await certifier.certify(dir);
    assert.strictEqual(result.ok, false);
    assert.ok(result.report.checks.manifest.errors.some(e => e.includes('deprecated')));
  });
});
