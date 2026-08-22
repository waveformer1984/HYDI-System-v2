/**
 * HYDI Dynamic Planner
 *
 * Produces a dependency graph of objectives from observed reality.
 * NOT a fixed sequence — the plan changes based on observations.
 *
 * Each objective can generate additional sub-objectives based on observed state.
 * Plans are generated from reality, not from predetermined templates.
 */

import { randomUUID } from 'crypto';
import type {
  AdaptivePlan,
  GoalObjective,
  GoalState,
  Observation,
  PlanObjective,
  WorldState,
  PlanAssumption,
} from './AdaptiveOperatorTypes';
import type { WorldStateManager } from './WorldStateManager';
import type { ActionCapabilityRegistry } from '../human-action/ActionCapabilityRegistry';
import type { HumanActionIntent } from '../human-action/HumanActionTypes';
import type { TaskMemoryStore } from './TaskMemoryStore';

// ---------------------------------------------------------------------------
// Objective templates — these are NOT fixed action sequences.
// They define WHAT needs to be true, not HOW to make it true.
// The planner generates actions based on current observations.
// ---------------------------------------------------------------------------

export interface ObjectiveTemplate {
  name: string;
  description: string;
  check: (worldState: WorldState) => ObjectiveCheckResult;
  generateIntents: (worldState: WorldState, goalId: string, rootDir: string, registry: ActionCapabilityRegistry, ctx?: unknown) => HumanActionIntent[];
  dependsOn?: string[];
  riskLevel: 'R0' | 'R1' | 'R2' | 'R3' | 'R4' | 'R5';
}

export interface ObjectiveCheckResult {
  satisfied: boolean;
  confidence: number;
  evidence: string;
  needsInvestigation?: boolean;
}

// ---------------------------------------------------------------------------
// Built-in objective templates
// ---------------------------------------------------------------------------

