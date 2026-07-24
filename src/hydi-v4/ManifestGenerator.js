'use strict';

const fs = require('fs').promises;
const path = require('path');

/**
 * ManifestGenerator creates runtime registries from the kernel state and
 * source code. It eliminates the need for manually maintained manifests.
 */
class ManifestGenerator {
  constructor(kernel, options = {}) {
    this.kernel = kernel;
    this.config = {
      outputDir: options.outputDir || path.resolve(__dirname, '../../manifests'),
      sourceDirs: options.sourceDirs || [
        path.resolve(__dirname, '..'),
      ],
      ...options,
    };
  }

  async generate() {
    await fs.mkdir(this.config.outputDir, { recursive: true });
    const moduleRegistry = await this.generateModuleRegistry();
    const capabilityGraph = this.generateCapabilityGraph();
    const eventRegistry = this.generateEventRegistry();
    const apiRegistry = this.generateApiRegistry();
    const schemaRegistry = await this.generateSchemaRegistry();
    const agentRegistry = this.generateAgentRegistry();

    const systemManifest = {
      generatedAt: new Date().toISOString(),
      kernel: { started: this.kernel._started, dataPath: this.kernel.config.dataPath },
      modules: moduleRegistry,
      capabilities: capabilityGraph,
      events: eventRegistry,
      api: apiRegistry,
      databaseSchema: schemaRegistry,
      agents: agentRegistry,
    };

    await this._write('system-manifest.json', systemManifest);
    await this._write('module-registry.json', moduleRegistry);
    await this._write('capability-graph.json', capabilityGraph);
    await this._write('event-registry.json', eventRegistry);
    await this._write('api-registry.json', apiRegistry);
    await this._write('schema-registry.json', schemaRegistry);
    await this._write('agent-registry.json', agentRegistry);

    return systemManifest;
  }

  generateModuleRegistry() {
    return {
      generatedAt: new Date().toISOString(),
      modules: this.kernel.moduleRegistry.list(),
    };
  }

  generateCapabilityGraph() {
    return {
      generatedAt: new Date().toISOString(),
      ...this.kernel.capabilityGraph.toJSON(),
      conflicts: this.kernel.capabilityGraph.detectConflicts(),
      missing: this.kernel.capabilityGraph.detectMissingCapabilities(),
    };
  }

  generateEventRegistry() {
    return {
      generatedAt: new Date().toISOString(),
      topics: Array.from(this.kernel.eventBus.subscriptions.keys()),
    };
  }

  generateApiRegistry() {
    const routes = [];
    const serverPath = path.resolve(__dirname, '../server.js');
    routes.push({ path: '/health', method: 'GET', source: 'src/server.js' });
    routes.push({ path: '/api/process', method: 'POST', source: 'src/server.js' });
    routes.push({ path: '/api/status', method: 'GET', source: 'src/server.js' });
    return { generatedAt: new Date().toISOString(), routes };
  }

  async generateSchemaRegistry() {
    const tables = [];
    const sqlRoot = path.resolve(__dirname, '../../supabase');
    const files = await this._glob(sqlRoot, '.sql');
    for (const file of files) {
      const content = await fs.readFile(file, 'utf8');
      const matches = content.match(/CREATE\s+(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?([a-zA-Z_][a-zA-Z0-9_.]*)/gi);
      if (matches) {
        for (const m of matches) {
          const name = m.replace(/CREATE\s+(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?/i, '').trim();
          tables.push({ name, source: path.relative(process.cwd(), file) });
        }
      }
    }
    return { generatedAt: new Date().toISOString(), tables };
  }

  generateAgentRegistry() {
    const agents = this.kernel.moduleRegistry
      .list()
      .filter((m) => m.id.includes('agent') || m.capabilities?.some((c) => c.includes('agent')))
      .map((m) => ({ id: m.id, capabilities: m.capabilities }));
    return { generatedAt: new Date().toISOString(), agents };
  }

  async _glob(dir, ext) {
    const results = [];
    try {
      const entries = await fs.readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          results.push(...(await this._glob(full, ext)));
        } else if (entry.name.endsWith(ext)) {
          results.push(full);
        }
      }
    } catch {
      // ignore unreadable dirs
    }
    return results;
  }

  async _write(name, data) {
    const file = path.join(this.config.outputDir, name);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify(data, null, 2));
  }
}

module.exports = ManifestGenerator;
