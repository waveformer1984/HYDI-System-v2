/**
 * HEIDI Operational Integration — Runtime Observation Adapter
 *
 * Translates RuntimeObserver/HealthAggregator output into the normalized schema
 * expected by HeidiDecisionEngine, without duplicating probes.
 */

const fs = require('fs');
const path = require('path');
const { PredictiveIntelligence } = require('./PredictiveIntelligence');

class RuntimeObservationAdapter {
  constructor(options = {}) {
    this.manifestPath = options.manifestPath || path.join(process.cwd(), 'services-manifest.json');
    this.predictive = new PredictiveIntelligence(options.predictive);
  }

  loadManifest() {
    try {
      return JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'));
    } catch (e) {
      return { services: {} };
    }
  }

  dependencyGraph() {
    const manifest = this.loadManifest();
    const graph = {};
    for (const [name, svc] of Object.entries(manifest.services || {})) {
      graph[name] = svc.dependencies || [];
    }
    return graph;
  }

  normalize(probes) {
    const manifest = this.loadManifest();
    const observations = {};
    const states = {};
    for (const [name, result] of Object.entries(probes)) {
      observations[name] = { status: result.status || 'UNKNOWN', detail: result.detail || '' };
      states[name] = result;
    }

    const predictions = [];
    const containerStates = states['docker-containers'];
    if (containerStates && Array.isArray(containerStates.states)) {
      for (const c of containerStates.states) {
        if (!c.name) continue;
        const history = [];
        if (c.restarts) {
          history.push({ timestamp: Date.now(), event: 'restart', count: c.restarts });
        }
        const p = this.predictive.analyze(c.name, history);
        if (p.warnings.length) predictions.push({ component: c.name, ...p });
      }
    }

    const dependencyGraph = this.dependencyGraph();
    const critical = [];
    const userFacing = [];
    for (const [name, svc] of Object.entries(manifest.services || {})) {
      if (svc.required) critical.push(name);
      if (name === 'next-app' || name === 'heidi-mobile') userFacing.push(name);
    }

    return {
      timestamp: new Date().toISOString(),
      observations,
      states,
      dependencyGraph,
      predictions,
      critical: new Set([...critical, 'docker-daemon', 'supabase-db-container', 'supabase-kong-container', 'postgres-compose', 'redis-compose']),
      userFacing: new Set(userFacing),
      dataIntegrity: new Set(['postgres-compose', 'postgres-tcp', 'supabase-db-container']),
    };
  }
}

module.exports = { RuntimeObservationAdapter };
