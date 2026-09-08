/**
 * The contract registry.
 *
 * This is the object the planner talks to, and the ONLY one. It does not know
 * what a 3D printer is, what Stripe is, or what a goal is. It knows that
 * capabilities have costs, blast radii, authority functions and success
 * predicates — which is enough to plan, authorize, execute and verify all of
 * them identically.
 *
 * Adding a capability stops being "teach HEIDI a new trick" and becomes
 * "plug another governed instrument into the nervous system".
 */

import type { RiskLevel } from '../operational/types';
import type {
  CapabilityArgs,
  CapabilityContract,
  CapabilityExecutor,
  ExecutionContext,
  ObservationSource,
  Observer,
  SystemStateSnapshot,
} from './types';
import { tierIndex } from './types';
import { computeAuthority, authorizeAgainstDelegation } from './Authority';
import type { AuthorityDecision } from './types';
import type { AuthorizationOutcome, StandingDelegation } from './Authority';
import { assessBlastRadius } from './BlastRadius';
import type { BlastRadiusAssessment } from './BlastRadius';
import { validateContract, formatValidation } from './ContractValidator';
import type { ValidationResult } from './ContractValidator';
import { VerificationRunner } from './Verification';
import type { ContractVerificationResult } from './Verification';
import { simulate } from './Simulation';
import type { SimulationReport } from './Simulation';

export interface RegistrationResult {
  registered: boolean;
  capabilityId: string;
  validation: ValidationResult;
  /** The ceiling actually applied, after validation. */
  effectiveMaxTier: RiskLevel;
  /** True when the capability is known but has no executor wired. */
  advisoryOnly: boolean;
  report: string;
}

export interface ResolvedInvocation {
  contract: CapabilityContract;
  blast: BlastRadiusAssessment;
  authorization: AuthorizationOutcome;
  unmetPreconditions: string[];
  executable: boolean;
  reason: string;
}

export interface ExecutionRecord {
  capabilityId: string;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  outcome: 'success' | 'failure' | 'refused' | 'timeout' | 'unverified';
  tier: RiskLevel;
  authorityRationale: string;
  /** Arguments with declared secrets redacted. */
  redactedArgs: CapabilityArgs;
  result: unknown;
  error: string | null;
  verification: ContractVerificationResult | null;
}

export interface JournalSink {
  (record: ExecutionRecord): void;
}

export interface ContractRegistryOptions {
  /** Where execution records go. Defaults to a no-op. */
  journal?: JournalSink;
  /** Refuse registration of contracts with validation errors. Default true. */
  strict?: boolean;
}

export class ContractRegistry {
  private readonly contracts = new Map<string, CapabilityContract>();
  private readonly executors = new Map<string, CapabilityExecutor>();
  private readonly verifier = new VerificationRunner();
  private readonly journal: JournalSink;
  private readonly strict: boolean;
  private readonly records: ExecutionRecord[] = [];

  constructor(options: ContractRegistryOptions = {}) {
    this.journal = options.journal ?? (() => undefined);
    this.strict = options.strict !== false;
  }

  // --- Registration -------------------------------------------------------

  register(
    contract: CapabilityContract,
    executor: CapabilityExecutor | null = null,
  ): RegistrationResult {
    const validation = validateContract(contract);
    const report = formatValidation(contract, validation);

    if (!validation.valid && this.strict) {
      return {
        registered: false,
        capabilityId: contract.identity.id,
        validation,
        effectiveMaxTier: validation.effectiveMaxTier,
        advisoryOnly: true,
        report,
      };
    }

    // The validated ceiling is authoritative. A contract cannot register
    // itself with more headroom than its own specification justifies.
    const applied: CapabilityContract = {
      ...contract,
      maxTier: validation.effectiveMaxTier,
    };

    this.contracts.set(applied.identity.id, applied);
    if (executor) {
      this.executors.set(applied.identity.id, executor);
    }

    return {
      registered: true,
      capabilityId: applied.identity.id,
      validation,
      effectiveMaxTier: validation.effectiveMaxTier,
      advisoryOnly: !executor,
      report,
    };
  }

  registerObserver(source: ObservationSource, observer: Observer): void {
    this.verifier.registerObserver(source, observer);
  }

  get(capabilityId: string): CapabilityContract | null {
    return this.contracts.get(capabilityId) ?? null;
  }

  list(): CapabilityContract[] {
    return Array.from(this.contracts.values());
  }

  /** Capabilities registered without an executor — known but not wired. */
  unwired(): string[] {
    return this.list()
      .filter((c) => !this.executors.has(c.identity.id))
      .map((c) => c.identity.id);
  }

  /**
   * Capabilities whose verification source has no registered observer. These
   * are silently unverifiable at run time, which is worse than being
   * unregistered — this method is what stops that being silent.
   */
  unobservable(): Array<{ capabilityId: string; source: ObservationSource }> {
    const out: Array<{ capabilityId: string; source: ObservationSource }> = [];
    for (const contract of this.list()) {
      const source = contract.verification.observation.source;
      if (source === 'none') continue;
      if (!this.verifier.hasObserver(source)) {
        out.push({ capabilityId: contract.identity.id, source });
      }
    }
    return out;
  }

