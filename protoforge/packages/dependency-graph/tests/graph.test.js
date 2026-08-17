const { describe, it } = require('node:test');
const assert = require('node:assert');
const { DependencyGraph } = require('../src/index');

const protoManifest = {
  name: 'Proto YI',
  version: '0.1.0',
  capabilities: ['builder', 'planner'],
  eventsProduced: ['project.created'],
  eventsConsumed: ['protoforge.decision'],
  providers: ['json-store'],
  dependencies: {
    services: ['supabase'],
    packages: ['@protoforge/event-contracts']
  },
  healthRequirements: ['supabase']
};

const switchboardManifest = {
  name: 'Switchboard',
  version: '1.0.0',
  capabilities: ['event-ingestion', 'trust-layer'],
  eventsProduced: ['protoforge.decision', 'user.created'],
  eventsConsumed: ['project.created'],
  providers: ['json-store'],
  dependencies: {
    services: ['supabase'],
    packages: []
  }
};

describe('DependencyGraph', () => {
  it('builds from manifests', () => {
    const graph = new DependencyGraph({ manifests: [protoManifest, switchboardManifest] });
    const json = graph.toJSON();
    assert.ok(json.nodes.length > 0);
    assert.ok(json.edges.length > 0);
  });

  it('creates application nodes', () => {
    const graph = new DependencyGraph({ manifests: [protoManifest] });
    const app = graph.nodes.get('app:Proto YI');
    assert.ok(app);
    assert.strictEqual(app.type, 'application');
    assert.strictEqual(app.version, '0.1.0');
  });

  it('creates capability nodes', () => {
    const graph = new DependencyGraph({ manifests: [protoManifest] });
    assert.ok(graph.nodes.get('cap:builder'));
    assert.ok(graph.nodes.get('cap:planner'));
  });

  it('links applications to capabilities', () => {
    const graph = new DependencyGraph({ manifests: [protoManifest] });
    const apps = graph.getApplicationsForCapability('builder');
    assert.deepStrictEqual(apps, ['Proto YI']);
  });

  it('links producers and consumers of events', () => {
    const graph = new DependencyGraph({ manifests: [protoManifest, switchboardManifest] });
    const producers = graph.getProducers('project.created');
    assert.deepStrictEqual(producers, ['Proto YI']);
    const consumers = graph.getConsumers('project.created');
    assert.deepStrictEqual(consumers, ['Switchboard']);
  });

  it('links events back to consumer applications', () => {
    const graph = new DependencyGraph({ manifests: [protoManifest] });
    const consumers = graph.getConsumers('protoforge.decision');
    assert.deepStrictEqual(consumers, ['Proto YI']);
  });

  it('tracks service dependencies', () => {
    const graph = new DependencyGraph({ manifests: [protoManifest] });
    const apps = graph.getApplicationsForService('supabase');
    assert.deepStrictEqual(apps, ['Proto YI']);
  });

  it('tracks package dependencies', () => {
    const graph = new DependencyGraph({ manifests: [protoManifest] });
    const deps = graph.getDependencies('Proto YI');
    const packages = deps.filter(d => d.type === 'requires' && d.type === 'requires' && d.nodeType === 'infrastructure');
    assert.ok(deps.some(d => d.id === 'pkg:@protoforge/event-contracts'));
  });

  it('analyzes graph totals', () => {
    const graph = new DependencyGraph({ manifests: [protoManifest] });
    const analysis = graph.analyze();
    assert.strictEqual(typeof analysis.totalNodes, 'number');
    assert.strictEqual(typeof analysis.totalEdges, 'number');
    assert.strictEqual(analysis.hasCycles, false);
  });

  it('detects cycles', () => {
    const a = { name: 'A', capabilities: [], eventsProduced: ['x.created'], eventsConsumed: ['y.created'] };
    const b = { name: 'B', capabilities: [], eventsProduced: ['y.created'], eventsConsumed: ['x.created'] };
    const graph = new DependencyGraph({ manifests: [a, b] });
    assert.strictEqual(graph.hasCycles(), true);
  });

  it('returns empty for unused service', () => {
    const graph = new DependencyGraph({ manifests: [protoManifest] });
    assert.deepStrictEqual(graph.getApplicationsForService('s3'), []);
  });

  it('builds from discovery', () => {
    const graph = new DependencyGraph({});
    graph.buildFromDiscovery();
    const analysis = graph.analyze();
    assert.ok(analysis.totalNodes > 0);
  });

  it('exposes node and edge lists', () => {
    const graph = new DependencyGraph({ manifests: [protoManifest] });
    const json = graph.toJSON();
    assert.ok(Array.isArray(json.nodes));
    assert.ok(Array.isArray(json.edges));
    for (const node of json.nodes) {
      assert.ok(node.id);
      assert.ok(node.type);
    }
    for (const edge of json.edges) {
      assert.ok(edge.from);
      assert.ok(edge.to);
      assert.ok(edge.type);
    }
  });

  it('gets all dependencies for an application', () => {
    const graph = new DependencyGraph({ manifests: [protoManifest] });
    const deps = graph.getDependencies('Proto YI');
    assert.ok(deps.length > 0);
    const names = deps.map(d => d.id);
    assert.ok(names.includes('svc:supabase'));
    assert.ok(names.includes('cap:builder'));
  });

  it('handles empty manifests', () => {
    const empty = { name: 'Empty', version: '0.0.0' };
    const graph = new DependencyGraph({ manifests: [empty] });
    const json = graph.toJSON();
    assert.strictEqual(json.nodes.length, 1);
    assert.deepStrictEqual(json.edges, []);
  });
});
