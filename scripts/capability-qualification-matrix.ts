/**
 * Capability qualification matrix.
 *
 * One row per registered contract, combining what the contract DECLARES with
 * what live cycles actually DID. The point of separating those two columns is
 * that a complete static inventory is not evidence of anything — a contract
 * that has never run has not been qualified, however well-formed it is.
 *
 * Status is deliberately five-valued, not pass/fail:
 *
 *   VALIDATED                   exercised, verified, no disagreement
 *   EXERCISED_BUT_UNVERIFIABLE  ran, but no automatable independent check exists
 *   DISAGREEMENT                ran; the contract tier refused what legacy allowed
 *   FAILED                      ran and verification failed
 *   NOT_EXERCISED               never ran — the default, and never a pass
 *
 * Run: npm run capability:matrix -- [--since <ISO>]
 */

import { ContractRegistry, defaultState, tierIndex } from '../lib/capability-contract';
import type { CapabilityContract } from '../lib/capability-contract';
import { ALL_CONTRACTS } from '../lib/heidi/contracts';
import { safetyOf } from '../lib/heidi/contracts/exercise-safety';
import { DEFAULT_CAPABILITIES } from '../lib/heidi/CapabilityRegistry';
import { Pool } from 'pg';

type Status =
  | 'VALIDATED'
  | 'EXERCISED_BUT_UNVERIFIABLE'
  | 'DISAGREEMENT'
  | 'FAILED'
  | 'SANDBOX_LIMITED'
  | 'SELECTED_NOT_EXECUTED'
  | 'NOT_EXERCISED';

interface Row {
  capabilityId: string;
  contractVersion: string;
  declaredTier: string;
  computedTier: string;
  verificationClass: string;
  observationSource: string;
  observationTarget: string;
  exercised: boolean;
  cycles: number;
  verifiedCycles: number;
  failedCycles: number;
  unverifiableCycles: number;
  disagreements: number;
  independentlyObservable: boolean;
  status: Status;
}

const sinceArg = process.argv.indexOf('--since');
const since = sinceArg >= 0 ? process.argv[sinceArg + 1] : null;

const legacyTier = new Map<string, string>();
for (const d of DEFAULT_CAPABILITIES as unknown as Array<{ capabilityId: string; riskLevel: string }>) {
  legacyTier.set(d.capabilityId, d.riskLevel);
}

/**
 * A capability is independently observable when its verification reads
 * something other than the executor's own return value. `api_response` on a
 * READ is honest verification but it is not independent — for a read there is
 * simply nothing independent to consult, which is a different claim.
 */
function isIndependent(contract: CapabilityContract): boolean {
  const source = contract.verification.observation.source;
  return source !== 'none' && source !== 'api_response';
}

function mutates(contract: CapabilityContract): boolean {
  return contract.effects.some((e) => e.verb !== 'read');
}

function classOf(contract: CapabilityContract): string {
  const meta = contract.metadata as Record<string, unknown>;
  if (typeof meta.verificationClass === 'string') return meta.verificationClass;
  // Derive read-ness from the EFFECTS, not from metadata. Relying on a
  // `readOnly` marker mislabelled three first-wave read contracts as
  // self-reporting writes, which inflated the debt count from 3 to 6.
  if (!mutates(contract)) return 'read_response';
  if (meta.weakVerification === true) return 'self_report';
  return isIndependent(contract) ? 'independent' : 'self_report';
}

