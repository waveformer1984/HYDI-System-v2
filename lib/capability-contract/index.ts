/**
 * HYDI Capability Contract layer.
 *
 * The composability property, stated once:
 *
 *   Any capability HEIDI possesses is discoverable, permissioned, composable
 *   with other capabilities, observable, reversible where possible, and
 *   independently verifiable.
 *
 * Everything in this package exists to make that a schema property rather
 * than an aspiration. See types.ts for the contract itself.
 */

export * from './types';
export * from './BlastRadius';
export * from './Authority';
export * from './Verification';
export * from './ContractValidator';
export * from './ContractRegistry';
export * from './Simulation';
export * from './CommitGate';
export * from './RepairPlaybook';
export * from './SafetyInterlock';
export * from './DecisionRecorder';
export * from './LegacyAdapter';
export * from './CausalCorrelator';
export * from './contracts/reference';

import type {
  CapabilityContract,
  CapabilityIdentity,
  CostSpec,
  EffectSpec,
  ObservabilitySpec,
  Reversibility,
  SimulationSpec,
  SystemStateSnapshot,
  VerificationSpec,
} from './types';

/**
 * Build a contract with conservative defaults.
 *
 * The defaults are deliberately unhelpful in exactly one direction: a
 * contract you do not finish writing is capped at R1 rather than assumed
 * safe. Defaults that fail closed are the only defaults worth having in a
 * governance layer.
 */
export function defineContract(input: {
  identity: CapabilityIdentity;
  effects: EffectSpec[];
  verification?: Partial<VerificationSpec>;
  reversibility?: Partial<Reversibility>;
  cost?: Partial<CostSpec>;
  observability?: Partial<ObservabilitySpec>;
  simulation?: Partial<SimulationSpec>;
  contract?: Partial<Omit<CapabilityContract, 'identity' | 'effects'>>;
}): CapabilityContract {
  const verification: VerificationSpec = {
    description: 'unspecified',
    observation: { source: 'none', target: '', extractFields: [], settleMs: 0 },
    conditions: [],
    onFailure: 'escalate',
    maxRetries: 1,
    requiresHumanConfirmation: false,
    ...input.verification,
  };

  const reversibility: Reversibility = {
    kind: 'none',
    windowMs: 0,
    caveat: 'unspecified',
    ...input.reversibility,
  };

  const cost: CostSpec = {
    estimatedMs: 1_000,
    timeoutMs: 30_000,
    estimatedCostCents: 0,
    materials: {},
    wearFraction: 0,
    ...input.cost,
  };

  const observability: ObservabilitySpec = {
    eventType: `capability.${input.identity.id}`,
    redactParams: [],
    metrics: [],
    ...input.observability,
  };

  const simulation: SimulationSpec = {
    supported: false,
    unsupportedReason: 'No dry-run path implemented.',
    ...input.simulation,
  };

  return {
    identity: input.identity,
    signature: { params: [], returns: 'unspecified' },
    preconditions: [],
    effects: input.effects,
    reversibility,
    cost,
    verification,
    observability,
    simulation,
    interlocks: [],
    maxTier: 'R5',
    dependencies: [],
    metadata: {},
    ...input.contract,
  };
}

/**
 * A neutral state snapshot for tests and for the "what would this cost me
 * right now?" question when nothing is known about the environment.
 */
export function defaultState(overrides: Partial<SystemStateSnapshot> = {}): SystemStateSnapshot {
  return {
    at: new Date().toISOString(),
    environment: 'development',
    humanPresent: true,
    healthScore: 1,
    degradedComponents: [],
    incidentActive: false,
    armedInterlocks: [],
    extra: {},
    ...overrides,
  };
}
