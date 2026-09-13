/**
 * Simulation and cost.
 *
 * "Test actions before executing them" is only meaningful if the planner can
 * tell the difference between a capability that was dry-run and one that
 * merely declined to be. So `supported: false` must carry a reason, and a
 * simulation that cannot run is reported as such rather than as a pass.
 *
 * Cost matters for the same reason blast radius does: it is how the planner
 * compares a 6-hour, 84-gram, irreversible print against `npm test`, without
 * knowing what either of them is.
 */

import type {
  CapabilityArgs,
  CapabilityContract,
  CostSpec,
  SimulationOutcome,
  SystemStateSnapshot,
} from './types';

export type SimulationStatus = 'simulated' | 'unsupported' | 'error';

export interface SimulationReport {
  status: SimulationStatus;
  capabilityId: string;
  outcome: SimulationOutcome | null;
  reason: string;
}

export async function simulate(
  contract: CapabilityContract,
  args: CapabilityArgs,
  state: SystemStateSnapshot,
): Promise<SimulationReport> {
  if (!contract.simulation.supported || !contract.simulation.dryRun) {
    return {
      status: 'unsupported',
      capabilityId: contract.identity.id,
      outcome: null,
      reason:
        contract.simulation.unsupportedReason ||
        'Simulation unsupported and no reason declared.',
    };
  }

  try {
    const outcome = await contract.simulation.dryRun(args, state);
    return {
      status: 'simulated',
      capabilityId: contract.identity.id,
      outcome,
      reason: outcome.wouldSucceed
        ? `Dry run predicts success: ${outcome.predictedEffects.join('; ')}`
        : `Dry run predicts failure: ${outcome.warnings.join('; ')}`,
    };
  } catch (err) {
    return {
      status: 'error',
      capabilityId: contract.identity.id,
      outcome: null,
      reason: `Dry run threw: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// ---------------------------------------------------------------------------
// Cost
// ---------------------------------------------------------------------------

export function zeroCost(): CostSpec {
  return {
    estimatedMs: 0,
    timeoutMs: 0,
    estimatedCostCents: 0,
    materials: {},
    wearFraction: 0,
  };
}

export function addCost(a: CostSpec, b: CostSpec): CostSpec {
  const materials: Record<string, number> = { ...a.materials };
  for (const key of Object.keys(b.materials)) {
    materials[key] = (materials[key] ?? 0) + b.materials[key];
  }
  return {
    estimatedMs: a.estimatedMs + b.estimatedMs,
    timeoutMs: a.timeoutMs + b.timeoutMs,
    estimatedCostCents: a.estimatedCostCents + b.estimatedCostCents,
    materials,
    wearFraction: a.wearFraction + b.wearFraction,
  };
}

export function aggregateCost(costs: CostSpec[]): CostSpec {
  return costs.reduce(addCost, zeroCost());
}

export interface CostBudget {
  maxDurationMs: number;
  maxCostCents: number;
  maxWearFraction: number;
  /** Per-material caps, e.g. { grams: 500 }. Absent keys are unlimited. */
  maxMaterials: Record<string, number>;
}

export interface BudgetVerdict {
  withinBudget: boolean;
  violations: string[];
}

/**
 * A budget is a second, independent brake on autonomy. Authority asks "may
 * I?"; the budget asks "can we afford to be wrong about this many times?"
 */
export function checkBudget(cost: CostSpec, budget: CostBudget): BudgetVerdict {
  const violations: string[] = [];

  if (cost.estimatedMs > budget.maxDurationMs) {
    violations.push(
      `duration ${cost.estimatedMs}ms exceeds budget ${budget.maxDurationMs}ms`,
    );
  }
  if (cost.estimatedCostCents > budget.maxCostCents) {
    violations.push(
      `cost ${cost.estimatedCostCents}c exceeds budget ${budget.maxCostCents}c`,
    );
  }
  if (cost.wearFraction > budget.maxWearFraction) {
    violations.push(
      `wear ${cost.wearFraction.toFixed(3)} exceeds budget ${budget.maxWearFraction}`,
    );
  }
  for (const key of Object.keys(budget.maxMaterials)) {
    const used = cost.materials[key] ?? 0;
    if (used > budget.maxMaterials[key]) {
      violations.push(`${key} ${used} exceeds budget ${budget.maxMaterials[key]}`);
    }
  }

  return { withinBudget: violations.length === 0, violations };
}