async function main(): Promise<void> {
  const registry = new ContractRegistry({ strict: false });
  for (const contract of ALL_CONTRACTS) registry.register(contract, async () => ({}));

  const state = defaultState({ humanPresent: false });

  const pool = new Pool({
    host: process.env.PG_HOST || '127.0.0.1',
    port: parseInt(process.env.PG_PORT || '54322', 10),
    database: process.env.PG_DATABASE || 'postgres',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
    max: 2,
  });

  // Live evidence. Only cycles inside the window count — telemetry recorded
  // before a contract or authority change describes a model that is no longer
  // running, and counting it would be exactly the "inferred green" this report
  // exists to prevent.
  const where = since ? `AND created_at > $1::timestamptz` : '';
  const params = since ? [since] : [];
  const evidence = await pool.query<{
    capability_id: string;
    cycles: string;
    verified: string;
    failed_v: string;
    unverifiable: string;
    disagreements: string;
    executed: string;
  }>(
    `SELECT
       payload->>'selectedCapability'                         AS capability_id,
       COUNT(*)                                               AS cycles,
       COUNT(*) FILTER (WHERE payload->>'verified' = 'true')  AS verified,
       COUNT(*) FILTER (WHERE payload->>'verified' = 'false'
                          AND payload->>'verificationStrategy' <> 'none') AS failed_v,
       COUNT(*) FILTER (WHERE payload->>'verificationStrategy' = 'none')  AS unverifiable,
       COUNT(payload->>'contractDisagreement')                AS disagreements,
       COUNT(*) FILTER (WHERE payload->>'executed' = 'true')  AS executed
     FROM heidi_events
     WHERE event_type = 'cognitive_cycle'
       AND payload->>'selectedCapability' IS NOT NULL
       ${where}
     GROUP BY payload->>'selectedCapability'`,
    params,
  );

  const seen = new Map(evidence.rows.map((r) => [r.capability_id, r]));

  // Direct exercises from the capability harness. The cognitive loop only runs
  // whichever capabilities its goals select, so loop telemetry alone reports
  // most contracts as never exercised even after they have been driven
  // deliberately through the real executor.
  const exercised = await pool.query<{
    capability_id: string;
    verified: string;
    failed_v: string;
    executed: string;
    skipped: string;
  }>(
    `SELECT
       payload->>'capabilityId'                                          AS capability_id,
       COUNT(*) FILTER (WHERE payload->>'verificationOutcome' = 'verified') AS verified,
       COUNT(*) FILTER (WHERE payload->>'verificationOutcome' IN ('failed','error')) AS failed_v,
       COUNT(*) FILTER (WHERE payload->>'executed' = 'true')             AS executed,
       COUNT(*) FILTER (WHERE payload->>'skipped' IS NOT NULL)           AS skipped
     FROM heidi_events
     WHERE event_type = 'capability_exercise'
       ${where}
     GROUP BY payload->>'capabilityId'`,
    params,
  );
  const harness = new Map(exercised.rows.map((r) => [r.capability_id, r]));

  const rows: Row[] = ALL_CONTRACTS.map((contract) => {
    const id = contract.identity.id;
    const decision = registry.authorityFor(id, {}, state)!;
    const ev = seen.get(id);
    const hxEarly = harness.get(id);
    const cycles = (ev ? Number(ev.cycles) : 0) + (hxEarly ? Number(hxEarly.executed) : 0);
    const verified = (ev ? Number(ev.verified) : 0) + (hxEarly ? Number(hxEarly.verified) : 0);
    const failed = (ev ? Number(ev.failed_v) : 0) + (hxEarly ? Number(hxEarly.failed_v) : 0);
    const unverifiable = ev ? Number(ev.unverifiable) : 0;
    const disagreements = ev ? Number(ev.disagreements) : 0;
    const hx = harness.get(id);
    const executed = (ev ? Number(ev.executed) : 0) + (hx ? Number(hx.executed) : 0);
    const independent = isIndependent(contract);

    let status: Status;
    if (cycles === 0) status = 'NOT_EXERCISED';
    // Selected by the planner but never actually run — usually refused at
    // authorization. That is NOT evidence about the verification path, and
    // collapsing it into "unverifiable" would overstate what was tested.
    else if (executed === 0) status = 'SELECTED_NOT_EXECUTED';
    else if (disagreements > 0) status = 'DISAGREEMENT';
    // A verification failure is only a CONTRACT failure once execution,
    // fixture validity and sandbox fidelity are ruled out. Where the sandbox
    // itself cannot satisfy the predicate — a synthetic service is genuinely
    // not operational — the refusal is correct and must not be filed as a bug.
    else if (failed > 0) {
      status = safetyOf(id)?.sandboxLimitation ? 'SANDBOX_LIMITED' : 'FAILED';
    }
    else if (contract.verification.requiresHumanConfirmation || unverifiable > 0) {
      status = 'EXERCISED_BUT_UNVERIFIABLE';
    } else if (verified > 0) status = 'VALIDATED';
    else status = 'EXERCISED_BUT_UNVERIFIABLE';

    return {
      capabilityId: id,
      contractVersion: contract.identity.version,
      declaredTier: legacyTier.get(id) ?? '—',
      computedTier: decision.tier,
      verificationClass: classOf(contract),
      observationSource: contract.verification.observation.source,
      observationTarget: contract.verification.observation.target || '—',
      exercised: cycles > 0,
      cycles,
      verifiedCycles: verified,
      failedCycles: failed,
      unverifiableCycles: unverifiable,
      disagreements,
      independentlyObservable: independent,
      status,
    };
  });

  await pool.end();

  const line = (s = '') => process.stdout.write(s + '\n');
  const order: Status[] = [
    'FAILED',
    'DISAGREEMENT',
    'SANDBOX_LIMITED',
    'EXERCISED_BUT_UNVERIFIABLE',
    'SELECTED_NOT_EXECUTED',
    'VALIDATED',
    'NOT_EXERCISED',
  ];
  rows.sort(
    (a, b) =>
      order.indexOf(a.status) - order.indexOf(b.status) ||
      a.capabilityId.localeCompare(b.capabilityId),
  );

  line('HYDI capability qualification matrix');
  line('='.repeat(112));
  line(`contracts: ${rows.length}    window: ${since ?? 'ALL TIME (pass --since for a clean window)'}`);
  line();
  line(
    'capability'.padEnd(42) +
      'ver'.padEnd(6) +
      'decl'.padEnd(5) +
      'comp'.padEnd(5) +
      'cyc'.padEnd(5) +
      'ind'.padEnd(5) +
      'class'.padEnd(20) +
      'status',
  );
  line('-'.repeat(112));
  for (const r of rows) {
    line(
      r.capabilityId.padEnd(42) +
        r.contractVersion.padEnd(6) +
        r.declaredTier.padEnd(5) +
        r.computedTier.padEnd(5) +
        String(r.cycles).padEnd(5) +
        (r.independentlyObservable ? 'yes' : 'no').padEnd(5) +
        r.verificationClass.padEnd(20) +
        r.status,
    );
  }

  const count = (s: Status) => rows.filter((r) => r.status === s).length;
  line();
  line('— status —');
  for (const s of order) line(`  ${s.padEnd(28)} ${count(s)}`);

  line();
  line('— independent verification —');
  const reads = rows.filter((r) => r.verificationClass === 'read_response');
  const indep = rows.filter((r) => r.independentlyObservable);
  const notIndep = rows.filter(
    (r) => !r.independentlyObservable && r.verificationClass !== 'read_response',
  );
  line(`  independently verified (re-reads a record):   ${indep.length}`);
  line(`  reads verified by their own response:         ${reads.length}`);
  line(`  writes NOT independently verified:            ${notIndep.length}`);
  for (const r of notIndep) line(`      ${r.capabilityId} (${r.verificationClass})`);

  line();
  line('— authority —');
  for (const t of ['R0', 'R1', 'R2', 'R3', 'R4', 'R5']) {
    const n = rows.filter((r) => r.computedTier === t).length;
    if (n > 0) line(`  ${t}: ${n}`);
  }
  const stricter = rows.filter(
    (r) => r.declaredTier !== '—' && tierIndex(r.computedTier as never) > tierIndex(r.declaredTier as never),
  );
  line(`  contract stricter than legacy declaration: ${stricter.length}`);

  line();
  if (count('NOT_EXERCISED') > 0) {
    line(
      `${count('NOT_EXERCISED')} capabilities have never run. An unexercised contract is ` +
        'NOT validated, however well-formed. Enforcement decisions must treat these as unknown.',
    );
  }
  process.exit(0);
}

void main().catch((err) => {
  process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
  process.exit(1);
});
