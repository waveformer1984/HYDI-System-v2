/**
 * HEIDI Operational Decision Engine — Incident Correlation and Root-Cause Grouping
 */

const { FailureClassifier } = require('./FailureClassifier');

class IncidentCorrelator {
  constructor(options = {}) {
    this.classifier = new FailureClassifier();
    this.infrastructure = new Set(options.infrastructure || ['docker-daemon', 'wsl', 'docker-desktop']);
    this.dependencyGraph = options.dependencyGraph || {};
    this.roots = new Map();
    this.symptoms = new Map();
  }

  setDependencyGraph(graph) {
    this.dependencyGraph = graph || {};
  }

  // Find all components that (transitively) depend on the given root.
  dependents(target, visited = new Set()) {
    const direct = [];
    for (const [name, deps] of Object.entries(this.dependencyGraph)) {
      if (deps.includes(target) || deps.includes('*')) direct.push(name);
    }

    const all = new Set(direct);
    for (const child of direct) {
      if (visited.has(child)) continue;
      visited.add(child);
      for (const sub of this.dependents(child, visited)) all.add(sub);
    }
    return [...all];
  }

  correlate(observations) {
    this.roots = new Map();
    this.symptoms = new Map();
    const entries = Object.entries(observations);

    // First pass: identify infrastructure root failures
    for (const [name, state] of entries) {
      if (state.status !== 'HEALTHY' && this.infrastructure.has(name)) {
        const cls = this.classifier.classify(state);
        this.roots.set(name, {
          rootIncident: true,
          component: name,
          failure_class: cls.failure_class,
          confidence: cls.confidence,
          state,
          affected: [],
        });
      }
    }

    // Second pass: attach dependents to roots or create standalone incidents
    for (const [name, state] of entries) {
      if (state.status === 'HEALTHY') continue;
      if (this.infrastructure.has(name)) continue;

      const roots = [...this.roots.keys()];
      let attached = false;

      for (const root of roots) {
        const dependents = this.dependents(root);
        if (dependents.includes(name)) {
          this.roots.get(root).affected.push({ component: name, state });
          this.symptoms.set(name, root);
          attached = true;
          break;
        }
      }

      if (!attached) {
        const cls = this.classifier.classify(state);
        this.roots.set(name, {
          rootIncident: true,
          component: name,
          failure_class: cls.failure_class,
          confidence: cls.confidence,
          state,
          affected: [],
        });
      }
    }

    return {
      roots: Array.from(this.roots.values()),
      count: this.roots.size,
      symptoms: Object.fromEntries(this.symptoms),
    };
  }
}

module.exports = { IncidentCorrelator };
