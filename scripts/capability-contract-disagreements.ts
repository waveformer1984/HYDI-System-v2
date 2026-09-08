/**
 * Advisory-authority evidence report.
 *
 * While HEIDI_CONTRACT_AUTHORITY is `advisory`, the contract layer computes a
 * tier for every invocation and records it without acting on it. This reads
 * that record back and answers the only question that matters before flipping
 * to `enforcing`:
 *
 *   If enforcement had been on, what would have stopped?
 *
 * A capability with many disagreements is one of two things, and the rationale
 * is what distinguishes them:
 *
 *   - genuinely riskier than its static legacy risk level admitted, or
 *   - carrying contract bounds that are wrong — usually missing
 *     `resourcePatterns`, which makes every invocation look system-scope.
 *
 * The second is the common case for freshly written contracts, and the fix is
 * to narrow the declaration, not to lower the tier.
 *
 * Run: npm run capability:disagreements [-- --hours 24]
 */

import { CognitiveCore } from '../lib/heidi/CognitiveCore';

const hoursArg = process.argv.indexOf('--hours');
const sinceArg = process.argv.indexOf('--since');

/**
 * `--since <ISO>` is the form to use after changing a contract or the
 * authority function: cycles recorded before the change carry the old tier,
 * and mixing them in reports a model that is no longer running.
 */
const since: number | string =
  sinceArg >= 0 && process.argv[sinceArg + 1]
    ? process.argv[sinceArg + 1]
    : hoursArg >= 0 && process.argv[hoursArg + 1]
      ? Number(process.argv[hoursArg + 1])
      : 168;

async function main(): Promise<void> {
  const core = new CognitiveCore();
  const line = (s = '') => process.stdout.write(s + '\n');

  try {
    const rows = await core.contractDisagreements(since);

    line('Contract authority — advisory disagreements');
    line('='.repeat(72));
    line(
      `window: ${typeof since === 'string' ? `since ${since}` : `last ${since}h`}` +
        `    mode: ${core.contractCoverage().mode}`,
    );
    line();

    if (rows.length === 0) {
      line('No cognitive cycles recorded in this window.');
      line();
      line('Nothing to analyse yet. Advisory mode only produces evidence while');
      line('the loop is actually running — start it and come back.');
      return;
    }

    const withContracts = rows.filter((r) => r.contractTiers.length > 0);
    const disagreeing = rows.filter((r) => r.disagreements > 0);

    line(`capabilities exercised:      ${rows.length}`);
    line(`  ...with a contract:        ${withContracts.length}`);
    line(`  ...that disagreed at least once: ${disagreeing.length}`);
    line();

    line('  capability                              cycles  disagree  tiers');
    for (const row of rows) {
      const pct = row.totalCycles > 0
        ? Math.round((row.disagreements / row.totalCycles) * 100)
        : 0;
      line(
        `  ${row.capabilityId.padEnd(38)}  ${String(row.totalCycles).padStart(6)}  ` +
          `${String(row.disagreements).padStart(4)} ${String(pct).padStart(3)}%  ` +
          `${row.contractTiers.join(',') || '—'}`,
      );
    }
    line();

    if (withContracts.length === 0) {
      // The distinction that matters: cycles recorded before the telemetry
      // field existed carry no contractTier at all. Reporting that as "no
      // disagreements" would be the exact false green this layer exists to
      // prevent — an absent measurement is not a passing measurement.
      line('NO CONTRACT TELEMETRY in this window.');
      line();
      line('Every cycle above was recorded without a contractTier, which means');
      line('they predate the telemetry field, or ran capabilities that have no');
      line('contract. This is NOT evidence that the contract layer agrees — it');
      line('is evidence that nothing was measured.');
      line();
      line('Run the loop for a while, then re-run this report.');
      return;
    }

    if (disagreeing.length === 0) {
      line('No disagreements. Every contract tier stayed within what the legacy');
      line('model already permitted — which is the evidence that enforcing mode');
      line('would change nothing, for the capabilities exercised so far.');
      line();
      line('Check coverage before concluding it is safe: a capability that never');
      line('ran cannot have disagreed. `npm run capability:coverage`.');
      return;
    }

    line('— Why they disagreed —');
    for (const row of disagreeing) {
      line(`  ${row.capabilityId}`);
      line(`    ${row.sampleRationale ?? '(no rationale recorded)'}`);
      line();
    }

    line('For each of these, decide which it is:');
    line('  (a) the contract is right and the legacy level was optimistic');
    line('      → leave it; enforcing mode will correctly require approval');
    line('  (b) the contract bounds are too loose — usually empty');
    line('      resourcePatterns, which reads as system scope on every call');
    line('      → narrow the declaration in the contract, then re-measure');
  } finally {
    await core.close().catch(() => undefined);
  }
}

void main().then(
  () => process.exit(0),
  (err) => {
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(1);
  },
);
