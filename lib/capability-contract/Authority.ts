/**
 * Authority computation.
 *
 * Tier is derived, never declared. The inputs are:
 *
 *   verb  ×  target  ×  blast radius  ×  reversibility  ×  system state
 *
 * A static `riskLevel: 'R2'` on a descriptor is a lie the moment the same
 * capability is pointed at a different target, or invoked during an incident,
 * or invoked at 3am with nobody awake to answer an approval prompt.
 *
 * Every escalation is recorded as a named factor, so the resulting tier can
 * be explained to a human afterwards. An unexplainable denial is only
 * marginally better than an unexplainable action.
 */

import type { RiskLevel } from '../operational/types';
import type {
  AuthorityDecision,
  AuthorityFactor,
  CapabilityArgs,
  CapabilityContract,
  EffectVerb,
  SystemStateSnapshot,
} from './types';
import { maxTier, tierFromIndex, tierIndex } from './types';
import { assessBlastRadius, scopeIndex } from './BlastRadius';

// ---------------------------------------------------------------------------
// Base tiers
// ---------------------------------------------------------------------------

/** The floor a verb sits at before any context is applied. */
const VERB_BASE: Record<EffectVerb, RiskLevel> = {
  read: 'R0',
  create: 'R2',
  update: 'R2',
  restart: 'R2',
  delete: 'R3',
  deploy: 'R3',
  communicate: 'R3',
  actuate: 'R3',
  transact: 'R4',
};

/** How far a blast scope pushes the tier up from the verb floor. */
const SCOPE_ESCALATION: Record<string, number> = {
  none: 0,
  self: 0,
  single_resource: 0,
  subsystem: 1,
  system: 2,
  external: 2,
  irreversible_physical: 3,
};

/** Reversibility can pull a tier DOWN — but never below the verb floor's -1. */
const REVERSIBILITY_RELIEF: Record<string, number> = {
  inverse_capability: -1,
  snapshot_restore: -1,
  self_healing: -1,
  none: 1,
};

// ---------------------------------------------------------------------------
// Default authority function
// ---------------------------------------------------------------------------

export function computeAuthority(
  contract: CapabilityContract,
  args: CapabilityArgs,
  state: SystemStateSnapshot,
): AuthorityDecision {
  if (contract.authority) {
    const custom = contract.authority(args, state, contract);
    // A custom function may raise the tier but never lower it below the
    // generic assessment. Domain knowledge adds caution, it does not remove it.
    const generic = computeGenericAuthority(contract, args, state);
    const tier = maxTier(custom.tier, generic.tier);
    return {
      tier,
      factors: generic.factors.concat(custom.factors),
      rationale:
        tier === custom.tier
          ? custom.rationale
          : `${generic.rationale} (custom function proposed ${custom.tier}; generic floor applied)`,
      requiresApproval: tierIndex(tier) >= tierIndex('R3'),
    };
  }
  return computeGenericAuthority(contract, args, state);
}

