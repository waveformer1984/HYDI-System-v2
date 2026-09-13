/**
 * Contract verification bridge for CognitiveCore.
 *
 * `CognitiveCore.verifyAction()` was a ~270-line if-chain over capability
 * ids: every new capability meant editing the planner. This module moves the
 * KNOWLEDGE (how to check that a goal advanced, that a task row exists, that
 * a prospect was written) out of the planner and into contracts, and moves
 * the MECHANISM (go look, evaluate conditions) into a set of observers.
 *
 * The planner keeps only: "ask the contract, evaluate the answer."
 *
 * Observers are the extension point. Each knows how to read one kind of
 * world — a Postgres table, the goal system, a health probe — and none of
 * them know which capability they are verifying.
 *
 * Target grammar (ours, documented here, used by the contracts in
 * ./contracts/cognitive-contracts.ts):
 *
 *   database    sql:<table>:<column>={placeholder}   → SELECT row by column
 *               count:<table>                        → SELECT count(*)
 *               goal:{placeholder}                   → GoalSystem.getGoal()
 *   process     health:{placeholder}                 → operationalIntelligence.checkHealth()
 *               service:{placeholder}                → revenueLifecycle.verifyService()
 *               delivery:{placeholder}               → communicationLayer.verifyDelivery()
 *   api_response response                            → the executor's own return value
 *
 * A `{placeholder}` resolves from the invocation arguments first, then from
 * the executor's result. That ordering matters: an id supplied by the caller
 * is more trustworthy than one echoed back by the thing being verified.
 */

import type { Pool, QueryResultRow } from 'pg';
import type {
  CapabilityArgs,
  ExecutionContext,
  ObservationSource,
  ObservationSpec,
  Observer,
} from '../capability-contract';
import { VerificationRunner } from '../capability-contract';

// ---------------------------------------------------------------------------
// Structural dependencies
// ---------------------------------------------------------------------------

/**
 * Declared structurally rather than imported from CognitiveCore, so this
 * module can be tested without a database and without importing the planner
 * it is meant to unburden.
 */
export interface VerificationDeps {
  pool: Pool;
  goals: {
    getGoal: (goalId: string) => Promise<{ status?: string; result?: unknown } | null>;
  };
  operationalIntelligence?: { checkHealth: () => Promise<unknown> } | null;
  revenueLifecycle?: {
    verifyService: (
      serviceId: string,
    ) => Promise<{ verified: boolean; result: string; details?: unknown }>;
  } | null;
  /**
   * Independent delivery verification for comm.send_message. This reads the
   * durable conversation store, NOT the send call's return value — which is
   * the whole point: a transport reporting its own success is not evidence.
   */
  communicationLayer?: {
    verifyDelivery: (
      messageId: string,
    ) => Promise<{ status: string; providerMessageId: string | null }>;
  } | null;
}

// ---------------------------------------------------------------------------
// Placeholder resolution
// ---------------------------------------------------------------------------

/**
 * Resolve `{name}` against the invocation args, then the executor result.
 *
 * Returns null when a placeholder cannot be resolved. A target that cannot be
 * resolved is not an observation of "nothing there" — it is an observation
 * that could not be made, and the caller must surface it as such rather than
 * silently verifying against an empty row.
 */
export function resolveTarget(
  template: string,
  args: CapabilityArgs,
  result: unknown,
): string | null {
  let unresolved = false;

  const resolved = template.replace(/\{(\w+)\}/g, (_match, key: string) => {
    const fromArgs = args[key];
    if (fromArgs !== undefined && fromArgs !== null && fromArgs !== '') {
      return String(fromArgs);
    }
    if (result !== null && typeof result === 'object') {
      const fromResult = (result as Record<string, unknown>)[key];
      if (fromResult !== undefined && fromResult !== null && fromResult !== '') {
        return String(fromResult);
      }
    }
    unresolved = true;
    return '';
  });

  return unresolved ? null : resolved;
}

/**
 * Several capabilities return an id under one of two keys (`prospectId` or
 * `id`). The legacy chain coded that as `result?.prospectId || result?.id`;
 * contracts express it as an ordered list of candidate placeholders.
 */
