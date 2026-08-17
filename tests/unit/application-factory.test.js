const fs = require('fs');
const path = require('path');
const { getRuntimeInventory } = require('../../lib/platform-diagnostics');
const { validateManifest, createManifest, loadManifest, discover } = require('../../protoforge/packages/application-manifest/src/index');
const { LifecycleEmitter } = require('../../protoforge/packages/application-manifest/src/lifecycle');
const { generate } = require('../../protoforge/tools/create-app/src/generator');

describe('ProtoForge Application Factory', () => {
  test('validates a complete manifest', () => {
    const result = validateManifest(createManifest({
      name: 'Proto YI',
      version: '0.1.0',
      capabilities: ['builder'],
      eventsProduced: ['builder.blueprint.created'],
      eventsConsumed: ['protoforge.decision'],
      providers: ['local-model']
    }));
    expect(result.ok).toBe(true);
    expect(result.errors).toEqual([]);
  });

  test('rejects a manifest with missing name', () => {
    const result = validateManifest({ version: '0.1.0' });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes('name'))).toBe(true);
  });

  test('rejects a manifest with missing version', () => {
    const result = validateManifest({ name: 'Test' });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes('version'))).toBe(true);
  });

  test('creates a manifest with defaults', () => {
    const manifest = createManifest({ name: 'Test' });
    expect(manifest.version).toBe('0.0.0');
    expect(manifest.capabilities).toEqual([]);
    expect(manifest.deprecated).toBe(false);
  });

  test('loads the Switchboard manifest', () => {
    const result = loadManifest(path.join(process.cwd(), 'switchboard', 'manifest.json'));
    expect(result.ok).toBe(true);
    expect(result.manifest.name).toBe('Switchboard');
    expect(result.manifest.version).toBe('1.0.0');
    expect(result.manifest.capabilities.length).toBeGreaterThan(0);
  });

  test('loads the Resonate manifest', () => {
    const result = loadManifest(path.join(process.cwd(), 'protoforge-applications', 'rezonate', 'manifest.json'));
    expect(result.ok).toBe(true);
    expect(result.manifest.name).toBe('Resonate');
    expect(result.manifest.eventsProduced).toContain('audio.asset.created');
  });

  test('discovers both registered applications', () => {
    const apps = discover([
      path.join(process.cwd(), 'switchboard'),
      path.join(process.cwd(), 'protoforge-applications')
    ]);
    const names = apps.map(a => a.name);
    expect(names).toContain('Switchboard');
    expect(names).toContain('Resonate');
  });

  test('LifecycleEmitter creates an application.created envelope', async () => {
    const manifest = createManifest({ name: 'Test', version: '0.1.0' });
    const adapter = { append: jest.fn(async (e) => ({ ok: true, record: e })) };
    const emitter = new LifecycleEmitter(adapter);
    const result = await emitter.created(manifest);
    expect(result.ok).toBe(true);
    expect(result.event.eventType).toBe('application.created');
    expect(result.event.payload.name).toBe('Test');
    expect(adapter.append).toHaveBeenCalledTimes(1);
  });

  test('LifecycleEmitter creates an application.registered envelope', async () => {
    const manifest = createManifest({ name: 'Test' });
    const adapter = { append: jest.fn(async () => ({ ok: true })) };
    const emitter = new LifecycleEmitter(adapter);
    const result = await emitter.registered(manifest);
    expect(result.event.eventType).toBe('application.registered');
  });

  test('LifecycleEmitter queues to outbox on append failure', async () => {
    const manifest = createManifest({ name: 'Test' });
    const outbox = { enqueue: jest.fn(() => ({ ok: true })) };
    const adapter = { append: async () => ({ ok: false, error: 'down' }), outbox };
    const emitter = new LifecycleEmitter(adapter);
    const result = await emitter.started(manifest);
    expect(result.ok).toBe(true);
    expect(result.queued).toBe(true);
    expect(outbox.enqueue).toHaveBeenCalledTimes(1);
  });

  test('create-app generator produces a new application', () => {
    const targetDir = path.join(require('os').tmpdir(), `pf-factory-jest-${Date.now()}`);
    const result = generate('Build a Mind', {
      blueprintDir: path.join(process.cwd(), 'protoforge', 'blueprints', 'application'),
      targetDir,
      port: 4242
    });
    expect(result.ok).toBe(true);
    expect(result.appName).toBe('build-a-mind');
    const fs = require('fs');
    expect(fs.existsSync(path.join(targetDir, 'manifest.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'package.json'))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, 'src', 'index.js'))).toBe(true);
  });

  test('create-app generator writes a valid manifest', () => {
    const targetDir = path.join(require('os').tmpdir(), `pf-factory-jest2-${Date.now()}`);
    generate('Proto YI', {
      blueprintDir: path.join(process.cwd(), 'protoforge', 'blueprints', 'application'),
      targetDir
    });
    const loaded = loadManifest(path.join(targetDir, 'manifest.json'));
    expect(loaded.ok).toBe(true);
    expect(loaded.manifest.name).toBe('Proto YI');
  });

  test('diagnostics inventory includes registered applications', async () => {
    const inventory = await getRuntimeInventory();
    expect(inventory.applications).toBeDefined();
    const names = inventory.applications.map(a => a.name);
    expect(names).toContain('Switchboard');
    expect(names).toContain('Resonate');
    expect(inventory.summary.applications).toBeGreaterThanOrEqual(2);
  });

  test('diagnostics inventory still contains canonical components', async () => {
    const inventory = await getRuntimeInventory();
    expect(inventory.canonical.length).toBeGreaterThan(0);
    expect(inventory.legacy.length).toBeGreaterThan(0);
  });

  test('diagnostics governance includes registry and policy status', async () => {
    const inventory = await getRuntimeInventory();
    expect(inventory.governance).toBeDefined();
    expect(inventory.governance.registry.total).toBeGreaterThanOrEqual(2);
    expect(typeof inventory.governance.policy.ok).toBe('boolean');
    expect(Array.isArray(inventory.governance.applicationHealth)).toBe(true);
    expect(inventory.governance.applicationHealth.every(a => a.policyValid)).toBe(true);
    expect(inventory.summary.applicationsHealthy).toBeGreaterThanOrEqual(2);
  });

  test('ApplicationRegistry enforces lifecycle transitions', () => {
    const { ApplicationRegistry, canTransition } = require('../../protoforge/packages/application-registry/src/index');
    const reg = new ApplicationRegistry({ autoLoad: false });
    reg.register({ name: 'New' });
    expect(canTransition('created', 'registered')).toBe(true);
    expect(canTransition('created', 'active')).toBe(false);
    const res = reg.transition('New', 'active');
    expect(res.ok).toBe(false);
  });

  test('CapabilityPolicy rejects forbidden safety events', () => {
    const { CapabilityPolicy } = require('../../protoforge/packages/capability-policy/src/index');
    const policy = new CapabilityPolicy({
      bad: { allowedEventsProduced: ['system.delete.everything'], allowedEventsConsumed: [] }
    });
    const result = policy.validate({
      name: 'bad',
      eventsProduced: ['system.delete.everything']
    });
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes('forbidden'))).toBe(true);
  });

  test('validate-app rejects generated app with missing tests', () => {
    const { validate } = require('../../protoforge/tools/validate-app/src/validator');
    const os = require('os');
    const targetDir = path.join(os.tmpdir(), `pf-bad-${Date.now()}`);
    fs.mkdirSync(targetDir, { recursive: true });
    fs.writeFileSync(path.join(targetDir, 'manifest.json'), JSON.stringify({
      name: 'Bad',
      version: '0.1.0',
      capabilities: [],
      eventsProduced: [],
      eventsConsumed: [],
      providers: []
    }));
    const result = validate(targetDir);
    expect(result.ok).toBe(false);
    expect(result.errors.some(e => e.includes('tests'))).toBe(true);
  });

  test('generated app can be activated and deprecated', () => {
    const { ApplicationRegistry } = require('../../protoforge/packages/application-registry/src/index');
    const reg = new ApplicationRegistry({ autoLoad: false });
    const generated = reg.register({ name: 'proto-yi', version: '0.1.0', status: 'registered' });
    const active = reg.activate('proto-yi');
    expect(active.ok).toBe(true);
    expect(active.application.status).toBe('active');
    const deprecated = reg.deprecate('proto-yi');
    expect(deprecated.ok).toBe(true);
    expect(deprecated.application.status).toBe('deprecated');
  });
});
