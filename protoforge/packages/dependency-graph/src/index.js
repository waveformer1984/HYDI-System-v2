const path = require('path');
const { discover } = require('../../../packages/application-manifest/src/index');

class DependencyGraph {
  constructor(options = {}) {
    this.nodes = new Map();
    this.edges = [];
    this.nodeTypes = new Set(['application', 'capability', 'service', 'infrastructure', 'event']);
    if (options.manifests) {
      this.buildFromManifests(options.manifests);
    }
  }

  _ensureNode(id, type, payload = {}) {
    if (!this.nodes.has(id)) {
      this.nodes.set(id, { id, type, ...payload });
    }
    return this.nodes.get(id);
  }

  _addEdge(from, to, type, payload = {}) {
    this.edges.push({ from, to, type, ...payload });
  }

  addApplication(manifest) {
    const appId = `app:${manifest.name}`;
    this._ensureNode(appId, 'application', { name: manifest.name, version: manifest.version });

    for (const cap of manifest.capabilities || []) {
      const capId = `cap:${cap}`;
      this._ensureNode(capId, 'capability', { name: cap });
      this._addEdge(appId, capId, 'provides');
    }

    for (const ev of manifest.eventsProduced || []) {
      const evId = `event:${ev}`;
      this._ensureNode(evId, 'event', { name: ev });
      this._addEdge(appId, evId, 'produces');
    }

    for (const ev of manifest.eventsConsumed || []) {
      const evId = `event:${ev}`;
      this._ensureNode(evId, 'event', { name: ev });
      this._addEdge(evId, appId, 'consumedBy');
    }

    for (const svc of [...(manifest.providers || []), ...(manifest.dependencies?.services || [])]) {
      const svcId = `svc:${svc}`;
      this._ensureNode(svcId, 'service', { name: svc });
      this._addEdge(appId, svcId, 'requires');
    }

    for (const pkg of manifest.dependencies?.packages || []) {
      const pkgId = `pkg:${pkg}`;
      this._ensureNode(pkgId, 'infrastructure', { name: pkg });
      this._addEdge(appId, pkgId, 'requires');
    }

    for (const req of manifest.healthRequirements || []) {
      const reqId = `svc:${req}`;
      this._ensureNode(reqId, 'service', { name: req });
      this._addEdge(appId, reqId, 'healthRequires');
    }
  }

  buildFromManifests(manifests) {
    for (const manifest of manifests) {
      this.addApplication(manifest);
    }
    return this;
  }

  buildFromDiscovery(searchDirs) {
    const dirs = searchDirs || [
      path.resolve(__dirname, '..', '..', '..', '..', 'switchboard'),
      path.resolve(__dirname, '..', '..', '..', '..', 'protoforge-applications')
    ];
    const manifests = discover(dirs);
    return this.buildFromManifests(manifests);
  }

  toJSON() {
    return {
      nodes: [...this.nodes.values()],
      edges: this.edges
    };
  }

  getApplicationsForService(serviceName) {
    const serviceId = `svc:${serviceName}`;
    return [...new Set(this.edges
      .filter(e => e.to === serviceId && ['requires', 'healthRequires'].includes(e.type))
      .map(e => this.nodes.get(e.from).name))];
  }

  getApplicationsForCapability(capabilityName) {
    const capId = `cap:${capabilityName}`;
    return [...new Set(this.edges
      .filter(e => e.to === capId && e.type === 'provides')
      .map(e => this.nodes.get(e.from).name))];
  }

  getProducers(eventType) {
    const evId = `event:${eventType}`;
    return [...new Set(this.edges
      .filter(e => e.to === evId && e.type === 'produces')
      .map(e => this.nodes.get(e.from).name))];
  }

  getConsumers(eventType) {
    const evId = `event:${eventType}`;
    return [...new Set(this.edges
      .filter(e => e.from === evId && e.type === 'consumedBy')
      .map(e => this.nodes.get(e.to).name))];
  }

  getDependencies(appName) {
    const appId = `app:${appName}`;
    return this.edges
      .filter(e => e.from === appId && e.type !== 'produces')
      .map(e => ({ type: e.type, ...this.nodes.get(e.to) }));
  }

  hasCycles() {
    const adj = new Map();
    for (const [id] of this.nodes) {
      adj.set(id, []);
    }
    for (const edge of this.edges) {
      if (adj.has(edge.from)) adj.get(edge.from).push(edge.to);
    }
    const visited = new Set();
    const stack = new Set();
    const visit = (id) => {
      if (stack.has(id)) return true;
      if (visited.has(id)) return false;
      visited.add(id);
      stack.add(id);
      for (const next of adj.get(id) || []) {
        if (visit(next)) return true;
      }
      stack.delete(id);
      return false;
    };
    for (const [id] of this.nodes) {
      if (visit(id)) return true;
    }
    return false;
  }

  analyze() {
    const json = this.toJSON();
    const byType = {};
    for (const node of json.nodes) {
      byType[node.type] = (byType[node.type] || 0) + 1;
    }
    return {
      totalNodes: json.nodes.length,
      totalEdges: json.edges.length,
      byType,
      hasCycles: this.hasCycles()
    };
  }
}

module.exports = { DependencyGraph };
