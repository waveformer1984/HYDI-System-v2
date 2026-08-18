/**
 * HYDI Dependency Graph Builder
 *
 * Derives the component dependency graph from:
 * - boot.config.json (module dependencies, ports, health endpoints)
 * - Known runtime dependencies (database, ollama, bridge)
 *
 * The graph identifies:
 * - Upstream dependencies (what a component needs)
 * - Downstream dependents (what needs this component)
 * - Critical path (minimum operational path for a Heidi request)
 * - Recovery ordering (recover dependencies before dependents)
 *
 * The graph is NOT assumed — it is derived from actual configuration.
 */

import fs from 'fs';
import path from 'path';
import type { DependencyGraph, DependencyNode, ComponentCategory } from './types';

interface BootConfigModule {
  id: string;
  label?: string;
  type: 'process' | 'module';
  enabled?: boolean;
  required?: boolean;
  command?: string;
  args?: string[];
  port?: number;
  health?: { url: string; graceMs?: number; intervalMs?: number };
  dependsOn?: string[];
}

interface BootConfig {
  modules: BootConfigModule[];
  settings?: Record<string, unknown>;
}

export class DependencyGraphBuilder {
  private root: string;

  constructor(root: string) {
    this.root = root;
  }

  /**
   * Build the dependency graph from boot.config.json plus known runtime
   * dependencies that are not expressed in the boot config (database,
   * ollama, bridge).
   */
  build(): DependencyGraph {
    const bootConfig = this.loadBootConfig();
    const nodes = new Map<string, DependencyNode>();

    // Add infrastructure components that boot.config.json modules depend on
    // but which are not themselves boot modules.
    this.addInfrastructureNodes(nodes);

    // Add boot.config.json modules
    for (const mod of bootConfig.modules) {
      if (mod.enabled === false) continue;

      const criticality = mod.required !== false ? 'critical' : 'optional';
      const category = this.categorizeModule(mod.id);

      // Merge boot.config dependsOn with implicit infrastructure deps
      const deps = [...(mod.dependsOn || [])];
      const implicitDeps = this.implicitDependencies(mod.id);
      for (const dep of implicitDeps) {
        if (!deps.includes(dep)) deps.push(dep);
      }

      nodes.set(mod.id, {
        id: mod.id,
        category,
        criticality,
        dependencies: deps,
        dependents: [],
        recoveryOrder: 0, // computed below
        recoveryPolicy: this.recoveryPolicyFor(mod.id, criticality),
      });
    }

    // Compute dependents (reverse edges)
    for (const [id, node] of nodes) {
      for (const dep of node.dependencies) {
        const depNode = nodes.get(dep);
        if (depNode && !depNode.dependents.includes(id)) {
          depNode.dependents.push(id);
        }
      }
    }

    // Compute recovery order via topological sort
    this.computeRecoveryOrder(nodes);

    // Compute edges
    const edges: Array<{ from: string; to: string; type: 'hard' | 'soft' }> = [];
    for (const [id, node] of nodes) {
      for (const dep of node.dependencies) {
        edges.push({ from: dep, to: id, type: 'hard' });
      }
    }

    // Derive critical path
    const criticalPath = this.deriveCriticalPath(nodes);

    return { nodes, criticalPath, edges };
  }

  private loadBootConfig(): BootConfig {
    const configPath = path.resolve(this.root, 'boot.config.json');
    if (!fs.existsSync(configPath)) {
      throw new Error(`boot.config.json not found at ${configPath}`);
    }
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  }

  private addInfrastructureNodes(nodes: Map<string, DependencyNode>): void {
    // Database (local Supabase) — required by protoforge-core and heidi-web
    nodes.set('database', {
      id: 'database',
      category: 'database',
      criticality: 'critical',
      dependencies: [],
      dependents: ['protoforge-core', 'heidi-web'],
      recoveryOrder: 0,
      recoveryPolicy: 'wait_for_dependency',
    });

    // Ollama — required for AI functionality but not for basic health
    nodes.set('ollama', {
      id: 'ollama',
      category: 'ollama',
      criticality: 'important',
      dependencies: [],
      dependents: ['heidi-web', 'protoforge-core'],
      recoveryOrder: 0,
      recoveryPolicy: 'wait_for_dependency',
    });

    // Bridge (api/chat/route.js) — the universal chat router
    nodes.set('bridge', {
      id: 'bridge',
      category: 'bridge',
      criticality: 'critical',
      dependencies: ['protoforge-core'],
      dependents: ['heidi-web'],
      recoveryOrder: 0,
      recoveryPolicy: 'restart_process',
    });
  }

  private categorizeModule(id: string): ComponentCategory {
    if (id.includes('protoforge')) return 'protoforge';
    if (id.includes('heidi')) return 'heidi';
    if (id.includes('cascade')) return 'cascade';
    if (id.includes('kilo')) return 'kilo';
    if (id.includes('hydi')) return 'runtime';
    if (id.includes('hardware')) return 'runtime';
    if (id.includes('trading')) return 'runtime';
    return 'runtime';
  }

  /**
   * Implicit dependencies that are not expressed in boot.config.json
   * but are known from the architecture.
   */
  private implicitDependencies(id: string): string[] {
    const implicit: string[] = [];
    if (id === 'protoforge-core') {
      implicit.push('database');
    }
    if (id === 'heidi-web') {
      implicit.push('database', 'ollama', 'bridge');
    }
    return implicit;
  }

  private recoveryPolicyFor(
    id: string,
    criticality: string,
  ): 'restart_process' | 'wait_for_dependency' | 'escalate' | 'no_action' {
    if (criticality === 'optional') return 'no_action';
    if (id === 'database' || id === 'ollama') return 'wait_for_dependency';
    return 'restart_process';
  }

  private computeRecoveryOrder(nodes: Map<string, DependencyNode>): void {
    // Topological sort: dependencies get lower order numbers
    const visited = new Set<string>();
    const visiting = new Set<string>();
    let order = 0;

    const visit = (id: string): void => {
      if (visited.has(id)) return;
      if (visiting.has(id)) return; // cycle guard
      visiting.add(id);
      const node = nodes.get(id);
      if (node) {
        for (const dep of node.dependencies) {
          visit(dep);
        }
        node.recoveryOrder = order++;
      }
      visiting.delete(id);
      visited.add(id);
    };

    for (const id of nodes.keys()) {
      visit(id);
    }
  }

  /**
   * Derive the critical path — the minimum set of components that must
   * be healthy for a real Heidi request to succeed.
   *
   * Path: database → protoforge-core → bridge → heidi-web
   * (ollama is important but not on the critical path for basic health)
   */
  private deriveCriticalPath(nodes: Map<string, DependencyNode>): string[] {
    const path: string[] = [];
    const target = 'heidi-web';

    const walk = (id: string): void => {
      const node = nodes.get(id);
      if (!node) return;
      for (const dep of node.dependencies) {
        walk(dep);
      }
      if (!path.includes(id)) path.push(id);
    };

    walk(target);
    return path;
  }
}