  // --- Authority ----------------------------------------------------------

  /**
   * Authority for one invocation, with cross-contract coherence applied.
   *
   * `computeAuthority` sees a single contract, so it cannot catch a
   * contradiction that only exists between two. This one can, and enforces the
   * rule that matters:
   *
   *   **An inverse may not be rated above the capability it reverses.**
   *
   * If X is autonomous *because* it can be undone by Y, then requiring human
   * approval for Y makes X's justification false — the system grants autonomy
   * on the strength of a rollback it will not perform. Either the undo is
   * available on the same terms as the act, or the act was never really
   * reversible.
   *
   * Found by measurement, not review: registering `tool.cancel_task` correctly
   * dropped `tool.create_task` from R3 to R2, and left the undo itself at R4
   * (verb `delete` = R3, plus +1 for having no undo of its own).
   */
  authorityFor(
    capabilityId: string,
    args: CapabilityArgs,
    state: SystemStateSnapshot,
  ): AuthorityDecision | null {
    const contract = this.contracts.get(capabilityId);
    if (!contract) return null;

    const decision = computeAuthority(contract, args, state);

    const reverses = this.reverses(capabilityId);
    if (reverses.length === 0) return decision;

    // Cap at the LOWEST tier among the capabilities this undoes: the undo must
    // be available wherever any of them are.
    let cap: RiskLevel = decision.tier;
    let cappedBy: string | null = null;
    for (const forward of reverses) {
      const forwardDecision = computeAuthority(forward, args, state);
      if (tierIndex(forwardDecision.tier) < tierIndex(cap)) {
        cap = forwardDecision.tier;
        cappedBy = forward.identity.id;
      }
    }

    if (cappedBy === null || tierIndex(cap) >= tierIndex(decision.tier)) {
      return decision;
    }

    return {
      tier: cap,
      factors: decision.factors.concat([
        {
          name: 'inverse_coherence',
          value: `capped at ${cap} to match ${cappedBy}`,
          escalation: 0,
        },
      ]),
      rationale:
        `${decision.rationale}; capped to ${cap} because it is the declared undo for ` +
        `${cappedBy} — an undo gated harder than the act it reverses makes that ` +
        `act's reversibility claim false`,
      requiresApproval: tierIndex(cap) >= tierIndex('R3'),
    };
  }

  /** Registered capabilities that name `capabilityId` as their inverse. */
  reverses(capabilityId: string): CapabilityContract[] {
    return this.list().filter(
      (c) =>
        c.reversibility.kind === 'inverse_capability' &&
        c.reversibility.inverseCapabilityId === capabilityId &&
        c.identity.id !== capabilityId,
    );
  }

  /**
   * Contracts naming an inverse that is not registered. A reversibility claim
   * resting on a capability that does not exist is the boolean `reversible:
   * true` problem wearing a better costume.
   */
  danglingInverses(): Array<{ capabilityId: string; missingInverse: string }> {
    const out: Array<{ capabilityId: string; missingInverse: string }> = [];
    for (const contract of this.list()) {
      const inverse = contract.reversibility.inverseCapabilityId;
      if (contract.reversibility.kind !== 'inverse_capability' || !inverse) continue;
      if (inverse === contract.identity.id) continue;
      if (!this.contracts.has(inverse)) {
        out.push({ capabilityId: contract.identity.id, missingInverse: inverse });
      }
    }
    return out;
  }

  // --- Resolution ---------------------------------------------------------

  /**
   * Answer the planner's real question: given these arguments and this world,
   * what tier is this, may I run it, and what would stop me?
   */
  resolve(
    capabilityId: string,
    args: CapabilityArgs,
    state: SystemStateSnapshot,
    delegation: StandingDelegation | null,
  ): ResolvedInvocation | null {
    const contract = this.contracts.get(capabilityId);
    if (!contract) return null;

    const blast = assessBlastRadius(contract, args, state);
    const decision = this.authorityFor(capabilityId, args, state) ?? computeAuthority(contract, args, state);
    const authorization = authorizeAgainstDelegation(decision, contract, delegation);

    const unmetPreconditions = contract.preconditions
      .filter((p) => {
        try {
          return !p.test(state, args);
        } catch {
          return true;
        }
      })
      .map((p) => `${p.id}: ${p.description}`);

    const hasExecutor = this.executors.has(capabilityId);
    const executable =
      authorization.allowed && unmetPreconditions.length === 0 && hasExecutor;

    let reason = authorization.reason;
    if (!hasExecutor) {
      reason = `${capabilityId} is registered but has no executor — advisory only.`;
    } else if (unmetPreconditions.length > 0) {
      reason = `${unmetPreconditions.length} precondition(s) unmet: ${unmetPreconditions.join('; ')}`;
    }

    return { contract, blast, authorization, unmetPreconditions, executable, reason };
  }

