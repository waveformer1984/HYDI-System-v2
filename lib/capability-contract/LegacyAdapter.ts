/**
 * Migration adapter: legacy descriptor → capability contract.
 *
 * The 42 descriptors in lib/heidi/CapabilityRegistry carry roughly a third of
 * a contract: an id, a static riskLevel, a `reversible` boolean, a timeout,
 * and a verification strategy written in English.
 *
 * This adapter lifts them mechanically so the whole registry can move at once
 * — and, importantly, so the MISSING information shows up as validation
 * errors rather than as silence. A lifted contract fails validation until a
 * human writes its verification predicate. That is the intended behaviour:
 * the migration surfaces the debt instead of hiding it behind a boolean.
 *
 * Nothing here guesses. Where the legacy descriptor is silent, the lifted
 * contract is conservative:
 *   - prose verification strategy → NO conditions (capped at R1)
 *   - `reversible: true`          → snapshot_restore with an explicit caveat
 *   - unknown effects             → derived from the id's verb, bounded to
 *                                   nothing, which reads as system scope
 */

import type {
  CapabilityContract,
  EffectSpec,
  EffectVerb,
  ResourceKind,
} from './types';

/** Structural shape of the legacy descriptor — deliberately not imported, to
 *  avoid coupling the new package to the old one during migration. */
export interface LegacyCapabilityDescriptor {
  capabilityId: string;
  capabilityName: string;
  description: string;
  provider: string;
  riskLevel: string;
  autonomyRequirement: number;
  dependencies: string[];
  verificationStrategy: string;
  reversible: boolean;
  timeoutMs: number;
  metadata: Record<string, unknown>;
}

const VERB_BY_PREFIX: Array<{ match: RegExp; verb: EffectVerb; kind: ResourceKind }> = [
  { match: /\.(get|list|query|read|check|fetch|observe|score|collect|diagnose)/, verb: 'read', kind: 'any' },
  { match: /\.(create|start|identify|ingest|prepare)/, verb: 'create', kind: 'database' },
  { match: /\.(update|advance|complete|activate|sync|resolve)/, verb: 'update', kind: 'database' },
  { match: /\.(delete|remove|purge)/, verb: 'delete', kind: 'database' },
  { match: /\.(restart|recover|repair|run_cycle)/, verb: 'restart', kind: 'service' },
  { match: /\.(send|notify|outreach|email|message)/, verb: 'communicate', kind: 'external_party' },
  { match: /\.(deploy|release|publish)/, verb: 'deploy', kind: 'service' },
  { match: /(pay|charge|invoice|payout|transact)/, verb: 'transact', kind: 'money' },
];

function inferEffect(descriptor: LegacyCapabilityDescriptor): EffectSpec {
  for (const rule of VERB_BY_PREFIX) {
    if (rule.match.test(descriptor.capabilityId)) {
      return {
        verb: rule.verb,
        resourceKind: rule.kind,
        // Deliberately empty. An inferred effect has no verified bounds, and
        // pretending otherwise is how a migration launders risk.
        resourcePatterns: [],
        worstCaseScope: rule.verb === 'read' ? 'none' : 'subsystem',
        crossesTrustBoundary: rule.verb === 'communicate' || rule.verb === 'transact',
      };
    }
  }
  return {
    verb: 'update',
    resourceKind: 'any',
    resourcePatterns: [],
    worstCaseScope: 'subsystem',
    crossesTrustBoundary: false,
  };
}

export interface LiftOptions {
  /** Owner assigned to every lifted contract until a human claims it. */
  defaultOwner?: string;
}

