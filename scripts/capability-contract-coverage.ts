/**
 * Migration status for the CognitiveCore contract layer.
 *
 * Which capabilities verify from a contract, which still fall through to the
 * legacy if-chain, and which contracts have no observer and would therefore
 * report `unverifiable` at run time.
 *
 * Run: npm run capability:coverage
 */

import { CognitiveCore } from '../lib/heidi/CognitiveCore';

const core = new CognitiveCore();
const coverage = core.contractCoverage();

const line = (s = '') => process.stdout.write(s + '\n');

line('CognitiveCore contract coverage');
line('='.repeat(60));
line(`authority mode:      ${coverage.mode}`);
line(`contract-verified:   ${coverage.contracted.length}`);
line(`legacy if-chain:     ${coverage.legacyFallback.length}`);
line(`unobservable:        ${coverage.unobservable.length}`);
line();

if (coverage.unobservable.length > 0) {
  line('— No observer registered (would report unverifiable) —');
  for (const id of coverage.unobservable) line(`  ${id}`);
  line();
  line('  NOTE: this script builds a CognitiveCore with no ExecutionBridge, so the');
  line('  `process` observer (operationalIntelligence / revenueLifecycle) is not');
  line('  registered. Under a real boot those dependencies exist and these become');
  line('  observable. An empty list here would be the surprising result, not this one.');
  line();
}

line('— Still verified by the legacy chain —');
for (const id of coverage.legacyFallback.slice().sort()) line(`  ${id}`);
line();
line('Each of these falls through to `verified: exec.outcome === "success"`,');
line('i.e. the executor marking its own homework. Writing a contract is what');
line('replaces that with a real predicate.');

void core.close().then(() => process.exit(0)).catch(() => process.exit(0));