  async simulate(
    capabilityId: string,
    args: CapabilityArgs,
    state: SystemStateSnapshot,
  ): Promise<SimulationReport | null> {
    const contract = this.contracts.get(capabilityId);
    if (!contract) return null;
    return simulate(contract, args, state);
  }

  // --- Execution ----------------------------------------------------------

  /**
   * Execute a capability that has already passed the commit gate.
   *
   * Verification runs unconditionally afterwards. An action that succeeded
   * and cannot be verified is reported as `unverified`, never as success —
   * a 201 and an exit code 0 are not evidence that anything happened.
   */
  async execute(
    capabilityId: string,
    args: CapabilityArgs,
    ctx: ExecutionContext,
    delegation: StandingDelegation | null,
  ): Promise<ExecutionRecord> {
    const startedAt = new Date();
    const contract = this.contracts.get(capabilityId);

    if (!contract) {
      return this.finish(
        buildRecord(capabilityId, {}, startedAt, 'refused', 'R5', 'unknown capability'),
      );
    }

    const redactedArgs = redact(args, contract.observability.redactParams);
    const resolution = this.resolve(capabilityId, args, ctx.state, delegation);

    if (!resolution || !resolution.executable) {
      return this.finish(
        buildRecord(
          capabilityId,
          redactedArgs,
          startedAt,
          'refused',
          resolution ? resolution.authorization.decision.tier : 'R5',
          resolution ? resolution.reason : 'unresolvable',
        ),
      );
    }

    const executor = this.executors.get(capabilityId)!;
    const tier = resolution.authorization.decision.tier;
    const rationale = resolution.authorization.decision.rationale;

    let result: unknown = null;
    let error: string | null = null;
    let timedOut = false;

    try {
      result = await withTimeout(
        executor(args, ctx),
        contract.cost.timeoutMs,
        () => {
          timedOut = true;
        },
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    if (timedOut) {
      return this.finish(
        buildRecord(capabilityId, redactedArgs, startedAt, 'timeout', tier, rationale, {
          error: `exceeded timeoutMs=${contract.cost.timeoutMs}`,
        }),
      );
    }

    if (error !== null) {
      return this.finish(
        buildRecord(capabilityId, redactedArgs, startedAt, 'failure', tier, rationale, {
          error,
        }),
      );
    }

    const verification = await this.verifier.verify(contract, args, ctx, result);

    const outcome: ExecutionRecord['outcome'] =
      verification.outcome === 'verified'
        ? 'success'
        : verification.outcome === 'failed'
          ? 'failure'
          : 'unverified';

    return this.finish(
      buildRecord(capabilityId, redactedArgs, startedAt, outcome, tier, rationale, {
        result,
        verification,
      }),
    );
  }

  getRecords(): ExecutionRecord[] {
    return this.records.slice();
  }

  /**
   * Registry-wide honesty check. Run it in CI: it fails when the system has
   * accumulated capabilities that can act but cannot be checked.
   */
  audit(): {
    total: number;
    unwired: string[];
    unobservable: Array<{ capabilityId: string; source: ObservationSource }>;
    cappedAtR1: string[];
    aboveR2WithoutInverse: string[];
  } {
    const cappedAtR1 = this.list()
      .filter((c) => tierIndex(c.maxTier) <= tierIndex('R1'))
      .map((c) => c.identity.id);

    const aboveR2WithoutInverse = this.list()
      .filter(
        (c) =>
          tierIndex(c.maxTier) > tierIndex('R2') &&
          c.reversibility.kind === 'none' &&
          c.effects.some((e) => e.verb !== 'read'),
      )
      .map((c) => c.identity.id);

    return {
      total: this.contracts.size,
      unwired: this.unwired(),
      unobservable: this.unobservable(),
      cappedAtR1,
      aboveR2WithoutInverse,
    };
  }

  private finish(record: ExecutionRecord): ExecutionRecord {
    this.records.push(record);
    try {
      this.journal(record);
    } catch {
      // A failing journal sink must not swallow the execution result.
    }
    return record;
  }
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function buildRecord(
  capabilityId: string,
  redactedArgs: CapabilityArgs,
  startedAt: Date,
  outcome: ExecutionRecord['outcome'],
  tier: RiskLevel,
  authorityRationale: string,
  extra: { result?: unknown; error?: string; verification?: ContractVerificationResult } = {},
): ExecutionRecord {
  const finishedAt = new Date();
  return {
    capabilityId,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    outcome,
    tier,
    authorityRationale,
    redactedArgs,
    result: extra.result ?? null,
    error: extra.error ?? null,
    verification: extra.verification ?? null,
  };
}

export function redact(
  args: CapabilityArgs,
  redactParams: string[],
): CapabilityArgs {
  const out: CapabilityArgs = {};
  for (const key of Object.keys(args)) {
    out[key] = redactParams.indexOf(key) !== -1 ? '[REDACTED]' : args[key];
  }
  return out;
}

function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  onTimeout: () => void,
): Promise<T> {
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      onTimeout();
      resolve(undefined as unknown as T);
    }, timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (err) => {
        clearTimeout(timer);
        reject(err);
      },
    );
  });
}
