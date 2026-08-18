const { describe, it, before } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  validateManifest,
  createManifest,
  loadManifest,
  loadAll,
  discover,
  DEFAULT_MANIFEST
} = require('../src/manifest');

describe('application manifest', () => {
  describe('validateManifest', () => {
    it('accepts a valid manifest', () => {
      const result = validateManifest({
        name: 'resonate',
        version: '1.0.0',
        capabilities: ['audio'],
        eventsProduced: ['audio.asset.created'],
        eventsConsumed: ['ownership.updated'],
        providers: ['local-audio'],
        dependencies: { services: ['supabase'], packages: [] }
      });
      assert.strictEqual(result.ok, true);
      assert.deepStrictEqual(result.errors, []);
    });

    it('rejects missing name', () => {
      const result = validateManifest({ version: '1.0.0' });
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes('name')));
    });

    it('rejects empty name', () => {
      const result = validateManifest({ name: '', version: '1.0.0' });
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes('name')));
    });

    it('rejects missing version', () => {
      const result = validateManifest({ name: 'resonate' });
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes('version')));
    });

    it('rejects non-string capabilities', () => {
      const result = validateManifest({
        name: 'resonate',
        version: '1.0.0',
        capabilities: [123]
      });
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes('capabilities')));
    });

    it('rejects non-array capabilities', () => {
      const result = validateManifest({
        name: 'resonate',
        version: '1.0.0',
        capabilities: 'audio'
      });
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes('capabilities')));
    });

    it('rejects non-array eventsProduced', () => {
      const result = validateManifest({
        name: 'resonate',
        version: '1.0.0',
        eventsProduced: 'audio.asset.created'
      });
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes('eventsProduced')));
    });

    it('rejects non-array eventsConsumed', () => {
      const result = validateManifest({
        name: 'resonate',
        version: '1.0.0',
        eventsConsumed: 'ownership.updated'
      });
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes('eventsConsumed')));
    });

    it('rejects non-array providers', () => {
      const result = validateManifest({
        name: 'resonate',
        version: '1.0.0',
        providers: 'local-audio'
      });
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes('providers')));
    });

    it('rejects non-object dependencies', () => {
      const result = validateManifest({
        name: 'resonate',
        version: '1.0.0',
        dependencies: ['supabase']
      });
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes('dependencies')));
    });

    it('rejects non-array dependencies.services', () => {
      const result = validateManifest({
        name: 'resonate',
        version: '1.0.0',
        dependencies: { services: 'supabase' }
      });
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes('dependencies.services')));
    });

    it('rejects non-array dependencies.packages', () => {
      const result = validateManifest({
        name: 'resonate',
        version: '1.0.0',
        dependencies: { packages: '@protoforge/event-contracts' }
      });
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes('dependencies.packages')));
    });

    it('rejects non-boolean deprecated', () => {
      const result = validateManifest({
        name: 'resonate',
        version: '1.0.0',
        deprecated: 'yes'
      });
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes('deprecated')));
    });

    it('rejects non-array healthRequirements', () => {
      const result = validateManifest({
        name: 'resonate',
        version: '1.0.0',
        healthRequirements: 'supabase'
      });
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes('healthRequirements')));
    });

    it('rejects un-namespaced event types', () => {
      const result = validateManifest({
        name: 'resonate',
        version: '1.0.0',
        eventsProduced: ['created']
      });
      assert.strictEqual(result.ok, false);
      assert.ok(result.errors.some(e => e.includes('dot')));
    });

    it('accepts a manifest with all empty arrays', () => {
      const result = validateManifest({
        name: 'resonate',
        version: '1.0.0',
        capabilities: [],
        eventsProduced: [],
        eventsConsumed: [],
        providers: []
      });
      assert.strictEqual(result.ok, true);
    });

    it('reports multiple errors', () => {
      const result = validateManifest({});
      assert.ok(result.errors.length >= 2);
    });
  });

  describe('createManifest', () => {
    it('creates a manifest with defaults', () => {
      const m = createManifest({ name: 'test' });
      assert.strictEqual(m.name, 'test');
      assert.deepStrictEqual(m.capabilities, []);
      assert.strictEqual(m.deprecated, false);
    });

    it('merges overrides', () => {
      const m = createManifest({ name: 'test', version: '2.0.0', capabilities: ['x'] });
      assert.strictEqual(m.version, '2.0.0');
      assert.deepStrictEqual(m.capabilities, ['x']);
    });
  });

  describe('loadManifest', () => {
    let dataDir;

    before(() => {
      dataDir = path.join(os.tmpdir(), `app-manifest-${Date.now()}`);
      fs.mkdirSync(dataDir, { recursive: true });
    });

    it('loads and validates a manifest file', () => {
      const file = path.join(dataDir, 'manifest.json');
      fs.writeFileSync(file, JSON.stringify({
        name: 'test',
        version: '1.0.0',
        capabilities: ['x']
      }));
      const result = loadManifest(file);
      assert.strictEqual(result.ok, true);
      assert.strictEqual(result.manifest.name, 'test');
    });

    it('rejects a missing file', () => {
      const result = loadManifest(path.join(dataDir, 'missing.json'));
      assert.strictEqual(result.ok, false);
    });

    it('rejects an invalid JSON file', () => {
      const file = path.join(dataDir, 'bad.json');
      fs.writeFileSync(file, '{ invalid }');
      const result = loadManifest(file);
      assert.strictEqual(result.ok, false);
    });

    it('rejects a manifest with schema errors', () => {
      const file = path.join(dataDir, 'bad-schema.json');
      fs.writeFileSync(file, JSON.stringify({ name: '', version: '' }));
      const result = loadManifest(file);
      assert.strictEqual(result.ok, false);
    });
  });

  describe('loadAll', () => {
    it('loads from explicit paths', () => {
      const dataDir = path.join(os.tmpdir(), `app-manifest-load-${Date.now()}`);
      fs.mkdirSync(dataDir, { recursive: true });
      const file = path.join(dataDir, 'manifest.json');
      fs.writeFileSync(file, JSON.stringify({
        name: 'test',
        version: '1.0.0',
        capabilities: ['x']
      }));
      const results = loadAll([file]);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].name, 'test');
    });

    it('skips missing default paths gracefully', () => {
      const results = loadAll([]);
      assert.deepStrictEqual(results, []);
    });
  });

  describe('discover', () => {
    it('discovers manifests in directories', () => {
      const dataDir = path.join(os.tmpdir(), `app-manifest-discover-${Date.now()}`);
      fs.mkdirSync(dataDir, { recursive: true });
      const appDir = path.join(dataDir, 'app1');
      fs.mkdirSync(appDir, { recursive: true });
      fs.writeFileSync(path.join(appDir, 'manifest.json'), JSON.stringify({
        name: 'app1',
        version: '1.0.0',
        capabilities: ['a']
      }));
      const results = discover([dataDir]);
      assert.strictEqual(results.length, 1);
      assert.strictEqual(results[0].name, 'app1');
    });
  });
});
