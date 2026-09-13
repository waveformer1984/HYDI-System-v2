/**
 * HYDI Human Action Bridge
 *
 * Integrates the HumanActionEngine into the existing CognitiveCore
 * ExecutionBridge. This allows CognitiveCore to invoke human actions
 * through the same governed-autonomy pipeline.
 *
 * This does NOT create a competing architecture — it extends the existing
 * ExecutionBridge with a new `humanActionEngine` slot.
 */

import type { HumanActionEngine } from './HumanActionEngine';
import type { GoalDecomposer } from './GoalDecomposer';
import type {
  HumanGoal,
  HumanActionResult,
  HumanActionIntent,
  ActionGraph,
  HumanInterventionRequest,
} from './HumanActionTypes';

// ---------------------------------------------------------------------------
// Bridge interface — extends the existing ExecutionBridge concept
// ---------------------------------------------------------------------------

export interface HumanActionBridge {
  /**
   * Register a goal from natural language.
   */
  registerGoal: (statement: string, statedBy: string, context?: string) => HumanGoal;

  /**
   * Decompose a goal into an action graph.
   */
  decomposeGoal: (goalId: string, context?: { rootDir?: string; targetUrl?: string; targetService?: string }) => ActionGraph;

  /**
   * Execute a single action intent.
   */
  executeAction: (intent: HumanActionIntent, authorityId?: string, options?: { dryRun?: boolean }) => Promise<HumanActionResult>;

  /**
   * Execute all actions in a goal's action graph.
   */
  executeGoal: (goalId: string, authorityId?: string, options?: { dryRun?: boolean }) => Promise<HumanActionResult[]>;

  /**
   * Answer "What can you do?"
   */
  describeCapabilities: () => ReturnType<HumanActionEngine['describeCapabilities']>;

  /**
   * Get pending human intervention requests.
   */
  getPendingInterventions: () => HumanInterventionRequest[];

  /**
   * Resume an action after human intervention.
   */
  resumeAction: (actionId: string, authorityId?: string) => Promise<HumanActionResult | null>;

  /**
   * Get the action journal entries for a goal.
   */
  getGoalJournal: (goalId: string) => unknown[];

  /**
   * Get recent journal entries.
   */
  getRecentJournal: (count?: number) => unknown[];
}

// ---------------------------------------------------------------------------
// Bridge factory
// ---------------------------------------------------------------------------

export function createHumanActionBridge(
  engine: HumanActionEngine,
  decomposer: GoalDecomposer,
  rootDir: string,
): HumanActionBridge {
  const pendingInterventions: HumanInterventionRequest[] = [];

  // Set up intervention capture
  engine['onHumanInterventionFn'] = (req: HumanInterventionRequest) => {
    pendingInterventions.push(req);
  };

  return {
    registerGoal: (statement, statedBy, context) => {
      return engine.registerGoal(statement, statedBy, context);
    },

    decomposeGoal: (goalId, context) => {
      const goal = engine.getGoal(goalId);
      if (!goal) {
        throw new Error(`Goal ${goalId} not found`);
      }
      const graph = decomposer.decompose(goal, {
        rootDir: context?.rootDir ?? rootDir,
        targetUrl: context?.targetUrl,
        targetService: context?.targetService,
      });
      engine.setGoalActionGraph(goalId, graph);
      return graph;
    },

    executeAction: (intent, authorityId, options) => {
      return engine.executeAction(intent, authorityId, options);
    },

    executeGoal: async (goalId, authorityId, options) => {
      const goal = engine.getGoal(goalId);
      if (!goal) {
        throw new Error(`Goal ${goalId} not found`);
      }
      if (!goal.actionGraph) {
        throw new Error(`Goal ${goalId} has no action graph — decompose first`);
      }
      engine.updateGoalState(goalId, 'executing');
      const results = await engine.executeActionGraph(goal.actionGraph, authorityId, options);

      // Update goal state based on results
      const allVerified = results.every((r) => r.verified);
      const anyFailed = results.some((r) => r.outcome === 'failure');
      const anyBlocked = results.some((r) => r.outcome === 'blocked' || r.outcome === 'pending_human');

      if (allVerified) {
        engine.updateGoalState(goalId, 'completed', `All ${results.length} actions completed successfully`);
      } else if (anyBlocked && !anyFailed) {
        engine.updateGoalState(goalId, 'blocked', 'Some actions are blocked or require human intervention');
      } else if (anyFailed) {
        engine.updateGoalState(goalId, 'failed', 'Some actions failed');
      }

      return results;
    },

    describeCapabilities: () => {
      return engine.describeCapabilities();
    },

    getPendingInterventions: () => {
      return [...pendingInterventions];
    },

    resumeAction: (actionId, authorityId) => {
      // Remove from pending if it was there
      const idx = pendingInterventions.findIndex((i) => i.actionId === actionId);
      if (idx >= 0) {
        pendingInterventions.splice(idx, 1);
      }
      return engine.resumeAction(actionId, authorityId);
    },

    getGoalJournal: (goalId) => {
      return engine.getJournalEntriesForGoal(goalId);
    },

    getRecentJournal: (count) => {
      return engine.getRecentJournalEntries(count);
    },
  };
}
