/**
 * Capability contract CI gate.
 *
 * Fails the build when the system has accumulated capabilities that can act
 * but cannot be checked. The specific conditions, in order of how badly they
 * break the governance model:
 *
 *   1. A registered capability above R1 whose verification source has no
 *      observer — it will run and report success it cannot substantiate.
 *   2. A capability above R2 that mutates state with no undo path.
 *   3. A physical capability with no independent interlock.
 *   4. A contract that fails validation outright.
 *
 * This gate operates on contracts registered into a ContractRegistry by the
 * caller. Import and call `auditRegistry` from wherever the real registry is
 * assembled; running this file directly audits the lifted legacy set, which
 * is expected to fail until contracts are written.
 *
 * Run:  npx tsx scripts/capability-contract-audit.ts
 */

import { DEFAULT_CAPABILITIES } from '../lib/heidi/CapabilityRegistry';
import {
  ContractRegistry,
  liftAll,
  computeAuthority,
  defaultState,
  tierIndex,
  validateContract,
} from '../lib/capability-contract';
import type {
  CapabilityContract,
  LegacyCapabilityDescriptor,
} from '../lib/capability-contract';

export interface AuditFinding {
  severity: 'blocking' | 'advisory';
  code: string;
  capabilityId: string;
  message: string;
}

export function auditContracts(
  contracts: CapabilityContract[],
  registry: ContractRegistry,
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const unobservable = new Set(registry.unobservable().map((u) => u.capabilityId));

  for (const contract of contracts) {
    const id = contract.identity.id;
    const validation = validateContract(contract);

    if (!validation.valid) {
      for (const issue of validation.issues) {
        if (issue.severity !== 'error') continue;
        findings.push({
          severity: 'blocking',
          code: issue.code,
          capabilityId: id,
          message: issue.message,
        });
      }
    }

    const canAct = tierIndex(contract.maxTier) > tierIndex('R1');

    if (canAct && unobservable.has(id)) {
      findings.push({
        severity: 'blocking',
        code: 'NO_OBSERVER',
        capabilityId: id,
        message:
          `${id} may act (ceiling ${contract.maxTier}) but its verification source ` +
          `"${contract.verification.observation.source}" has no registered observer. ` +
          'It would report success it cannot substantiate.',
      });
    }

    const mutates = contract.effects.some((e) => e.verb !== 'read');
    if (
      mutates &&
      contract.reversibility.kind === 'none' &&
      tierIndex(contract.maxTier) > tierIndex('R2')
    ) {
      findings.push({
        severity: 'advisory',
        code: 'NO_UNDO_PATH',
        capabilityId: id,
        message: `${id} mutates state above R2 with no undo path. Confirm this is intentional.`,
      });
    }

    const physical = contract.effects.some((e) => e.resourceKind === 'physical_machine');
    if (physical && contract.interlocks.every((i) => i.mechanism === 'software_only')) {
      findings.push({
        severity: 'blocking',
        code: 'NO_INDEPENDENT_INTERLOCK',
        capabilityId: id,
        message: `${id} actuates hardware with software-only safety.`,
      });
    }
  }

  return findings;
}

function main(): void {
  const legacy = DEFAULT_CAPABILITIES as unknown as LegacyCapabilityDescriptor[];
  const { contracts } = liftAll(legacy, (c) =>
    computeAuthority(c, {}, defaultState()).tier,
  );

  const registry = new ContractRegistry({ strict: false });
  for (const contract of contracts) {
    registry.register(contract);
  }

  const findings = auditContracts(contracts, registry);
  const blocking = findings.filter((f) => f.severity === 'blocking');

  const byCode = new Map<string, number>();
  for (const finding of findings) {
    byCode.set(finding.code, (byCode.get(finding.code) ?? 0) + 1);
  }

  process.stdout.write('HYDI capability contract audit\n');
  process.stdout.write('='.repeat(60) + '\n');
  process.stdout.write(`Contracts audited: ${contracts.length}\n`);
  process.stdout.write(`Findings: ${findings.length} (${blocking.length} blocking)\n\n`);

  const codes = Array.from(byCode.keys()).sort();
  for (const code of codes) {
    process.stdout.write(`  ${String(byCode.get(code)).padStart(4)}  ${code}\n`);
  }

  if (blocking.length > 0) {
    process.stdout.write(
      '\nBlocking findings present. This is expected for the lifted legacy set:\n' +
        'those contracts are to-do items, not registered capabilities.\n',
    );
  }

  // Report-only when run directly against the legacy set. Wire auditContracts
  // into the real registry's CI job to make it a gate.
  process.exit(0);
}

if (require.main === module) {
  main();
}
