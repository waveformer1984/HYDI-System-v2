/**
 * Verification runner.
 *
 * Verification is not a stage in a loop — it is a field on the contract.
 * The planner does not know how to check that a print succeeded or that a
 * goal advanced; it knows how to evaluate conditions against an observation,
 * and the contract supplies both.
 *
 * FAIL-CLOSED. The pre-existing VerificationContractRegistry in
 * lib/delegated-operator returns `verified: true` when no contract is
 * registered ("no contract = trust the adapter"). That is a false green: the
 * default answer to "did this work?" becomes "yes" precisely for the
 * capabilities nobody bothered to specify. Here, an absent or empty
 * predicate is an explicit UNVERIFIABLE outcome, which the planner must
 * treat as failure for anything above R1.
 */

import type {
  CapabilityArgs,
  CapabilityContract,
  ConditionOperator,
  ExecutionContext,
  ObservationSource,
  Observer,
  VerificationCondition,
} from './types';

export type VerificationOutcome = 'verified' | 'failed' | 'unverifiable' | 'error';

export interface ContractVerificationResult {
  outcome: VerificationOutcome;
  verified: boolean;
  confidence: number;
  /** Which conditions failed, rendered for humans. */
  failedConditions: string[];
  observedState: Record<string, unknown>;
  evidence: string;
  /** What the planner should do next, taken from the contract. */
  onFailure: CapabilityContract['verification']['onFailure'];
}

export class VerificationRunner {
  private observers = new Map<ObservationSource, Observer>();

  /**
   * Register how to observe a given source. This is the extension point that
   * makes a camera and a Postgres table interchangeable to the planner.
   */
  registerObserver(source: ObservationSource, observer: Observer): void {
    this.observers.set(source, observer);
  }

  hasObserver(source: ObservationSource): boolean {
    return this.observers.has(source);
  }

  registeredSources(): ObservationSource[] {
    return Array.from(this.observers.keys());
  }

  async verify(
    contract: CapabilityContract,
    args: CapabilityArgs,
    ctx: ExecutionContext,
    result?: unknown,
  ): Promise<ContractVerificationResult> {
    const spec = contract.verification;

    if (spec.conditions.length === 0) {
      return {
        outcome: 'unverifiable',
        verified: false,
        confidence: 0,
        failedConditions: [],
        observedState: {},
        evidence:
          `${contract.identity.id} declares no verification conditions. ` +
          'Absence of a predicate is not evidence of success.',
        onFailure: spec.onFailure,
      };
    }

    if (spec.observation.source === 'none') {
      return {
        outcome: 'unverifiable',
        verified: false,
        confidence: 0,
        failedConditions: [],
        observedState: {},
        evidence: `${contract.identity.id} declares conditions but no observation source.`,
        onFailure: spec.onFailure,
      };
    }

    const observer = this.observers.get(spec.observation.source);
    if (!observer) {
      return {
        outcome: 'unverifiable',
        verified: false,
        confidence: 0,
        failedConditions: [],
        observedState: {},
        evidence:
          `No observer registered for source "${spec.observation.source}" ` +
          `required by ${contract.identity.id}.`,
        onFailure: spec.onFailure,
      };
    }

    if (spec.observation.settleMs > 0) {
      await delay(spec.observation.settleMs);
    }

    let observedState: Record<string, unknown>;
    try {
      observedState = await observer(spec.observation, args, ctx, result);
    } catch (err) {
      return {
        outcome: 'error',
        verified: false,
        confidence: 0,
        failedConditions: [],
        observedState: {},
        evidence: `Observation failed: ${errorMessage(err)}`,
        onFailure: spec.onFailure,
      };
    }

    const failedConditions: string[] = [];
    for (const condition of spec.conditions) {
      const value = extractField(observedState, condition.field);
      const expected = substitutePlaceholders(condition.expected, args);
      if (!checkCondition(value, condition.operator, expected)) {
        failedConditions.push(
          `${condition.field} ${condition.operator} ${String(expected)} (observed: ${render(value)})`,
        );
      }
    }

    const verified = failedConditions.length === 0;
    return {
      outcome: verified ? 'verified' : 'failed',
      verified,
      confidence: verified ? 0.95 : 0.05,
      failedConditions,
      observedState,
      evidence: verified
        ? `All ${spec.conditions.length} condition(s) held: ${spec.description}`
        : `Failed: ${failedConditions.join('; ')}`,
      onFailure: spec.onFailure,
    };
  }
}

// ---------------------------------------------------------------------------
// Condition evaluation
// ---------------------------------------------------------------------------

export function extractField(
  state: Record<string, unknown>,
  field: string,
): unknown {
  const parts = field.split('.');
  let current: unknown = state;
  for (const part of parts) {
    if (current === null || current === undefined) return undefined;
    if (typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

export function substitutePlaceholders(
  value: string | number | boolean | null,
  args: CapabilityArgs,
): string | number | boolean | null {
  if (typeof value !== 'string') return value;
  return value.replace(/\{(\w+)\}/g, (match, key: string) => {
    const replacement = args[key];
    return replacement === undefined || replacement === null ? match : String(replacement);
  });
}

export function checkCondition(
  value: unknown,
  operator: ConditionOperator,
  expected: string | number | boolean | null,
): boolean {
  switch (operator) {
    case 'exists':
      return value !== undefined;
    case 'not_null':
      return value !== undefined && value !== null;
    case 'eq':
      return looseEquals(value, expected);
    case 'neq':
      return !looseEquals(value, expected);
    case 'gt':
      return numeric(value) > numeric(expected);
    case 'lt':
      return numeric(value) < numeric(expected);
    case 'gte':
      return numeric(value) >= numeric(expected);
    case 'lte':
      return numeric(value) <= numeric(expected);
    case 'contains':
      if (Array.isArray(value)) {
        return value.some((v) => looseEquals(v, expected));
      }
      return typeof value === 'string' && value.indexOf(String(expected)) !== -1;
    case 'matches':
      if (typeof value !== 'string' || typeof expected !== 'string') return false;
      try {
        return new RegExp(expected).test(value);
      } catch {
        return false;
      }
    default:
      return false;
  }
}

function looseEquals(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || a === undefined || b === null || b === undefined) return false;
  if (typeof a === 'number' || typeof b === 'number') {
    return Number(a) === Number(b);
  }
  return String(a) === String(b);
}

function numeric(value: unknown): number {
  const n = Number(value);
  return Number.isNaN(n) ? Number.NEGATIVE_INFINITY : n;
}

function render(value: unknown): string {
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value).slice(0, 120);
    } catch {
      return '[unserializable]';
    }
  }
  return String(value);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Validates a condition set at registration time — catches predicates that
 * can never fail, which are the most common way a verification spec becomes
 * decorative.
 */
export function findVacuousConditions(
  conditions: VerificationCondition[],
): string[] {
  const problems: string[] = [];
  for (const c of conditions) {
    if (c.operator === 'exists' && c.field === '') {
      problems.push('condition on empty field with `exists` always passes');
    }
    if (c.operator === 'neq' && c.expected === null && c.field === '') {
      problems.push('vacuous `neq null` on empty field');
    }
  }
  return problems;
}
