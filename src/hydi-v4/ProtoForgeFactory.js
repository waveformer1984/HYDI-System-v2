'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * ProtoForgeFactory turns any HYDI module into a complete product artifact set:
 * documentation, API docs, tests, deployment manifests, dashboards, business
 * opportunities, licensing metadata, release notes, and migration guides.
 */
class ProtoForgeFactory {
  constructor(kernel, options = {}) {
    this.kernel = kernel;
    this.config = {
      outputDir: options.outputDir || path.resolve(__dirname, '../../manifests/protoforge'),
      ...options,
    };
  }

  async generateForModule(module) {
    const manifest = module.manifest || module;
    const id = manifest.id || 'unknown';
    const artifacts = {
      id,
      generatedAt: new Date().toISOString(),
      documentation: this.generateDocumentation(manifest),
      api: this.generateApiDocs(manifest),
      tests: this.generateTestSkeleton(manifest),
      deployment: this.generateDeploymentManifest(manifest),
      dashboards: this.generateDashboards(manifest),
      business: this.generateBusinessOpportunities(manifest),
      licensing: this.generateLicensingOptions(manifest),
      releaseNotes: this.generateReleaseNotes(manifest),
      migration: this.generateMigrationGuide(manifest),
    };
    return artifacts;
  }

  generateDocumentation(manifest) {
    return {
      title: manifest.name,
      version: manifest.version,
      description: manifest.description,
      author: manifest.author,
      capabilities: manifest.capabilities || [],
      dependencies: manifest.dependencies || [],
      permissions: manifest.permissions || [],
      quickstart: `const mod = kernel.moduleRegistry.get('${manifest.id}');\nawait kernel.startModule('${manifest.id}');`,
    };
  }

  generateApiDocs(manifest) {
    const caps = (manifest.capabilities || []).map((cap) => ({
      capability: cap,
      requestTopic: `capability:${cap}:${manifest.id}`,
      responseTopic: `capability:${cap}:${manifest.id}:response`,
      example: { capability: cap, payload: {} },
    }));
    return { moduleId: manifest.id, capabilities: caps };
  }

  generateTestSkeleton(manifest) {
    return {
      unit: `describe('${manifest.id}', () => { test('initializes', async () => { const m = kernel.moduleRegistry.get('${manifest.id}'); await m.initialize(); expect(m._initialized).toBe(true); }); });`,
      integration: `test('starts and stops cleanly', async () => { await kernel.startModule('${manifest.id}'); await kernel.stopModule('${manifest.id}'); });`,
    };
  }

  generateDeploymentManifest(manifest) {
    return {
      moduleId: manifest.id,
      kind: 'hydi-module',
      version: manifest.version,
      environment: { required: manifest.dependencies || [], optional: manifest.consumes || [] },
      resources: { memory: '256Mi', cpu: '100m' },
    };
  }

  generateDashboards(manifest) {
    return [
      { name: `${manifest.id} health`, metric: 'health' },
      { name: `${manifest.id} usage`, metric: 'autonomous_cycle' },
    ];
  }

  generateBusinessOpportunities(manifest) {
    const opportunities = [];
    for (const cap of manifest.capabilities || []) {
      opportunities.push({ type: 'api', capability: cap, model: 'usage-based' });
    }
    if ((manifest.capabilities || []).includes('agent')) {
      opportunities.push({ type: 'saas', product: 'agent-marketplace', pricing: 'subscription' });
    }
    return opportunities;
  }

  generateLicensingOptions(manifest) {
    return [
      { tier: 'community', price: 0, rights: ['personal use'] },
      { tier: 'commercial', price: 'contact', rights: ['deploy', 'resell'] },
    ];
  }

  generateReleaseNotes(manifest) {
    return {
      version: manifest.version,
      date: new Date().toISOString().split('T')[0],
      changes: ['Initial ProtoForge-generated release.'],
    };
  }

  generateMigrationGuide(manifest) {
    return {
      fromVersion: '*',
      toVersion: manifest.version,
      steps: ['Stop the module', 'Replace artifact', 'Run kernel.startModule()'],
    };
  }

  async publishArtifacts(module) {
    const artifacts = await this.generateForModule(module);
    await fs.mkdir(this.config.outputDir, { recursive: true });
    const file = path.join(this.config.outputDir, `${artifacts.id}.json`);
    await fs.writeFile(file, JSON.stringify(artifacts, null, 2));
    return { file, artifacts };
  }
}

module.exports = ProtoForgeFactory;
