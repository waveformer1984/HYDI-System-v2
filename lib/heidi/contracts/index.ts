/**
 * Every capability contract CognitiveCore registers.
 *
 * `COGNITIVE_CONTRACTS` were migrated first — they replaced the hand-written
 * branches of the planner's verifyAction() if-chain. `EXTENDED_CONTRACTS` are
 * the remainder, which until now fell through to that chain's final branch:
 * `verified: exec.outcome === 'success'`.
 *
 * With both registered there is no fallback branch left to reach.
 */

import type { CapabilityContract } from '../../capability-contract';
import { COGNITIVE_CONTRACTS } from './cognitive-contracts';
import { EXTENDED_CONTRACTS } from './extended-contracts';

export * from './cognitive-contracts';
export * from './extended-contracts';

export const ALL_CONTRACTS: CapabilityContract[] = [
  ...COGNITIVE_CONTRACTS,
  ...EXTENDED_CONTRACTS,
];

/**
 * Contracts whose verification only inspects the executor's own return value
 * AND which mutate something — the executor marking its own homework.
 *
 * Reads are excluded deliberately: for a read the response IS the outcome, so
 * checking it is honest verification, not debt. Conflating the two would bury
 * the four real cases in a list of eighteen false alarms.
 */
export function weaklyVerifiedWrites(): string[] {
  return ALL_CONTRACTS.filter(
    (c) =>
      c.verification.observation.source === 'api_response' &&
      c.effects.some((e) => e.verb !== 'read'),
  ).map((c) => c.identity.id);
}
