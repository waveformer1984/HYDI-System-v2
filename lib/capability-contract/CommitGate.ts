/**
 * The commit gate.
 *
 * INVARIANT: sub-agents propose; only the control plane commits.
 *
 * The moment a specialist agent (research, engineering, security,
 * fabrication, QA) holds write authority directly, two things break at once:
 * the audit trail acquires a hole, and the governance layer becomes
 * decorative — twelve autonomous agents confidently doing twelve mutually
 * incompatible things.
 *
 * This is enforced structurally rather than by convention: a Proposal carries
 * no executor. There is no code path from holding a Proposal to causing an
 * effect. The only way to act is to hand it to the gate, which is held by
 * HEIDI alone.
 */

import { randomUUID } from 'crypto';
import type {
  CapabilityArgs,
  CapabilityContract,
  ExecutionContext,
  SystemStateSnapshot,
} from './types';
import { tierIndex } from './types';
import { computeAuthority, authorizeAgainstDelegation } from './Authority';
import type { StandingDelegation, AuthorizationOutcome } from './Authority';

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

export interface Proposal {
  proposalId: string;
  /** Which agent produced it. */
  proposedBy: string;
  capabilityId: string;
  args: CapabilityArgs;
  /** The agent's own justification. Advisory: the gate re-derives authority. */
  reasoning: string;
  /** The agent's confidence, 0-1. Never used to lower a tier. */
  confidence: number;
  createdAt: string;
  /** Proposals expire — a plan built on a stale world is a hazard. */
  expiresAt: string;
}

export interface ProposalInput {
  proposedBy: string;
  capabilityId: string;
  args: CapabilityArgs;
  reasoning: string;
  confidence: number;
  ttlMs?: number;
}

const DEFAULT_PROPOSAL_TTL_MS = 5 * 60_000;

/**
 * Sub-agents call this. It produces an inert description of an intent.
 * Note what it does NOT return: anything callable.
 */
export function propose(input: ProposalInput): Proposal {
  const now = Date.now();
  return {
    proposalId: `prop-${randomUUID()}`,
    proposedBy: input.proposedBy,
    capabilityId: input.capabilityId,
    args: input.args,
    reasoning: input.reasoning,
    confidence: input.confidence,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + (input.ttlMs ?? DEFAULT_PROPOSAL_TTL_MS)).toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Gate
// ---------------------------------------------------------------------------

export type CommitVerdict =
  | 'committed'
  | 'rejected_unknown_capability'
  | 'rejected_expired'
  | 'rejected_untrusted_proposer'
  | 'rejected_prohibited'
  | 'rejected_precondition'
  | 'awaiting_approval';

export interface CommitDecision {
  verdict: CommitVerdict;
  proposal: Proposal;
  authorization: AuthorizationOutcome | null;
  /** Preconditions that were not satisfied. */
  unmetPreconditions: string[];
  reason: string;
  /** Populated only when verdict === 'committed'. */
  approvedContext: ExecutionContext | null;
}

export interface CommitGateOptions {
  /** Agents permitted to submit proposals at all. */
  trustedProposers: string[];
  /**
   * Per-proposer ceiling. An engineering agent may propose R4 work, but the
   * gate can decide research proposals never exceed R1.
   */
  proposerCeilings?: Record<string, string>;
}

export interface ContractLookup {
  (capabilityId: string): CapabilityContract | null;
}

export class CommitGate {
  private readonly lookup: ContractLookup;
  private readonly options: CommitGateOptions;
  private readonly history: CommitDecision[] = [];

  constructor(lookup: ContractLookup, options: CommitGateOptions) {
    this.lookup = lookup;
    this.options = options;
  }

  /**
   * The single chokepoint. Every effect in the system passes through here or
   * it is a bug.
   */
  evaluate(
    proposal: Proposal,
    state: SystemStateSnapshot,
    delegation: StandingDelegation | null,
    ctx: Omit<ExecutionContext, 'state' | 'authorityId'>,
    now: Date = new Date(),
  ): CommitDecision {
    const base = {
      proposal,
      authorization: null,
      unmetPreconditions: [] as string[],
      approvedContext: null,
    };

    if (this.options.trustedProposers.indexOf(proposal.proposedBy) === -1) {
      return this.remember({
        ...base,
        verdict: 'rejected_untrusted_proposer',
        reason: `"${proposal.proposedBy}" is not a trusted proposer.`,
      });
    }

    if (new Date(proposal.expiresAt).getTime() < now.getTime()) {
      return this.remember({
        ...base,
        verdict: 'rejected_expired',
        reason: `Proposal expired at ${proposal.expiresAt}; the world it was built on may no longer hold.`,
      });
    }

    const contract = this.lookup(proposal.capabilityId);
    if (!contract) {
      return this.remember({
        ...base,
        verdict: 'rejected_unknown_capability',
        reason: `No contract registered for "${proposal.capabilityId}".`,
      });
    }

    const unmet = contract.preconditions
      .filter((p) => !safeTest(p.test, state, proposal.args))
      .map((p) => `${p.id}: ${p.description}${p.satisfiedBy ? ` (try ${p.satisfiedBy})` : ''}`);
    if (unmet.length > 0) {
      return this.remember({
        ...base,
        verdict: 'rejected_precondition',
        unmetPreconditions: unmet,
        reason: `${unmet.length} precondition(s) unmet — not a denial, a "not yet".`,
      });
    }

    const decision = computeAuthority(contract, proposal.args, state);
    const authorization = authorizeAgainstDelegation(decision, contract, delegation, now);

    // A proposer ceiling caps what an agent may cause, independent of what
    // the human delegation allows the control plane to do.
    const proposerCeiling = this.options.proposerCeilings?.[proposal.proposedBy];
    if (proposerCeiling && tierIndex(decision.tier) > tierIndex(proposerCeiling as never)) {
      return this.remember({
        ...base,
        verdict: 'awaiting_approval',
        authorization,
        reason:
          `${decision.tier} exceeds the ceiling ${proposerCeiling} for proposer ` +
          `"${proposal.proposedBy}". ${decision.rationale}`,
      });
    }

    if (decision.tier === 'R5') {
      return this.remember({
        ...base,
        verdict: 'rejected_prohibited',
        authorization,
        reason: authorization.reason,
      });
    }

    if (!authorization.allowed) {
      return this.remember({
        ...base,
        verdict: 'awaiting_approval',
        authorization,
        reason: authorization.reason,
      });
    }

    return this.remember({
      ...base,
      verdict: 'committed',
      authorization,
      reason: decision.rationale,
      approvedContext: {
        ...ctx,
        state,
        authorityId: delegation ? delegation.authorityId : null,
      },
    });
  }

  getHistory(): CommitDecision[] {
    return this.history.slice();
  }

  private remember(decision: CommitDecision): CommitDecision {
    this.history.push(decision);
    return decision;
  }
}

function safeTest(
  test: (state: SystemStateSnapshot, args: CapabilityArgs) => boolean,
  state: SystemStateSnapshot,
  args: CapabilityArgs,
): boolean {
  try {
    return test(state, args);
  } catch {
    // A precondition that throws is a precondition that did not hold.
    return false;
  }
}
