/**
 * HYDI Goal Decomposer
 *
 * Turns a human goal into a dependency graph of governed actions.
 *
 * The decomposer does NOT execute anything. It produces an ActionGraph
 * that the HumanActionEngine executes in dependency order.
 *
 * Decomposition strategies:
 *   - Pattern-based: match common goal patterns to action templates
 *   - Capability-based: inspect available capabilities and build steps
 *   - Heuristic: use goal keywords to infer required actions
 *
 * The decomposer always:
 *   - Checks capability availability before including an action
 *   - Respects authorization requirements
 *   - Produces verification steps
 *   - Includes rollback where possible
 */

import { randomUUID } from 'crypto';
import type {
  ActionGraph,
  ActionGraphNode,
  ActionGraphEdge,
  HumanActionIntent,
  HumanGoal,
} from './HumanActionTypes';
import type { ActionCapabilityRegistry } from './ActionCapabilityRegistry';

// ---------------------------------------------------------------------------
// Decomposition patterns
// ---------------------------------------------------------------------------

interface DecompositionPattern {
  id: string;
  matchKeywords: string[];
  description: string;
  produceIntents: (goal: HumanGoal, context: DecompositionContext) => HumanActionIntent[];
}

interface DecompositionContext {
  rootDir: string;
  targetService?: string;
  targetUrl?: string;
}

// ---------------------------------------------------------------------------
// Built-in decomposition patterns
// ---------------------------------------------------------------------------

