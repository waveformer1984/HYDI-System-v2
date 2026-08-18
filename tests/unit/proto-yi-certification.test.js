const path = require('path');
const { Certifier } = require('../../protoforge/packages/certification/src/index');
const { DependencyGraph } = require('../../protoforge/packages/dependency-graph/src/index');
const { ApplicationRegistry } = require('../../protoforge/packages/application-registry/src/index');

const PROTO_YI_DIR = path.join(process.cwd(), 'protoforge-applications', 'proto-yi');

describe('Proto YI Certification', () => {
  test('passes full certification', async () => {
    const certifier = new Certifier({ requireTests: true, requireDocs: true, requirePolicy: false });
    const result = await certifier.certify(PROTO_YI_DIR);
    expect(result.ok).toBe(true);
    expect(result.report.certified).toBe(true);
    expect(result.report.checks.manifest.ok).toBe(true);
    expect(result.report.checks.capabilities.ok).toBe(true);
    expect(result.report.checks.dependencies.ok).toBe(true);
    expect(result.report.checks.lifecycle.ok).toBe(true);
    expect(result.report.checks.events.ok).toBe(true);
    expect(result.report.checks.diagnostics.ok).toBe(true);
    expect(result.report.checks.policy.ok).toBe(true);
    expect(result.report.checks.graph.ok).toBe(true);
  });

  test('manifest declares capabilities', () => {
    const loaded = require('fs').readFileSync(path.join(PROTO_YI_DIR, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(loaded);
    expect(manifest.capabilities.length).toBeGreaterThan(0);
    expect(manifest.capabilities).toContain('builder');
  });

  test('manifest declares produced events', () => {
    const loaded = require('fs').readFileSync(path.join(PROTO_YI_DIR, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(loaded);
    expect(manifest.eventsProduced.length).toBeGreaterThan(0);
    expect(manifest.eventsProduced.every(e => e.includes('.'))).toBe(true);
  });

  test('manifest declares consumed events', () => {
    const loaded = require('fs').readFileSync(path.join(PROTO_YI_DIR, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(loaded);
    expect(manifest.eventsConsumed.length).toBeGreaterThan(0);
  });

  test('manifest produced events include canonical Proto YI events', () => {
    const loaded = require('fs').readFileSync(path.join(PROTO_YI_DIR, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(loaded);
    expect(manifest.eventsProduced).toContain('project.created');
    expect(manifest.eventsProduced).toContain('timeline.created');
    expect(manifest.eventsProduced).toContain('milestone.scheduled');
  });

  test('manifest does not declare stale milestone.reached', () => {
    const loaded = require('fs').readFileSync(path.join(PROTO_YI_DIR, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(loaded);
    expect(manifest.eventsProduced).not.toContain('milestone.reached');
  });

  test('manifest consumed events match implementation', () => {
    const loaded = require('fs').readFileSync(path.join(PROTO_YI_DIR, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(loaded);
    expect(manifest.eventsConsumed).toEqual(['protoforge.decision', 'protoforge.policy.approved', 'protoforge.policy.rejected']);
  });

  test('manifest declares dependencies', () => {
    const loaded = require('fs').readFileSync(path.join(PROTO_YI_DIR, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(loaded);
    expect(manifest.dependencies).toBeDefined();
    expect(manifest.dependencies.services.length).toBeGreaterThan(0);
    expect(manifest.dependencies.packages.length).toBeGreaterThan(0);
  });

  test('manifest includes governance metadata', () => {
    const loaded = require('fs').readFileSync(path.join(PROTO_YI_DIR, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(loaded);
    expect(manifest.governance).toBeDefined();
    expect(manifest.governance.domain).toBe('project-management');
  });

  test('manifest declares required services', () => {
    const loaded = require('fs').readFileSync(path.join(PROTO_YI_DIR, 'manifest.json'), 'utf-8');
    const manifest = JSON.parse(loaded);
    expect(manifest.providers).toContain('protoiy-engine');
    expect(manifest.dependencies.services).toContain('supabase');
    expect(manifest.dependencies.services).toContain('hydi-gateway');
    expect(manifest.healthRequirements).toContain('protoiy-engine');
    expect(manifest.healthRequirements).toContain('hydi-gateway');
  });

  test('Proto YI is in the application registry', () => {
    const registry = new ApplicationRegistry({ autoLoad: true });
    const app = registry.get('Proto YI');
    expect(app).not.toBeNull();
    expect(app.name).toBe('Proto YI');
  });

  test('dependency graph includes Proto YI', () => {
    const graph = new DependencyGraph({});
    graph.buildFromDiscovery();
    const node = graph.nodes.get('app:Proto YI');
    expect(node).toBeDefined();
    const deps = graph.getDependencies('Proto YI');
    expect(deps.length).toBeGreaterThan(0);
  });

  test('Proto YI requires supabase', () => {
    const graph = new DependencyGraph({});
    graph.buildFromDiscovery();
    const apps = graph.getApplicationsForService('supabase');
    expect(apps).toContain('Proto YI');
  });

  test('Proto YI provides builder capability', () => {
    const graph = new DependencyGraph({});
    graph.buildFromDiscovery();
    const apps = graph.getApplicationsForCapability('builder');
    expect(apps).toContain('Proto YI');
  });
});