export function liftLegacyDescriptor(
  descriptor: LegacyCapabilityDescriptor,
  options: LiftOptions = {},
): CapabilityContract {
  const effect = inferEffect(descriptor);
  const readOnly = effect.verb === 'read';

  return {
    identity: {
      id: descriptor.capabilityId,
      version: '0.1.0',
      owner: options.defaultOwner ?? 'unassigned',
      provider: descriptor.provider,
      description: descriptor.description || descriptor.capabilityName,
    },
    signature: {
      // The legacy registry passes Record<string, unknown> with no schema, so
      // there is nothing honest to lift here.
      params: [],
      returns: 'unspecified (lifted from legacy descriptor)',
    },
    preconditions: [],
    effects: [effect],
    reversibility: descriptor.reversible
      ? {
          kind: 'snapshot_restore',
          windowMs: Number.POSITIVE_INFINITY,
          caveat:
            'Lifted from a legacy `reversible: true` boolean. The undo mechanism was ' +
            'never specified — treat as unproven until an inverse capability is named.',
        }
      : {
          kind: 'none',
          windowMs: 0,
          caveat: 'Lifted from a legacy `reversible: false` boolean.',
        },
    cost: {
      estimatedMs: Math.min(descriptor.timeoutMs, Math.round(descriptor.timeoutMs / 2)),
      timeoutMs: descriptor.timeoutMs > 0 ? descriptor.timeoutMs : 30_000,
      estimatedCostCents: 0,
      materials: {},
      wearFraction: 0,
    },
    verification: {
      // The legacy strategy is prose. It is preserved as the description so
      // whoever writes the predicate can see what was intended, but it
      // contributes NO conditions — which caps the capability at R1 until
      // someone does the work.
      description: descriptor.verificationStrategy || 'unspecified',
      observation: { source: 'none', target: '', extractFields: [], settleMs: 0 },
      conditions: [],
      onFailure: 'escalate',
      maxRetries: 1,
      requiresHumanConfirmation: false,
    },
    observability: {
      eventType: `capability.${descriptor.capabilityId}`,
      redactParams: [],
      metrics: [],
    },
    simulation: {
      supported: false,
      unsupportedReason:
        'Lifted from a legacy descriptor; no dry-run path was ever implemented.',
    },
    interlocks: [],
    maxTier: readOnly ? 'R1' : 'R5',
    dependencies: descriptor.dependencies,
    metadata: {
      ...descriptor.metadata,
      liftedFrom: 'lib/heidi/CapabilityRegistry',
      legacyRiskLevel: descriptor.riskLevel,
      legacyAutonomyRequirement: descriptor.autonomyRequirement,
    },
  };
}

export interface MigrationReport {
  total: number;
  lifted: number;
  /** Capabilities that will be capped at R1 until a predicate is written. */
  needsVerificationPredicate: string[];
  /** Capabilities whose legacy risk level was LOWER than the derived tier. */
  underratedByLegacy: Array<{ capabilityId: string; legacy: string; derived: string }>;
  /** Capabilities claiming reversibility with no named inverse. */
  unprovenReversibility: string[];
}

/**
 * Lift a whole legacy set and report what the migration exposed.
 *
 * `deriveTier` is injected rather than imported so this can be run against a
 * chosen state snapshot — the interesting comparison is against a worst-case
 * state, which is where legacy static levels turn out to be optimistic.
 */
export function liftAll(
  descriptors: LegacyCapabilityDescriptor[],
  deriveTier: (contract: CapabilityContract) => string,
  options: LiftOptions = {},
): { contracts: CapabilityContract[]; report: MigrationReport } {
  const contracts: CapabilityContract[] = [];
  const needsVerificationPredicate: string[] = [];
  const underratedByLegacy: MigrationReport['underratedByLegacy'] = [];
  const unprovenReversibility: string[] = [];

  for (const descriptor of descriptors) {
    const contract = liftLegacyDescriptor(descriptor, options);
    contracts.push(contract);

    if (contract.verification.conditions.length === 0) {
      needsVerificationPredicate.push(contract.identity.id);
    }
    if (contract.reversibility.kind === 'snapshot_restore') {
      unprovenReversibility.push(contract.identity.id);
    }

    const derived = deriveTier(contract);
    if (rank(derived) > rank(descriptor.riskLevel)) {
      underratedByLegacy.push({
        capabilityId: contract.identity.id,
        legacy: descriptor.riskLevel,
        derived,
      });
    }
  }

  return {
    contracts,
    report: {
      total: descriptors.length,
      lifted: contracts.length,
      needsVerificationPredicate,
      underratedByLegacy,
      unprovenReversibility,
    },
  };
}

function rank(tier: string): number {
  const i = ['R0', 'R1', 'R2', 'R3', 'R4', 'R5'].indexOf(tier);
  return i < 0 ? 5 : i;
}
