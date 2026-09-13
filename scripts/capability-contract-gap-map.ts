/**
 * Capability contract gap map.
 *
 * Lifts every legacy descriptor in lib/heidi/CapabilityRegistry into a
 * capability contract and reports what the migration exposes:
 *
 *   - which capabilities have no verification predicate (capped at R1)
 *   - which legacy static risk levels were optimistic once the tier is
 *     derived from target, blast radius, reversibility and state
 *   - which claim reversibility with no named inverse
 *
 * Run:  npx tsx scripts/capability-contract-gap-map.ts [--json]
 *
 * Exit code is 0 always: this is a report, not a gate. The CI gate is
 * `scripts/capability-contract-audit.ts`.
 */

import { DEFAULT_CAPABILITIES } from '../lib/heidi/CapabilityRegistry';
import {
  computeAuthority,
  defaultState,
  liftAll,
  validateContract,
} from '../lib/capability-contract';
import type { LegacyCapabilityDescriptor } from '../lib/capability-contract';

const asJson = process.argv.indexOf('--json') !== -1;

/**
 * Tiers are derived under the state that actually matters for autonomy:
 * production, unattended, incident open, system degraded. A capability rated
 * on a quiet afternoon tells you nothing about 3am.
 */
const UNATTENDED_PRODUCTION = defaultState({
  environment: 'production',
  humanPresent: false,
  incidentActive: true,
  healthScore: 0.4,
});

const legacy = DEFAULT_CAPABILITIES as unknown as LegacyCapabilityDescriptor[];

const { contracts, report } = liftAll(
  legacy,
  (contract) => computeAuthority(contract, {}, UNATTENDED_PRODUCTION).tier,
  { defaultOwner: 'unassigned' },
);

const validations = contracts.map((contract) => ({
  id: contract.identity.id,
  result: validateContract(contract),
}));

const invalid = validations.filter((v) => !v.result.valid);
const cappedAtR1 = validations.filter((v) => v.result.effectiveMaxTier === 'R1');

if (asJson) {
  process.stdout.write(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        assessedUnder: UNATTENDED_PRODUCTION,
        summary: {
          total: report.total,
          invalid: invalid.length,
          cappedAtR1: cappedAtR1.length,
          needsVerificationPredicate: report.needsVerificationPredicate.length,
          underratedByLegacy: report.underratedByLegacy.length,
          unprovenReversibility: report.unprovenReversibility.length,
        },
        ...report,
        invalid: invalid.map((v) => ({
          id: v.id,
          issues: v.result.issues.map((i) => `${i.severity.toUpperCase()} ${i.code}`),
        })),
      },
      null,
      2,
    ) + '\n',
  );
  process.exit(0);
}

const line = (s = '') => process.stdout.write(s + '\n');

line('HYDI capability contract — gap map');
line('='.repeat(72));
line(`Legacy descriptors:            ${report.total}`);
line(`Fail contract validation:      ${invalid.length}`);
line(`Capped at R1 (unverifiable):   ${cappedAtR1.length}`);
line(`Unproven reversibility claims: ${report.unprovenReversibility.length}`);
line(`Legacy risk level optimistic:  ${report.underratedByLegacy.length}`);
line();
line('Assessed under: production, unattended, incident active, health 0.4');
line();

line('— Legacy risk levels that do not survive derivation —');
line('  Read honestly: a lifted contract declares no resource bounds, so every');
line('  mutating capability is assessed at system scope. That inflation IS the');
line('  finding — the derived tier is what the system can currently justify,');
line('  not a claim that the action is truly R4. Writing the bounds and the');
line('  predicate is what brings it back down.');
line();
line('  capability                              legacy  derived');
for (const row of report.underratedByLegacy) {
  line(`  ${row.capabilityId.padEnd(38)}  ${row.legacy.padEnd(6)}  ${row.derived}`);
}
line();

line('— Capabilities with no verification predicate (capped at R1) —');
for (const id of report.needsVerificationPredicate) {
  line(`  ${id}`);
}
line();

line('— What each of these needs before it can exceed R1 —');
line('  1. verification.observation.source  (how to go look)');
line('  2. verification.conditions[]        (what must be true)');
line('  3. effects[].resourcePatterns       (what it may touch)');
line('  4. signature.params[].resourceRef   (which arg names the target)');
line('  5. reversibility.inverseCapabilityId, where an undo genuinely exists');
line();
line(`Contracts lifted: ${contracts.length}. None are registered automatically —`);
line('a lifted contract is a to-do item, not a promotion.');