function computeGenericAuthority(
  contract: CapabilityContract,
  args: CapabilityArgs,
  state: SystemStateSnapshot,
): AuthorityDecision {
  const factors: AuthorityFactor[] = [];

  // R5 means "categorically prohibited", not "very risky". Only an explicit
  // prohibition sets it — accumulated context escalation is clamped at R4
  // (explicit human authorization), because a bad afternoon must not silently
  // convert a permitted action into a forbidden one.
  let prohibited = false;

  // 1. Verb floor — the widest verb the capability declares.
  let base: RiskLevel = 'R0';
  for (const effect of contract.effects) {
    base = maxTier(base, VERB_BASE[effect.verb]);
  }
  factors.push({
    name: 'verb',
    value: contract.effects.map((e) => e.verb).join('+') || 'none',
    escalation: tierIndex(base),
  });

  let index = tierIndex(base);

  // 2. Blast radius.
  const blast = assessBlastRadius(contract, args, state);
  const scopeBump = SCOPE_ESCALATION[blast.scope] ?? 2;
  if (scopeBump > 0) {
    index += scopeBump;
    factors.push({ name: 'blast_radius', value: blast.scope, escalation: scopeBump });
  }
  if (blast.escapedTargets.length > 0) {
    // No additional bump: assessBlastRadius already widened the scope to
    // `system` for these, and counting it twice inflates every out-of-bounds
    // call straight to prohibited. Recorded as a factor because it is the
    // single most useful thing to see in an audit record.
    factors.push({
      name: 'target_escaped_bounds',
      value: blast.escapedTargets.map((t) => t.value).join(', '),
      escalation: 0,
    });
  }

  // 3. Reversibility.
  const relief = REVERSIBILITY_RELIEF[contract.reversibility.kind] ?? 1;
  if (relief !== 0 && scopeIndex(blast.scope) > 0) {
    // Relief only applies to something that actually has a blast radius.
    index += relief;
    factors.push({
      name: 'reversibility',
      value: contract.reversibility.kind,
      escalation: Math.max(0, relief),
    });
  }
  // Reversibility offsets blast radius; it does not demote a mutation to
  // advice. A capability that writes something is at least R2 (reversible
  // action) — R1 means "HYDI may only recommend this", which is the wrong
  // answer for a safe, undoable, in-bounds write.
  const mutates = contract.effects.some((e) => e.verb !== 'read');
  if (mutates && index < tierIndex('R2')) {
    index = tierIndex('R2');
    factors.push({
      name: 'mutation_floor',
      value: 'R2',
      escalation: 0,
    });
  }

  if (
    contract.reversibility.kind !== 'none' &&
    contract.reversibility.windowMs > 0 &&
    contract.reversibility.windowMs < 60_000
  ) {
    index += 1;
    factors.push({
      name: 'narrow_undo_window',
      value: `${contract.reversibility.windowMs}ms`,
      escalation: 1,
    });
  }

  // 4. Verification quality. A capability we cannot check is a capability we
  //    cannot trust to run unattended, regardless of how safe it looks.
  if (contract.verification.conditions.length === 0) {
    index = Math.max(index, tierIndex('R3'));
    factors.push({ name: 'no_verification_predicate', value: 'none', escalation: 1 });
  }
  if (contract.verification.requiresHumanConfirmation) {
    index = Math.max(index, tierIndex('R3'));
    factors.push({ name: 'human_confirmation_required', value: 'true', escalation: 1 });
  }

  // 5. System state.
  if (state.incidentActive) {
    index += 1;
    factors.push({ name: 'incident_active', value: 'true', escalation: 1 });
  }
  if (state.environment === 'production') {
    index += 1;
    factors.push({ name: 'environment', value: 'production', escalation: 1 });
  }
  if (!state.humanPresent && tierIndex(tierFromIndex(index)) >= tierIndex('R3')) {
    // Recorded, NOT escalated.
    //
    // This used to add a tier, on the reasoning that "an approval nobody can
    // grant is a stop, not a rubber stamp". That reasoning is right about the
    // outcome and wrong about the mechanism: being unattended does not make an
    // action more dangerous, it makes approval unavailable. The stop already
    // happens — `requiresApproval` is set for R3+, and authorizeAgainstDelegation
    // refuses when no human can answer. Adding a tier on top double-counts the
    // same fact and pushes ordinary work into R4.
    //
    // Advisory telemetry caught this: `goal.advance` (one row in heidi_goals)
    // was resolving to R4 in 15% of cycles, driven by this rule stacking on
    // `reversibility=none`. R4 means "highly sensitive, explicit human
    // authorization" — plainly wrong for an internal status write.
    factors.push({ name: 'unattended', value: 'no human present', escalation: 0 });
  }
  if (state.healthScore < 0.5) {
    index += 1;
    factors.push({
      name: 'degraded_system',
      value: `health=${state.healthScore.toFixed(2)}`,
      escalation: 1,
    });
  }

  // 6. Physical interlocks. Software watches; hardware stops.
  const physicalEffects = contract.effects.filter(
    (e) => e.resourceKind === 'physical_machine',
  );
  if (physicalEffects.length > 0) {
    const independent = contract.interlocks.filter((i) => i.mechanism !== 'software_only');
    if (independent.length === 0) {
      index = Math.max(index, tierIndex('R4'));
      factors.push({
        name: 'no_independent_interlock',
        value: 'physical effect with software-only safety',
        escalation: 1,
      });
    } else {
      const unarmed = independent.filter(
        (i) => state.armedInterlocks.indexOf(i.id) === -1,
      );
      if (unarmed.length > 0) {
        // An unarmed physical interlock is one of the few genuine
        // prohibitions: there is no authorization that makes it safe.
        prohibited = true;
        index = tierIndex('R5');
        factors.push({
          name: 'interlock_not_armed',
          value: unarmed.map((i) => i.id).join(', '),
          escalation: 1,
        });
      }
    }
  }

  if (!prohibited && index > tierIndex('R4')) {
    index = tierIndex('R4');
    factors.push({
      name: 'clamped_to_r4',
      value: 'context escalation cannot reach R5 (prohibited)',
      escalation: 0,
    });
  }

  let tier = tierFromIndex(index);

  // 7. The contract ceiling, applied last. maxTier is set at registration by
  //    ContractValidator and is a hard cap on how much authority a capability
  //    is ever allowed to claim.
  if (tierIndex(tier) > tierIndex(contract.maxTier) && contract.maxTier !== 'R5') {
    // The ceiling does NOT reduce a computed R5 (prohibited). A ceiling is a
    // limit on ambition, not a licence.
    if (tier !== 'R5') {
      tier = contract.maxTier;
      factors.push({ name: 'contract_ceiling', value: contract.maxTier, escalation: 0 });
    }
  }

  const rationale = buildRationale(contract, tier, blast, factors);

  return {
    tier,
    factors,
    rationale,
    requiresApproval: tierIndex(tier) >= tierIndex('R3'),
  };
}