function firstResolvable(
  templates: string[],
  args: CapabilityArgs,
  result: unknown,
): string | null {
  for (const template of templates) {
    const resolved = resolveTarget(template, args, result);
    if (resolved !== null) return resolved;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Observers
// ---------------------------------------------------------------------------

class UnobservableError extends Error {}

/**
 * `database` — reads the world back out of Postgres, or out of the goal
 * system. This is real verification: it does not trust the executor's word.
 */
export function createDatabaseObserver(deps: VerificationDeps): Observer {
  return async (
    spec: ObservationSpec,
    args: CapabilityArgs,
    _ctx: ExecutionContext,
    result: unknown,
  ): Promise<Record<string, unknown>> => {
    // Alternatives are separated by "|" — the first that resolves wins.
    const alternatives = spec.target.split('|').map((t) => t.trim());
    const target = firstResolvable(alternatives, args, result);

    if (target === null) {
      throw new UnobservableError(
        `Could not resolve observation target "${spec.target}" from arguments or result.`,
      );
    }

    if (target.startsWith('goal:')) {
      const goalId = target.slice('goal:'.length);
      const goal = await deps.goals.getGoal(goalId);
      return {
        found: goal !== null && goal !== undefined,
        goalId,
        status: goal?.status ?? null,
        result: goal?.result ?? null,
      };
    }

    if (target.startsWith('count:')) {
      // For capabilities whose effect is "there are now rows", not "this row
      // exists" — a sync that writes an unknown number of entities cannot be
      // verified by id, but it can be verified by the table not being empty.
      const table = target.slice('count:'.length);
      if (!isSafeIdentifier(table)) {
        throw new UnobservableError(`Refusing to count non-identifier table "${table}".`);
      }
      const rows = await deps.pool.query<QueryResultRow>(
        `SELECT count(*)::int AS count FROM ${table}`,
      );
      return { table, count: rows.rows[0]?.count ?? 0 };
    }

    if (target.startsWith('sql:')) {
      const spec2 = target.slice('sql:'.length);
      const [table, predicate] = spec2.split(':');
      const eq = predicate ? predicate.indexOf('=') : -1;
      if (!table || eq < 0) {
        throw new UnobservableError(`Malformed sql target "${target}".`);
      }
      const column = predicate.slice(0, eq);
      const value = predicate.slice(eq + 1);

      if (!isSafeIdentifier(table) || !isSafeIdentifier(column)) {
        // Identifiers cannot be parameterised, so they are whitelisted by
        // shape. Values always go through a bound parameter.
        throw new UnobservableError(
          `Refusing to query with non-identifier table/column ("${table}"."${column}").`,
        );
      }

      const columns = selectList(spec.extractFields);
      const rows = await deps.pool.query<QueryResultRow>(
        `SELECT ${columns} FROM ${table} WHERE ${column} = $1 LIMIT 1`,
        [value],
      );

      const row = rows.rows.length > 0 ? rows.rows[0] : {};
      return { found: rows.rows.length > 0, rowCount: rows.rows.length, table, ...row };
    }

    throw new UnobservableError(`Unknown database target prefix in "${target}".`);
  };
}

/**
 * `process` — asks a live subsystem whether the thing it manages is healthy.
 */
export function createProcessObserver(deps: VerificationDeps): Observer {
  return async (
    spec: ObservationSpec,
    args: CapabilityArgs,
    _ctx: ExecutionContext,
    result: unknown,
  ): Promise<Record<string, unknown>> => {
    const target = resolveTarget(spec.target, args, result);
    if (target === null) {
      throw new UnobservableError(
        `Could not resolve observation target "${spec.target}".`,
      );
    }

    if (target.startsWith('health:')) {
      const component = target.slice('health:'.length);
      if (!deps.operationalIntelligence) {
        throw new UnobservableError(
          'operationalIntelligence is not wired — cannot confirm post-recovery health.',
        );
      }
      await deps.operationalIntelligence.checkHealth();
      // checkHealth throwing is the failure signal; returning is the pass.
      return { component, healthCheckCompleted: true };
    }

    if (target.startsWith('delivery:')) {
      const messageId = target.slice('delivery:'.length);
      if (!deps.communicationLayer) {
        throw new UnobservableError(
          'communicationLayer is not wired — cannot independently verify delivery.',
        );
      }
      const delivery = await deps.communicationLayer.verifyDelivery(messageId);
      return {
        messageId,
        status: delivery.status,
        providerMessageId: delivery.providerMessageId,
      };
    }

    if (target.startsWith('service:')) {
      const serviceId = target.slice('service:'.length);
      if (!deps.revenueLifecycle) {
        throw new UnobservableError(
          'revenueLifecycle is not wired — cannot verify service activation.',
        );
      }
      const verifyResult = await deps.revenueLifecycle.verifyService(serviceId);
      return {
        serviceId,
        verified: verifyResult.verified,
        result: verifyResult.result,
        details: verifyResult.details ?? null,
      };
    }

    throw new UnobservableError(`Unknown process target prefix in "${target}".`);
  };
}

/**
 * `api_response` — the executor's own return value.
 *
 * This is the WEAK source, and contracts that use it say so. It is honest
 * only where the response IS the outcome: `world.query` returns an answer and
 * there is nowhere else to look for it. Where a durable record exists, the
 * contract should read that record instead.
 */
export function createApiResponseObserver(): Observer {
  return async (
    _spec: ObservationSpec,
    _args: CapabilityArgs,
    _ctx: ExecutionContext,
    result: unknown,
  ): Promise<Record<string, unknown>> => {
    const observed: Record<string, unknown> = {
      present: result !== null && result !== undefined,
      type: result === null ? 'null' : Array.isArray(result) ? 'array' : typeof result,
      isArray: Array.isArray(result),
      length: Array.isArray(result)
        ? result.length
        : typeof result === 'string'
          ? result.length
          : null,
      raw: result,
    };

    if (result !== null && typeof result === 'object' && !Array.isArray(result)) {
      const record = result as Record<string, unknown>;
      for (const key of Object.keys(record)) {
        // Never let a response field shadow the observation's own metadata.
        if (key in observed) continue;
        observed[key] = record[key];
      }
    }

    return observed;
  };
}

// ---------------------------------------------------------------------------
// Assembly
// ---------------------------------------------------------------------------

/**
 * Build the runner CognitiveCore uses. Sources with no live dependency are
 * deliberately NOT registered: an unregistered source produces an
 * `unverifiable` outcome, which is the correct answer, rather than a stub
 * observer that quietly returns a pass.
 */
export function heidiObservers(
  deps: VerificationDeps,
): Array<[ObservationSource, Observer]> {
  const entries: Array<[ObservationSource, Observer]> = [
    ['database', createDatabaseObserver(deps)],
    ['api_response', createApiResponseObserver()],
  ];

  if (deps.operationalIntelligence || deps.revenueLifecycle || deps.communicationLayer) {
    entries.push(['process', createProcessObserver(deps)]);
  }

  return entries;
}

export function createHeidiVerificationRunner(deps: VerificationDeps): VerificationRunner {
  const runner = new VerificationRunner();
  for (const [source, observer] of heidiObservers(deps)) {
    runner.registerObserver(source, observer);
  }
  return runner;
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const IDENTIFIER = /^[a-z_][a-z0-9_]*$/i;

function isSafeIdentifier(value: string): boolean {
  return IDENTIFIER.test(value);
}

/**
 * Build the SELECT list from the contract's `extractFields`. Anything that is
 * not a plain identifier is dropped rather than interpolated, and an empty
 * result falls back to the primary-key-ish `1` so the row still counts.
 */
function selectList(extractFields: string[]): string {
  const safe = extractFields.filter(
    (f) => isSafeIdentifier(f) && f !== 'found' && f !== 'rowCount' && f !== 'table',
  );
  return safe.length > 0 ? safe.join(', ') : '1';
}