const OBJECTIVE_TEMPLATES: Record<string, ObjectiveTemplate> = {
  CODE_HEALTHY: {
    name: 'CODE_HEALTHY',
    description: 'Repository is in a clean, healthy state',
    riskLevel: 'R0',
    check: (ws) => {
      const gitObs = Array.from(ws.observations.values()).find((o) => o.category === 'git_state');
      if (!gitObs) {
        return { satisfied: false, confidence: 0.3, evidence: 'Git state not observed', needsInvestigation: true };
      }
      const value = gitObs.value as { isRepo?: boolean; clean?: boolean };
      if (!value.isRepo) {
        return { satisfied: false, confidence: 0.9, evidence: 'Not a git repository' };
      }
      return {
        satisfied: value.clean ?? false,
        confidence: 0.95,
        evidence: value.clean ? 'Working tree is clean' : `${gitObs.summary}`,
      };
    },
    generateIntents: (ws, goalId, rootDir) => {
      const gitObs = Array.from(ws.observations.values()).find((o) => o.category === 'git_state');
      if (!gitObs) {
        return [{
          intentId: randomUUID(), goalId, actor: 'heidi',
          category: 'DEVELOPMENT' as const, capability: 'dev.git_status',
          operation: 'git_status', target: rootDir, parameters: { cwd: rootDir },
          reason: 'Observe git state', expectedResult: 'Git status output',
        }];
      }
      return []; // Already observed — no action needed
    },
  },

  TESTS_PASS: {
    name: 'TESTS_PASS',
    description: 'All tests pass',
    riskLevel: 'R1',
    dependsOn: ['CODE_HEALTHY'],
    check: (ws) => {
      const testObs = Array.from(ws.observations.values()).find((o) => o.key === 'test_result:latest');
      if (!testObs) {
        return { satisfied: false, confidence: 0.3, evidence: 'Tests not yet run', needsInvestigation: true };
      }
      const value = testObs.value as { passed?: boolean };
      return {
        satisfied: value.passed ?? false,
        confidence: 0.9,
        evidence: testObs.summary,
      };
    },
    generateIntents: (_ws, goalId, rootDir) => [{
      intentId: randomUUID(), goalId, actor: 'heidi',
      category: 'DEVELOPMENT' as const, capability: 'dev.run_tests',
      operation: 'run_tests', target: rootDir,
      parameters: { cwd: rootDir, command: 'npm test' },
      reason: 'Run test suite to verify code health', expectedResult: 'All tests pass',
    }],
  },

  CONFIG_VALID: {
    name: 'CONFIG_VALID',
    description: 'Configuration is valid and complete',
    riskLevel: 'R1',
    check: (ws) => {
      const configObs = Array.from(ws.observations.values()).find((o) => o.key === 'config:valid');
      if (!configObs) {
        return { satisfied: false, confidence: 0.3, evidence: 'Configuration not checked', needsInvestigation: true };
      }
      return {
        satisfied: (configObs.value as { valid?: boolean }).valid ?? false,
        confidence: 0.9,
        evidence: configObs.summary,
      };
    },
    generateIntents: (_ws, goalId, rootDir) => [{
      intentId: randomUUID(), goalId, actor: 'heidi',
      category: 'SYSTEM' as const, capability: 'filesystem.read_file',
      operation: 'read', target: `${rootDir}/package.json`,
      parameters: {},
      reason: 'Check configuration file exists and is valid', expectedResult: 'Valid configuration',
    }],
  },

  CREDENTIALS_READY: {
    name: 'CREDENTIALS_READY',
    description: 'All required credentials are present and valid',
    riskLevel: 'R0',
    check: (ws) => {
      const credObs = Array.from(ws.observations.values()).find((o) => o.category === 'credential');
      if (!credObs) {
        return { satisfied: false, confidence: 0.3, evidence: 'Credentials not checked', needsInvestigation: true };
      }
      const value = credObs.value as { adapterAvailable?: boolean };
      return {
        satisfied: value.adapterAvailable ?? false,
        confidence: 0.8,
        evidence: credObs.summary,
      };
    },
    generateIntents: (_ws, goalId) => [{
      intentId: randomUUID(), goalId, actor: 'heidi',
      category: 'CREDENTIALS' as const, capability: 'credential.discover',
      operation: 'discover', target: 'environment', parameters: {},
      reason: 'Discover available credentials', expectedResult: 'Credential inventory',
    }],
  },

  SERVICES_RUNNING: {
    name: 'SERVICES_RUNNING',
    description: 'Required services are running',
    riskLevel: 'R0',
    check: (ws) => {
      const serviceObs = Array.from(ws.observations.values()).find((o) => o.category === 'service');
      if (!serviceObs) {
        return { satisfied: false, confidence: 0.3, evidence: 'Services not checked', needsInvestigation: true };
      }
      const value = serviceObs.value as { running?: boolean };
      return {
        satisfied: value.running ?? false,
        confidence: 0.85,
        evidence: serviceObs.summary,
      };
    },
    generateIntents: (ws, goalId, rootDir) => {
      // Check if ProtoForge is running
      const procObs = Array.from(ws.observations.values()).find((o) => o.key === 'process:node');
      if (procObs && (procObs.value as { exists?: boolean }).exists) {
        return []; // Already running
      }
      // Not running — generate an observation intent first
      return [{
        intentId: randomUUID(), goalId, actor: 'heidi',
        category: 'SYSTEM' as const, capability: 'process.inspect',
        operation: 'inspect', target: 'node', parameters: {},
        reason: 'Check if Node processes are running', expectedResult: 'Process inspection',
      }];
    },
  },

  DEPLOYMENT_READY: {
    name: 'DEPLOYMENT_READY',
    description: 'Deployment is ready',
    riskLevel: 'R4',
    dependsOn: ['TESTS_PASS', 'CODE_HEALTHY'],
    check: (ws) => {
      const deployObs = Array.from(ws.observations.values()).find((o) => o.key === 'deployment:ready');
      if (!deployObs) {
        return { satisfied: false, confidence: 0.3, evidence: 'Deployment not checked', needsInvestigation: true };
      }
      return {
        satisfied: (deployObs.value as { ready?: boolean }).ready ?? false,
        confidence: 0.85,
        evidence: deployObs.summary,
      };
    },
    generateIntents: (_ws, goalId, rootDir) => [{
      intentId: randomUUID(), goalId, actor: 'heidi',
      category: 'DEVELOPMENT' as const, capability: 'dev.build',
      operation: 'build', target: rootDir,
      parameters: { cwd: rootDir, command: 'npm run build' },
      reason: 'Build the project for deployment', expectedResult: 'Build succeeds',
    }],
  },

  ENDPOINT_VERIFIED: {
    name: 'ENDPOINT_VERIFIED',
    description: 'Service endpoint responds correctly',
    riskLevel: 'R0',
    dependsOn: ['SERVICES_RUNNING'],
    check: (ws) => {
      const healthObs = Array.from(ws.observations.values()).find((o) => o.category === 'health');
      if (!healthObs) {
        return { satisfied: false, confidence: 0.3, evidence: 'Endpoint not checked', needsInvestigation: true };
      }
      const value = healthObs.value as { reachable?: boolean; statusCode?: number };
      return {
        satisfied: value.reachable === true && (value.statusCode ?? 0) < 400,
        confidence: 0.9,
        evidence: healthObs.summary,
      };
    },
    generateIntents: (_ws, goalId, _rootDir, _registry, ctx?: unknown) => {
      // Use context as the health check URL if provided, otherwise default
      const target = (ctx as string) || 'http://localhost:3000/api/health';
      return [{
        intentId: randomUUID(), goalId, actor: 'heidi',
        category: 'INFRASTRUCTURE' as const, capability: 'infra.health_check',
        operation: 'health_check', target,
        parameters: {},
        reason: 'Check service health endpoint', expectedResult: 'Healthy response',
      }];
    },
  },

  DIRECTORY_EXISTS: {
    name: 'DIRECTORY_EXISTS',
    description: 'A required directory exists',
    riskLevel: 'R1',
    check: (ws: WorldState) => {
      const fileObs = Array.from(ws.observations.values()).find((o) => o.category === 'file' && (o.value as { isDirectory?: boolean }).isDirectory === true);
      if (!fileObs) {
        return { satisfied: false, confidence: 0.3, evidence: 'Directory not checked', needsInvestigation: true };
      }
      const value = fileObs.value as { exists?: boolean; isDirectory?: boolean };
      return {
        satisfied: value.exists === true && value.isDirectory === true,
        confidence: 1.0,
        evidence: fileObs.summary,
      };
    },
    generateIntents: (_ws: WorldState, goalId: string, rootDir: string) => [{
      intentId: randomUUID(), goalId, actor: 'heidi',
      category: 'SYSTEM' as const, capability: 'filesystem.create_directory',
      operation: 'create_directory', target: `${rootDir}/test-project`, parameters: {},
      reason: 'Create project directory', expectedResult: 'Directory exists',
    }],
  },

  FILE_DELETED: {
    name: 'FILE_DELETED',
    description: 'A file has been deleted',
    riskLevel: 'R3',
    check: (ws: WorldState) => {
      const actionResults = Array.from(ws.observations.values()).filter((o) => o.category === 'action_result');
      if (actionResults.length === 0) {
        return { satisfied: false, confidence: 0.3, evidence: 'No action taken yet', needsInvestigation: true };
      }
      return { satisfied: false, confidence: 0.5, evidence: 'Action pending verification', needsInvestigation: true };
    },
    generateIntents: (_ws: WorldState, goalId: string, _rootDir: string, _registry: ActionCapabilityRegistry, ctx?: unknown) => {
      const target = (ctx as string) || 'context-target';
      return [{
        intentId: randomUUID(), goalId, actor: 'heidi',
        category: 'SYSTEM' as const, capability: 'filesystem.delete_file',
        operation: 'delete', target, parameters: {},
        reason: 'Delete the specified file', expectedResult: 'File no longer exists',
      }];
    },
  },

  FILE_MODIFIED: {
    name: 'FILE_MODIFIED',
    description: 'A file has been modified',
    riskLevel: 'R2',
    check: (ws: WorldState) => {
      const actionResults = Array.from(ws.observations.values()).filter((o) => o.category === 'action_result');
      if (actionResults.length === 0) {
        return { satisfied: false, confidence: 0.3, evidence: 'No action taken yet', needsInvestigation: true };
      }
      return { satisfied: false, confidence: 0.5, evidence: 'Action pending verification', needsInvestigation: true };
    },
    generateIntents: (_ws: WorldState, goalId: string, _rootDir: string, _registry: ActionCapabilityRegistry, ctx?: unknown) => {
      const target = (ctx as string) || 'context-target';
      return [{
        intentId: randomUUID(), goalId, actor: 'heidi',
        category: 'SYSTEM' as const, capability: 'filesystem.write_file',
        operation: 'write', target, parameters: { content: 'modified' },
        reason: 'Modify the specified file', expectedResult: 'File content updated',
      }];
    },
  },

  BROWSER_NAVIGATED: {
    name: 'BROWSER_NAVIGATED',
    description: 'Browser has navigated to a target page',
    riskLevel: 'R1',
    check: (ws: WorldState) => {
      const browserObs = Array.from(ws.observations.values()).find((o) => o.category === 'browser_state');
      if (!browserObs) {
        return { satisfied: false, confidence: 0.3, evidence: 'Browser not yet navigated', needsInvestigation: true };
      }
      return { satisfied: true, confidence: 0.8, evidence: browserObs.summary };
    },
    generateIntents: (_ws: WorldState, goalId: string, _rootDir: string, _registry: ActionCapabilityRegistry, ctx?: unknown) => {
      const target = (ctx as string) || 'context-target';
      return [{
        intentId: randomUUID(), goalId, actor: 'heidi',
        category: 'BROWSER' as const, capability: 'browser.navigate',
        operation: 'navigate', target, parameters: {},
        reason: 'Navigate to the target page', expectedResult: 'Page loaded',
      }];
    },
  },

  // =====================================================================
  // REVENUE-ENGINE OBJECTIVES
  // =====================================================================
  // These objectives cover the actual revenue engine, not just infra
  // health-checks. They follow the same pattern as ENDPOINT_VERIFIED:
  //   - check() examines world state for a matching observation
  //   - generateIntents() produces HumanActionIntents that the engine
  //     will execute through real adapters (HTTP, etc.)
  //
  // IMPORTANT: Financial actions (Stripe payouts, transfers, refunds)
  // are R3+ (HIGH/CRITICAL) and require human authorization per
  // AutonomyContract. These templates generate READ-ONLY observation
  // intents only. Any actual financial operation will be blocked by
  // the AuthorityManager and escalated to a human.
  // =====================================================================

  REVENUE_LEDGER_VERIFIED: {
    name: 'REVENUE_LEDGER_VERIFIED',
    description: 'Revenue ledger has entries and all are provider-verified',
    riskLevel: 'R0',
    dependsOn: [],
    check: (ws) => {
      const revObs = Array.from(ws.observations.values()).find((o) => o.key === 'revenue:ledger_summary');
      if (!revObs) {
        return { satisfied: false, confidence: 0.3, evidence: 'Revenue ledger not yet queried', needsInvestigation: true };
      }
      const value = revObs.value as { entryCount?: number; verifiedCount?: number; unverifiedCount?: number };
      const total = value.entryCount ?? 0;
      const unverified = value.unverifiedCount ?? 0;
      return {
        satisfied: total > 0 && unverified === 0,
        confidence: 0.9,
        evidence: `${total} entries, ${unverified} unverified`,
        needsInvestigation: unverified > 0,
      };
    },
    generateIntents: (_ws, goalId, _rootDir, _registry, ctx?: unknown) => {
      // Query the local revenue API for a ledger summary.
      // ctx can be a date range string (e.g., "2026-08-01:2026-08-31")
      // or omitted for "latest".
      const target = (ctx as string) || 'http://localhost:3000/api/revenue?summary=true';
      return [{
        intentId: randomUUID(), goalId, actor: 'heidi',
        category: 'INFRASTRUCTURE' as const, capability: 'network.http_request',
        operation: 'http_get', target,
        parameters: { method: 'GET', headers: { 'Accept': 'application/json' } },
        reason: 'Query revenue ledger summary to verify entries are provider-backed',
        expectedResult: 'JSON with entryCount, verifiedCount, unverifiedCount',
      }];
    },
  },

  PAYOUTS_RECONCILED: {
    name: 'PAYOUTS_RECONCILED',
    description: 'Stripe payouts reconciled against revenue ledger entries',
    riskLevel: 'R0',
    dependsOn: ['REVENUE_LEDGER_VERIFIED'],
    check: (ws) => {
      const payoutObs = Array.from(ws.observations.values()).find((o) => o.key === 'revenue:payout_reconciliation');
      if (!payoutObs) {
        return { satisfied: false, confidence: 0.3, evidence: 'Payout reconciliation not yet checked', needsInvestigation: true };
      }
      const value = payoutObs.value as { matched?: number; unmatched?: number; pending?: number };
      const unmatched = value.unmatched ?? 0;
      const pending = value.pending ?? 0;
      return {
        satisfied: unmatched === 0 && pending === 0,
        confidence: 0.9,
        evidence: `matched: ${value.matched ?? 0}, unmatched: ${unmatched}, pending: ${pending}`,
        needsInvestigation: unmatched > 0 || pending > 0,
      };
    },
    generateIntents: (_ws, goalId, _rootDir, _registry, ctx?: unknown) => {
      // Query the local Stripe Connect webhook / payout status.
      // This is READ-ONLY — no payout is created or modified.
      const target = (ctx as string) || 'http://localhost:3000/api/stripe-connect-webhook?status=recent';
      return [{
        intentId: randomUUID(), goalId, actor: 'heidi',
        category: 'INFRASTRUCTURE' as const, capability: 'network.http_request',
        operation: 'http_get', target,
        parameters: { method: 'GET', headers: { 'Accept': 'application/json' } },
        reason: 'Query recent Stripe payout status for reconciliation',
        expectedResult: 'JSON with payout reconciliation summary',
      }];
    },
  },

  CONNECT_ACCOUNT_VERIFIED: {
    name: 'CONNECT_ACCOUNT_VERIFIED',
    description: 'Stripe Connect account is verified and ready to receive payouts',
    riskLevel: 'R0',
    dependsOn: [],
    check: (ws) => {
      const acctObs = Array.from(ws.observations.values()).find((o) => o.key === 'revenue:connect_account');
      if (!acctObs) {
        return { satisfied: false, confidence: 0.3, evidence: 'Connect account not yet checked', needsInvestigation: true };
      }
      const value = acctObs.value as { chargesEnabled?: boolean; payoutsEnabled?: boolean; detailsSubmitted?: boolean };
      return {
        satisfied: value.chargesEnabled === true && value.payoutsEnabled === true && value.detailsSubmitted === true,
        confidence: 0.95,
        evidence: `charges: ${value.chargesEnabled}, payouts: ${value.payoutsEnabled}, details: ${value.detailsSubmitted}`,
        needsInvestigation: !(value.chargesEnabled && value.payoutsEnabled && value.detailsSubmitted),
      };
    },
    generateIntents: (_ws, goalId, _rootDir, _registry, ctx?: unknown) => {
      // ctx is the Stripe Connect account ID (e.g., "acct_abc123")
      // If not provided, query the local API for the default/active account.
      const accountId = (ctx as string) || '';
      const target = accountId
        ? `http://localhost:3000/api/revenue?connect_account=${accountId}`
        : 'http://localhost:3000/api/revenue?connect_status=true';
      return [{
        intentId: randomUUID(), goalId, actor: 'heidi',
        category: 'INFRASTRUCTURE' as const, capability: 'network.http_request',
        operation: 'http_get', target,
        parameters: { method: 'GET', headers: { 'Accept': 'application/json' } },
        reason: 'Check Stripe Connect account verification status',
        expectedResult: 'JSON with chargesEnabled, payoutsEnabled, detailsSubmitted',
      }];
    },
  },
};