function buildRationale(
  contract: CapabilityContract,
  tier: RiskLevel,
  blast: { scope: string; reasons: string[] },
  factors: AuthorityFactor[],
): string {
  const drivers = factors
    .filter((f) => f.escalation > 0 && f.name !== 'verb')
    .map((f) => `${f.name}=${f.value}`);

  const head = `${contract.identity.id} resolved to ${tier} (blast=${blast.scope}, undo=${contract.reversibility.kind})`;
  return drivers.length > 0 ? `${head}; driven by ${drivers.join(', ')}` : head;
}

// ---------------------------------------------------------------------------
// Standing delegation
// ---------------------------------------------------------------------------

export interface StandingDelegation {
  authorityId: string;
  delegatedBy: string;
  /** Highest tier that may run without a fresh human decision. */
  autonomousCeiling: RiskLevel;
  /** Capability ids explicitly excluded regardless of tier. */
  excludedCapabilities: string[];
  expiresAt: string | null;
}

export interface AuthorizationOutcome {
  allowed: boolean;
  decision: AuthorityDecision;
  /** Set when the action is permitted but a human must say yes first. */
  approvalRequired: boolean;
  reason: string;
}

export function authorizeAgainstDelegation(
  decision: AuthorityDecision,
  contract: CapabilityContract,
  delegation: StandingDelegation | null,
  now: Date = new Date(),
): AuthorizationOutcome {
  if (decision.tier === 'R5') {
    return {
      allowed: false,
      decision,
      approvalRequired: false,
      reason: `${contract.identity.id} resolved to R5 (prohibited). No delegation can authorize it.`,
    };
  }

  if (!delegation) {
    return {
      allowed: tierIndex(decision.tier) <= tierIndex('R1'),
      decision,
      approvalRequired: tierIndex(decision.tier) > tierIndex('R1'),
      reason:
        tierIndex(decision.tier) <= tierIndex('R1')
          ? 'No delegation, but tier is observe/recommend only.'
          : 'No standing delegation — human authorization required.',
    };
  }

  if (delegation.expiresAt && new Date(delegation.expiresAt).getTime() < now.getTime()) {
    return {
      allowed: false,
      decision,
      approvalRequired: true,
      reason: `Delegation ${delegation.authorityId} expired at ${delegation.expiresAt}.`,
    };
  }

  if (delegation.excludedCapabilities.indexOf(contract.identity.id) !== -1) {
    return {
      allowed: false,
      decision,
      approvalRequired: true,
      reason: `${contract.identity.id} is explicitly excluded from delegation ${delegation.authorityId}.`,
    };
  }

  const withinCeiling =
    tierIndex(decision.tier) <= tierIndex(delegation.autonomousCeiling);

  return {
    allowed: withinCeiling,
    decision,
    approvalRequired: !withinCeiling,
    reason: withinCeiling
      ? `${decision.tier} is within the delegated ceiling ${delegation.autonomousCeiling}.`
      : `${decision.tier} exceeds the delegated ceiling ${delegation.autonomousCeiling} — approval required.`,
  };
}