const PATTERNS: DecompositionPattern[] = [
  {
    id: 'create-project-directory',
    matchKeywords: ['create', 'project', 'directory', 'folder', 'initialize', 'init'],
    description: 'Create a project directory and initialize it',
    produceIntents: (goal, ctx) => {
      const dirPath = goal.context ?? `${ctx.rootDir}/new-project`;
      return [
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'SYSTEM',
          capability: 'filesystem.create_directory',
          operation: 'create_directory',
          target: dirPath,
          parameters: {},
          reason: 'Create the project directory',
          expectedResult: 'Directory exists',
        },
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'DEVELOPMENT',
          capability: 'dev.git_status',
          operation: 'git_status',
          target: dirPath,
          parameters: { cwd: dirPath },
          reason: 'Check if directory is a git repo',
          expectedResult: 'Git status output',
          dependencies: [],
        },
      ];
    },
  },
  {
    id: 'check-system-health',
    matchKeywords: ['check', 'why', 'unhealthy', 'health', 'status', 'diagnose', 'inspect'],
    description: 'Check why a system is unhealthy',
    produceIntents: (goal, ctx) => {
      const target = goal.context ?? ctx.targetUrl ?? 'http://localhost:3000/api/health';
      return [
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'INFRASTRUCTURE',
          capability: 'infra.health_check',
          operation: 'health_check',
          target,
          parameters: {},
          reason: 'Check the health endpoint',
          expectedResult: 'Health status response',
        },
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'DEVELOPMENT',
          capability: 'dev.git_status',
          operation: 'git_status',
          target: ctx.rootDir,
          parameters: { cwd: ctx.rootDir },
          reason: 'Check repository state for recent changes',
          expectedResult: 'Git status output',
        },
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'SYSTEM',
          capability: 'process.inspect',
          operation: 'inspect',
          target: 'node',
          parameters: {},
          reason: 'Check if Node processes are running',
          expectedResult: 'Process inspection result',
        },
      ];
    },
  },
  {
    id: 'prepare-production',
    matchKeywords: ['prepare', 'production', 'ready', 'deploy', 'ship'],
    description: 'Prepare ProtoForge for production',
    produceIntents: (goal, ctx) => {
      return [
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'DEVELOPMENT',
          capability: 'dev.git_status',
          operation: 'git_status',
          target: ctx.rootDir,
          parameters: { cwd: ctx.rootDir },
          reason: 'Inspect repository state',
          expectedResult: 'Clean working tree or known changes',
        },
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'DEVELOPMENT',
          capability: 'dev.run_tests',
          operation: 'run_tests',
          target: ctx.rootDir,
          parameters: { cwd: ctx.rootDir, command: 'npm test' },
          reason: 'Run test suite to verify everything passes',
          expectedResult: 'All tests pass',
          dependencies: [],
        },
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'DEVELOPMENT',
          capability: 'dev.build',
          operation: 'build',
          target: ctx.rootDir,
          parameters: { cwd: ctx.rootDir, command: 'npm run build' },
          reason: 'Build the project to verify it compiles',
          expectedResult: 'Build succeeds',
          dependencies: [],
        },
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'CREDENTIALS',
          capability: 'credential.discover',
          operation: 'discover',
          target: 'environment',
          parameters: {},
          reason: 'Check all required credentials are present',
          expectedResult: 'All credentials discovered',
        },
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'INFRASTRUCTURE',
          capability: 'infra.health_check',
          operation: 'health_check',
          target: 'http://localhost:3000/api/health',
          parameters: {},
          reason: 'Verify the service is healthy',
          expectedResult: 'Service responds healthy',
          dependencies: [],
        },
      ];
    },
  },
  {
    id: 'configure-credential',
    matchKeywords: ['configure', 'credential', 'api', 'key', 'secret', 'setup'],
    description: 'Configure a credential through an authorized provider',
    produceIntents: (goal, _ctx) => {
      return [
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'CREDENTIALS',
          capability: 'credential.discover',
          operation: 'discover',
          target: 'environment',
          parameters: {},
          reason: 'Discover existing credentials',
          expectedResult: 'Current credential inventory',
        },
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'CREDENTIALS',
          capability: 'credential.validate',
          operation: 'validate',
          target: goal.context ?? 'all',
          parameters: { credentialRef: goal.context ?? 'all' },
          reason: 'Validate the credential against its provider',
          expectedResult: 'Credential is valid',
          dependencies: [],
        },
      ];
    },
  },
  {
    id: 'website-setup',
    matchKeywords: ['website', 'setup', 'sign up', 'register', 'form', 'configure online'],
    description: 'Complete a website setup process',
    produceIntents: (goal, ctx) => {
      const url = goal.context ?? ctx.targetUrl ?? '';
      if (!url) return [];
      return [
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'BROWSER',
          capability: 'browser.navigate',
          operation: 'navigate',
          target: url,
          parameters: { url },
          reason: 'Navigate to the website',
          expectedResult: 'Page loads successfully',
        },
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'BROWSER',
          capability: 'browser.inspect_page',
          operation: 'inspect',
          target: url,
          parameters: {},
          reason: 'Inspect the page to understand the setup form',
          expectedResult: 'Page structure understood',
          dependencies: [],
        },
      ];
    },
  },
  {
    id: 'repair-system',
    matchKeywords: ['repair', 'fix', 'recover', 'resolve', 'restore'],
    description: 'Repair a system if the repair is safe',
    produceIntents: (goal, ctx) => {
      const target = goal.context ?? ctx.targetUrl ?? 'http://localhost:3000';
      return [
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'INFRASTRUCTURE',
          capability: 'infra.health_check',
          operation: 'health_check',
          target,
          parameters: {},
          reason: 'Observe current health state',
          expectedResult: 'Health status captured',
        },
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'INFRASTRUCTURE',
          capability: 'infra.service_restart',
          operation: 'restart',
          target: goal.context ?? 'protoforge-core',
          parameters: { reason: 'System unhealthy — repair requested' },
          reason: 'Restart the unhealthy service',
          expectedResult: 'Service is healthy after restart',
          dependencies: [],
        },
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'INFRASTRUCTURE',
          capability: 'infra.health_check',
          operation: 'health_check',
          target,
          parameters: {},
          reason: 'Verify the service is healthy after restart',
          expectedResult: 'Service responds healthy',
          dependencies: [],
        },
      ];
    },
  },
];