// ---------------------------------------------------------------------------
// Dynamic Planner
// ---------------------------------------------------------------------------

export class DynamicPlanner {
  constructor(
    private worldStateManager: WorldStateManager,
    private registry: ActionCapabilityRegistry,
    private rootDir: string,
    private taskMemory: TaskMemoryStore,
  ) {}

  /**
   * Verify whether an objective's check() is satisfied against the
   * current world state. Used by AdaptiveOperator after action execution
   * to confirm that a successful action actually achieved the objective's
   * verification condition — not just that the action returned without
   * throwing.
   *
   * Returns { satisfied, confidence, evidence } or null if the template
   * is not found.
   */
  verifyObjective(objectiveName: string): {
    satisfied: boolean;
    confidence: number;
    evidence: string;
    needsInvestigation?: boolean;
  } | null {
    const template = OBJECTIVE_TEMPLATES[objectiveName];
    if (!template) return null;
    const worldState = this.worldStateManager.getWorldState();
    return template.check(worldState);
  }

  /**
   * Generate a plan for a goal based on current world state.
   */
  plan(goal: GoalState, version: number = 1, replanReason?: string): AdaptivePlan {
    const worldState = this.worldStateManager.getWorldState();
    const observationIds = Array.from(worldState.observations.values()).map((o) => o.observationId);

    // Determine which objectives are needed based on the goal statement
    const objectiveNames = this.determineRequiredObjectives(goal);
    const planObjectives: PlanObjective[] = [];
    const assumptions: PlanAssumption[] = [];

    for (const objName of objectiveNames) {
      const template = OBJECTIVE_TEMPLATES[objName];
      if (!template) continue;

      // Check if the objective is already satisfied
      const checkResult = template.check(worldState);
      const status = checkResult.satisfied ? 'complete' : (checkResult.needsInvestigation ? 'in_progress' : 'pending');

      // Generate intents based on current observations
      const intents = checkResult.satisfied ? [] : template.generateIntents(worldState, goal.goalId, this.rootDir, this.registry, goal.context);

      // Record assumptions
      if (!checkResult.satisfied && !checkResult.needsInvestigation) {
        assumptions.push({
          assumptionId: randomUUID(),
          description: `Objective ${objName} is not satisfied: ${checkResult.evidence}`,
          basedOn: 'world_state',
          valid: true,
        });
      }

      planObjectives.push({
        objectiveId: randomUUID(),
        name: objName,
        description: template.description,
        status: status as 'pending' | 'in_progress' | 'complete',
        intents,
        dependsOn: template.dependsOn ?? [],
        expectedOutcome: template.description,
        verificationStrategy: 'state_check',
        riskLevel: template.riskLevel,
        retryCount: 0,
        maxRetries: 1,
      });
    }

    // Topological sort based on dependencies
    const executionOrder = this.topologicalSort(planObjectives);

    // Replace 'context-target' placeholders with the goal's context (if provided)
    if (goal.context) {
      for (const obj of planObjectives) {
        for (const intent of obj.intents) {
          if (intent.target === 'context-target') {
            intent.target = goal.context;
            // Also update parameters if they reference the target
            if (intent.parameters.path === 'context-target') {
              intent.parameters.path = goal.context;
            }
          }
        }
      }
    }

    return {
      planId: randomUUID(),
      goalId: goal.goalId,
      version,
      createdAt: new Date().toISOString(),
      objectives: planObjectives,
      executionOrder,
      basedOnObservationIds: observationIds,
      assumptions,
      replanReason,
    };
  }

