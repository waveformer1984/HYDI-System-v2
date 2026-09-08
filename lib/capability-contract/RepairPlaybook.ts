/**
 * Bounded self-repair — whitelist PLANS, not primitives.
 *
 * The failure mode this exists to prevent:
 *
 *   `restart_service` is R2. `edit_config` is R2. Both are whitelisted for
 *   autonomous repair. HYDI edits a config and restarts the service, and has
 *   just performed an unreviewed deployment at R2 authority.
 *
 * Composition escapes the boundary. Two safe steps in sequence are not a safe
 * sequence. So the unit of authorization for self-repair is the PLAYBOOK: a
 * named, pre-approved sequence with a stated trigger, a stated expected
 * outcome, and a stated abort condition. HYDI may run playbooks. It may not
 * improvise sequences out of individually-permitted primitives.
 *
 * The composed tier is deliberately harsher than max(steps): a sequence that
 * mutates more than one subsystem escalates, and an unbounded loop escalates
 * again.
 */

import type { RiskLevel } from '../operational/types';
import type {
  CapabilityArgs,
  CapabilityContract,
  SystemStateSnapshot,
} from './types';
import { maxTier, tierFromIndex, tierIndex } from './types';
import { computeAuthority } from './Authority';
import { assessBlastRadius } from './BlastRadius';

export interface PlaybookStep {
  capabilityId: string;
  /** Static args, merged with runtime args supplied by the trigger. */
  args: CapabilityArgs;
  description: string;
  /** Abort the whole playbook when this step fails, vs. continue. */
  abortOnFailure: boolean;
}

export interface RepairPlaybook {
  id: string;
  version: string;
  owner: string;
  description: string;
  /** The symptom this playbook responds to. */
  trigger: string;
  steps: PlaybookStep[];
  /** What must be true afterwards for the repair to count as successful. */
  expectedOutcome: string;
  /** Conditions under which HYDI must stop and escalate rather than continue. */
  abortConditions: string[];
  /** Maximum times this playbook may run within the window before escalating. */
  maxAttempts: number;
  attemptWindowMs: number;
  /** Set by the registry at registration. */
  composedTier?: RiskLevel;
}

export interface PlaybookAssessment {
  playbookId: string;
  composedTier: RiskLevel;
  stepTiers: Array<{ capabilityId: string; tier: RiskLevel }>;
  /** Distinct subsystems the plan touches. */
  subsystemsTouched: string[];
  escalations: string[];
  /** Steps naming capabilities that are not registered. */
  unresolvedSteps: string[];
}

export interface PlaybookRegistryOptions {
  lookup: (capabilityId: string) => CapabilityContract | null;
}

export class RepairPlaybookRegistry {
  private readonly playbooks = new Map<string, RepairPlaybook>();
  private readonly attempts = new Map<string, number[]>();
  private readonly lookup: PlaybookRegistryOptions['lookup'];

  constructor(options: PlaybookRegistryOptions) {
    this.lookup = options.lookup;
  }

  /**
   * Register a playbook. The composed tier is computed here, once, against a
   * worst-case state — so a playbook cannot be registered as "safe" by being
   * assessed on a quiet afternoon.
   */
  register(playbook: RepairPlaybook): PlaybookAssessment {
    const assessment = this.assess(playbook, worstCaseState());
    this.playbooks.set(playbook.id, { ...playbook, composedTier: assessment.composedTier });
    return assessment;
  }

  get(id: string): RepairPlaybook | null {
    return this.playbooks.get(id) ?? null;
  }

  list(): RepairPlaybook[] {
    return Array.from(this.playbooks.values());
  }