// ---------------------------------------------------------------------------
// Goal Decomposer
// ---------------------------------------------------------------------------

export class GoalDecomposer {
  private registry: ActionCapabilityRegistry;
  private patterns: DecompositionPattern[];

  constructor(registry: ActionCapabilityRegistry, patterns?: DecompositionPattern[]) {
    this.registry = registry;
    this.patterns = patterns ?? PATTERNS;
  }

  /**
   * Decompose a goal into an action graph.
   */
  decompose(goal: HumanGoal, context: DecompositionContext): ActionGraph {
    const statement = goal.statement.toLowerCase();

    // Find matching patterns
    const matchedPatterns = this.patterns.filter((p) =>
      p.matchKeywords.some((kw) => statement.includes(kw)),
    );

    let intents: HumanActionIntent[] = [];

    if (matchedPatterns.length > 0) {
      // Use the first matching pattern (most specific patterns should be first)
      intents = matchedPatterns[0].produceIntents(goal, context);
    }

    // If no pattern matched, produce a generic observation intent
    if (intents.length === 0) {
      intents = [
        {
          intentId: randomUUID(),
          goalId: goal.goalId,
          actor: goal.statedBy,
          category: 'COGNITIVE',
          capability: 'infra.health_check',
          operation: 'observe',
          target: context.targetUrl ?? 'http://localhost:3000',
          parameters: {},
          reason: 'No specific decomposition pattern matched — observe current state',
          expectedResult: 'System state observed',
        },
      ];
    }

    // Filter out intents for unavailable capabilities
    const filteredIntents = intents.filter((intent) => {
      const cap = this.registry.get(intent.capability);
      if (!cap) return false;
      if (cap.status === 'UNSUPPORTED' || cap.status === 'BLOCKED') return false;
      return true;
    });

    // Build the action graph
    const nodes: ActionGraphNode[] = filteredIntents.map((intent, index) => ({
      actionId: `action-${goal.goalId.slice(0, 8)}-${index}`,
      intent,
      status: 'pending',
      dependsOn: intent.dependencies ?? [],
    }));

    const edges: ActionGraphEdge[] = [];
    for (const node of nodes) {
      for (const dep of node.dependsOn) {
        edges.push({ from: dep, to: node.actionId, type: 'dependency' });
      }
    }

    // Topological sort for execution order
    const executionOrder = this.topologicalSort(nodes, edges);

    return {
      goalId: goal.goalId,
      nodes,
      edges,
      executionOrder,
    };
  }

  /**
   * Add a custom decomposition pattern.
   */
  addPattern(pattern: DecompositionPattern): void {
    this.patterns.unshift(pattern); // Add at beginning for priority
  }

  // -----------------------------------------------------------------------
  // Private helpers
  // -----------------------------------------------------------------------

  private topologicalSort(nodes: ActionGraphNode[], edges: ActionGraphEdge[]): string[] {
    const inDegree: Map<string, number> = new Map();
    const adjacency: Map<string, string[]> = new Map();

    for (const node of nodes) {
      inDegree.set(node.actionId, 0);
      adjacency.set(node.actionId, []);
    }

    for (const edge of edges) {
      if (edge.type !== 'dependency') continue;
      const adj = adjacency.get(edge.from);
      if (adj) adj.push(edge.to);
      const deg = inDegree.get(edge.to);
      if (deg !== undefined) inDegree.set(edge.to, deg + 1);
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const result: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      const neighbors = adjacency.get(current) ?? [];
      for (const neighbor of neighbors) {
        const deg = inDegree.get(neighbor);
        if (deg !== undefined) {
          inDegree.set(neighbor, deg - 1);
          if (deg - 1 === 0) queue.push(neighbor);
        }
      }
    }

    // Add any remaining nodes (in case of cycles)
    for (const node of nodes) {
      if (!result.includes(node.actionId)) {
        result.push(node.actionId);
      }
    }

    return result;
  }
}