  /**
   * Replan based on new observations or a deviation.
   */
  replan(goal: GoalState, currentPlan: AdaptivePlan, reason: string): AdaptivePlan {
    // Record the replan in task memory
    this.taskMemory.record(goal.goalId, 'replan', {
      reason,
      previousPlanVersion: currentPlan.version,
      timestamp: new Date().toISOString(),
    });

    // Carry over completed objectives
    const completedObjectives = new Set(
      currentPlan.objectives
        .filter((o) => o.status === 'complete')
        .map((o) => o.name),
    );

    // Generate new plan
    const newPlan = this.plan(goal, currentPlan.version + 1, reason);

    // Mark objectives that were already completed in the previous plan
    for (const obj of newPlan.objectives) {
      if (completedObjectives.has(obj.name)) {
        obj.status = 'complete';
        obj.intents = []; // No need to re-execute
        obj.completedAt = new Date().toISOString();
      }
    }

    // Check task memory for failed approaches
    const failedApproaches = this.taskMemory.getFailedApproaches(goal.goalId);
    for (const obj of newPlan.objectives) {
      for (const intent of obj.intents) {
        const approachKey = `${intent.capability}:${intent.target}`;
        const hasFailed = failedApproaches.some((e) => {
          const content = e.content as { description?: string };
          return content.description === approachKey;
        });
        if (hasFailed) {
          // Mark this intent as needing a different approach
          intent.reason = `[REPLAN] Previous approach failed: ${intent.reason}`;
        }
      }
    }

    return newPlan;
  }