  /**
   * Compute the authority tier of the SEQUENCE, not the steps.
   */
  assess(playbook: RepairPlaybook, state: SystemStateSnapshot): PlaybookAssessment {
    const stepTiers: Array<{ capabilityId: string; tier: RiskLevel }> = [];
    const subsystems = new Set<string>();
    const escalations: string[] = [];
    const unresolvedSteps: string[] = [];

    let tier: RiskLevel = 'R0';
    let mutatingSteps = 0;

    for (const step of playbook.steps) {
      const contract = this.lookup(step.capabilityId);
      if (!contract) {
        unresolvedSteps.push(step.capabilityId);
        continue;
      }

      const decision = computeAuthority(contract, step.args, state);
      stepTiers.push({ capabilityId: step.capabilityId, tier: decision.tier });
      tier = maxTier(tier, decision.tier);

      const blast = assessBlastRadius(contract, step.args, state);
      for (const target of blast.targets) {
        subsystems.add(subsystemOf(target.value));
      }
      if (contract.effects.some((e) => e.verb !== 'read')) {
        mutatingSteps++;
        subsystems.add(contract.identity.provider);
      }
    }

    // An unresolved step is not a step we can bound.
    if (unresolvedSteps.length > 0) {
      tier = 'R5';
      escalations.push(
        `unregistered capabilities in plan: ${unresolvedSteps.join(', ')} — cannot bound the sequence`,
      );
    }

    let index = tierIndex(tier);

    // Composition across subsystems. This is the config-edit-then-restart case.
    if (subsystems.size > 1 && mutatingSteps > 1) {
      index += 1;
      escalations.push(
        `sequence mutates ${mutatingSteps} steps across ${subsystems.size} subsystems ` +
          `(${Array.from(subsystems).join(', ')}) — composition escalation`,
      );
    }

    // Long plans are harder to reason about and harder to abort cleanly.
    if (playbook.steps.length > 5) {
      index += 1;
      escalations.push(`${playbook.steps.length}-step plan exceeds the 5-step review threshold`);
    }

    // A plan with no abort conditions cannot be stopped on evidence.
    if (playbook.abortConditions.length === 0) {
      index += 1;
      escalations.push('no abort conditions declared — the plan cannot be stopped on evidence');
    }

    // A plan that never gives up is a plan that can loop through a failure.
    if (playbook.maxAttempts <= 0 || !Number.isFinite(playbook.maxAttempts)) {
      index = tierIndex('R5');
      escalations.push('maxAttempts is unbounded — a repair loop with no exit is prohibited');
    }

    if (!playbook.expectedOutcome.trim()) {
      index += 1;
      escalations.push('no expected outcome declared — success would be unverifiable');
    }

    return {
      playbookId: playbook.id,
      composedTier: tierFromIndex(index),
      stepTiers,
      subsystemsTouched: Array.from(subsystems),
      escalations,
      unresolvedSteps,
    };
  }

  /**
   * Rate limiting. A playbook that keeps firing is not repairing anything —
   * it is masking a fault that needs a human.
   */
  canAttempt(playbookId: string, now: number = Date.now()): { allowed: boolean; reason: string } {
    const playbook = this.playbooks.get(playbookId);
    if (!playbook) {
      return { allowed: false, reason: `Unknown playbook "${playbookId}".` };
    }
    const window = this.attempts.get(playbookId) ?? [];
    const recent = window.filter((t) => now - t < playbook.attemptWindowMs);
    if (recent.length >= playbook.maxAttempts) {
      return {
        allowed: false,
        reason:
          `${playbookId} has run ${recent.length} time(s) in the last ` +
          `${Math.round(playbook.attemptWindowMs / 1000)}s (limit ${playbook.maxAttempts}). ` +
          'Repeated repair is a symptom, not a fix — escalating to a human.',
      };
    }
    return { allowed: true, reason: `${recent.length}/${playbook.maxAttempts} attempts used.` };
  }

  recordAttempt(playbookId: string, now: number = Date.now()): void {
    const window = this.attempts.get(playbookId) ?? [];
    window.push(now);
    this.attempts.set(playbookId, window);
  }

  /**
   * Reject an improvised sequence. This is the guard against the planner
   * assembling primitives into an unreviewed plan at run time.
   */
  isWhitelistedSequence(capabilityIds: string[]): { allowed: boolean; matchedPlaybook: string | null; reason: string } {
    for (const playbook of Array.from(this.playbooks.values())) {
      const ids = playbook.steps.map((s) => s.capabilityId);
      if (ids.length === capabilityIds.length && ids.every((id, i) => id === capabilityIds[i])) {
        return {
          allowed: true,
          matchedPlaybook: playbook.id,
          reason: `Sequence matches registered playbook ${playbook.id}@${playbook.version}.`,
        };
      }
    }
    return {
      allowed: false,
      matchedPlaybook: null,
      reason:
        'Sequence does not match any registered playbook. Individually-permitted steps ' +
        'do not compose into a permitted plan — register the sequence for review.',
    };
  }
}

/**
 * The state a playbook is assessed against at registration: production,
 * unattended, incident open, degraded. Registration must not be able to
 * launder a dangerous plan by evaluating it under favourable conditions.
 */
export function worstCaseState(): SystemStateSnapshot {
  return {
    at: new Date(0).toISOString(),
    environment: 'production',
    humanPresent: false,
    healthScore: 0.3,
    degradedComponents: ['<assessment placeholder>'],
    incidentActive: true,
    armedInterlocks: [],
    extra: { assessment: 'worst-case registration snapshot' },
  };
}

function subsystemOf(resource: string): string {
  const trimmed = resource.replace(/^[a-z]+:\/\//, '');
  const segments = trimmed.split(/[/.]/).filter(Boolean);
  return segments.length > 0 ? segments[0] : resource;
}
