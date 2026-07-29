'use strict';

const { EventEmitter } = require('events');

/**
 * DependencyPlanner builds a dependency graph, detects cycles, and produces
 * a valid execution ordering for goals and tasks.
 */
class DependencyPlanner extends EventEmitter {
  constructor(config = {}) {
    super();
    this.logger = config.logger || console;
    this.index = new Map();
  }

  buildGraph(items) {
    this.index.clear();
    const graph = new Map();
    for (const item of items) {
      const id = item.id || item;
      const deps = item.dependencies || [];
      this.index.set(id, item);
      graph.set(id, deps.slice());
    }
    this.emit('graph_built', { graph });
    return graph;
  }

  detectCycles(graph) {
    const visiting = new Set();
    const visited = new Set();
    const cycles = [];

    const visit = (id, path) => {
      if (visited.has(id)) return;
      if (visiting.has(id)) {
        const start = path.indexOf(id);
        cycles.push(path.slice(start).concat([id]));
        return;
      }
      visiting.add(id);
      path.push(id);
      const deps = graph.get(id) || [];
      for (const dep of deps) visit(dep, path.slice());
      path.pop();
      visiting.delete(id);
      visited.add(id);
    };

    for (const id of graph.keys()) visit(id, []);
    return cycles;
  }

  order(items) {
    const graph = this.buildGraph(items);
    const cycles = this.detectCycles(graph);
    if (cycles.length > 0) return { success: false, error: 'cycle_detected', cycles };

    const inDegree = new Map();
    for (const id of graph.keys()) inDegree.set(id, 0);
    for (const [id, deps] of graph) {
      for (const dep of deps) {
        if (graph.has(dep)) inDegree.set(id, (inDegree.get(id) || 0) + 1);
      }
    }

    const queue = Array.from(graph.keys()).filter((id) => inDegree.get(id) === 0);
    queue.sort((a, b) => a.localeCompare(b));
    const ordered = [];
    while (queue.length > 0) {
      const id = queue.shift();
      ordered.push(this.index.get(id) || id);
      for (const [child, deps] of graph) {
        if (deps.includes(id)) {
          const deg = inDegree.get(child) - 1;
          inDegree.set(child, deg);
          if (deg === 0) {
            queue.push(child);
            queue.sort();
          }
        }
      }
    }

    if (ordered.length !== graph.size) {
      return { success: false, error: 'partial_order' };
    }
    this.emit('ordered', { ordered });
    return { success: true, ordered };
  }

  validatePrerequisites(items, completed = new Set()) {
    const graph = this.buildGraph(items);
    const missing = [];
    for (const [id, deps] of graph) {
      for (const dep of deps) {
        if (!completed.has(dep) && graph.has(dep)) missing.push({ id, dep });
      }
    }
    if (missing.length > 0) return { success: false, error: 'prerequisites_missing', missing };
    return { success: true };
  }
}

module.exports = DependencyPlanner;