  /**
   * Determine which objectives are required for a goal.
   */
  private determineRequiredObjectives(goal: GoalState): string[] {
    const statement = goal.statement.toLowerCase();

    // "production ready" / "prepare for production"
    if (statement.includes('production') || statement.includes('deploy') || statement.includes('ready')) {
      return ['CODE_HEALTHY', 'TESTS_PASS', 'CONFIG_VALID', 'CREDENTIALS_READY', 'SERVICES_RUNNING', 'DEPLOYMENT_READY', 'ENDPOINT_VERIFIED'];
    }

    // "create" / "project" / "directory"
    if (statement.includes('create') && (statement.includes('project') || statement.includes('directory'))) {
      return ['DIRECTORY_EXISTS', 'CODE_HEALTHY'];
    }

    // "delete" / "remove" / "destroy"
    if (statement.includes('delete') || statement.includes('remove') || statement.includes('destroy')) {
      return ['FILE_DELETED'];
    }

    // "fix" / "repair" / "recover" / "working"
    if (statement.includes('fix') || statement.includes('repair') || statement.includes('recover') || statement.includes('working')) {
      return ['SERVICES_RUNNING', 'ENDPOINT_VERIFIED', 'CREDENTIALS_READY'];
    }

    // "check" / "diagnose" / "inspect" / "why"
    if (statement.includes('check') || statement.includes('diagnose') || statement.includes('inspect') || statement.includes('why')) {
      return ['CODE_HEALTHY', 'SERVICES_RUNNING', 'ENDPOINT_VERIFIED', 'CREDENTIALS_READY'];
    }

    // "credential" / "configure" / "setup"
    if (statement.includes('credential') || statement.includes('configure') || statement.includes('setup')) {
      return ['CREDENTIALS_READY', 'CONFIG_VALID'];
    }

    // "navigate" / "browser" / "page"
    if (statement.includes('navigate') || statement.includes('browser') || statement.includes('page')) {
      return ['BROWSER_NAVIGATED'];
    }

    // "modify" / "write" / "update" / "change"
    if (statement.includes('modify') || statement.includes('write') || statement.includes('update') || statement.includes('change')) {
      return ['FILE_MODIFIED'];
    }

    // "health" / "service" / "port"
    if (statement.includes('health') || statement.includes('service') || statement.includes('port')) {
      return ['SERVICES_RUNNING', 'ENDPOINT_VERIFIED'];
    }

    // "reconcile" / "payout" / "stripe" / "ledger" — revenue reconciliation
    if (statement.includes('reconcile') || statement.includes('payout') || statement.includes('ledger')) {
      return ['REVENUE_LEDGER_VERIFIED', 'PAYOUTS_RECONCILED'];
    }

    // "connect account" / "onboard" / "connected account" — Stripe Connect
    if (statement.includes('connect account') || statement.includes('connected account') || statement.includes('onboard')) {
      return ['CONNECT_ACCOUNT_VERIFIED', 'REVENUE_LEDGER_VERIFIED'];
    }

    // "revenue" / "earnings" / "income" — general revenue health
    if (statement.includes('revenue') || statement.includes('earnings') || statement.includes('income')) {
      return ['REVENUE_LEDGER_VERIFIED', 'PAYOUTS_RECONCILED', 'CONNECT_ACCOUNT_VERIFIED'];
    }

    // Default: observe everything
    return ['CODE_HEALTHY', 'CREDENTIALS_READY', 'SERVICES_RUNNING', 'ENDPOINT_VERIFIED'];
  }

  /**
   * Topological sort of objectives based on dependencies.
   */
  private topologicalSort(objectives: PlanObjective[]): string[] {
    const byName = new Map(objectives.map((o) => [o.name, o]));
    const inDegree = new Map<string, number>();
    const adjacency = new Map<string, string[]>();

    for (const obj of objectives) {
      inDegree.set(obj.objectiveId, 0);
      adjacency.set(obj.objectiveId, []);
    }

    for (const obj of objectives) {
      for (const depName of obj.dependsOn) {
        const dep = byName.get(depName);
        if (dep) {
          adjacency.get(dep.objectiveId)?.push(obj.objectiveId);
          inDegree.set(obj.objectiveId, (inDegree.get(obj.objectiveId) ?? 0) + 1);
        }
      }
    }

    const queue: string[] = [];
    for (const [id, deg] of inDegree) {
      if (deg === 0) queue.push(id);
    }

    const result: string[] = [];
    while (queue.length > 0) {
      const current = queue.shift()!;
      result.push(current);
      for (const neighbor of adjacency.get(current) ?? []) {
        const deg = inDegree.get(neighbor) ?? 0;
        inDegree.set(neighbor, deg - 1);
        if (deg - 1 === 0) queue.push(neighbor);
      }
    }

    // Add any remaining (cycles or disconnected)
    for (const obj of objectives) {
      if (!result.includes(obj.objectiveId)) result.push(obj.objectiveId);
    }

    return result;
  }

  /**
   * Get the list of available objective templates.
   */
  getAvailableObjectives(): string[] {
    return Object.keys(OBJECTIVE_TEMPLATES);
  }
}
