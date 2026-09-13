/**
 * HYDI G14 Ownership Policy Qualification
 *
 * tests/qualification/test-g14-ownership-policy.ts
 *
 * Verifies that the G14 git cleanliness gate correctly classifies repository
 * modifications using the version-controlled ownership policy, and that
 * the policy cannot be bypassed to hide dangerous changes.
 *
 * 10 invariants:
 *   G14-01 — Qualification artifacts do not cause G14 failure
 *   G14-02 — Known persistent user workspace does not cause G14 failure
 *   G14-03 — Unknown modified source file DOES cause G14 failure
 *   G14-04 — Unknown untracked source file DOES cause G14 failure
 *   G14-05 — Modified HYDI safety code DOES cause G14 failure
 *   G14-06 — Modified governance code DOES cause G14 failure
 *   G14-07 — Modified release-gate logic DOES cause G14 failure
 *   G14-08 — Generated runtime artifacts are handled correctly
 *   G14-09 — Classification cannot be bypassed through filename tricks
 *   G14-10 — The policy itself is version-controlled and auditable
 */

import fs from 'fs';
import path from 'path';

// ─── Results tracking ─────────────────────────────────────────────
interface G14Result {
  id: string;
  invariant: string;
  status: 'PASS' | 'FAIL';
  detail: string;
}

const results: G14Result[] = [];
let passed = 0;
let failed = 0;

function assert(id: string, invariant: string, condition: boolean, detail: string): void {
  const status = condition ? 'PASS' : 'FAIL';
  results.push({ id, invariant, status, detail });
  const icon = status === 'PASS' ? '✓' : '✗';
  console.log(`  ${icon} ${id}: ${status} — ${detail}`);
  if (condition) passed++;
  else failed++;
}

// ─── Load policy ──────────────────────────────────────────────────
const policyPath = path.join(process.cwd(), 'hydi-g14-ownership-policy.json');
const policy = JSON.parse(fs.readFileSync(policyPath, 'utf8'));

// ─── Classification helpers (mirror G14 implementation) ───────────
function matchesPattern(filePath: string, pat: string): boolean {
  const fp = filePath.replace(/^\.\//, '');
  const p = pat.replace(/^\.\//, '');
  if (p.endsWith('/')) return fp.startsWith(p) || fp === p.slice(0, -1);
  if (p.includes('*')) {
    const regexStr = '^' + p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*') + '$';
    return new RegExp(regexStr).test(fp);
  }
  return fp === p;
}

function isProtected(filePath: string): boolean {
  return policy.protectedPaths.some((p: string) => matchesPattern(filePath, p));
}

function isUserWorkspace(filePath: string): boolean {
  return policy.userWorkspacePaths.some((p: string) => matchesPattern(filePath, p));
}

function isGenerated(filePath: string): boolean {
  return policy.generatedOutputPatterns.some((p: string) => matchesPattern(filePath, p));
}

function isTransient(filePath: string): boolean {
  return policy.transientPatterns.some((p: string) => matchesPattern(filePath, p));
}

function classify(filePath: string): string {
  if (isProtected(filePath)) return 'PROTECTED';
  if (isUserWorkspace(filePath)) return 'USER_OWNED';
  if (isGenerated(filePath)) return 'GENERATED';
  if (isTransient(filePath)) return 'TRANSIENT';
  return 'UNKNOWN';
}

// ─── Tests ────────────────────────────────────────────────────────

console.log('\n═══════════════════════════════════════════════════════════════');
console.log('  G14 OWNERSHIP POLICY QUALIFICATION');
console.log('═══════════════════════════════════════════════════════════════\n');

// G14-01: Qualification artifacts do not cause G14 failure
{
  const testFiles = [
    'hydi-phase10-soak-24h-results.json',
    'hydi-phase8-security-results.json',
    'hydi-phase9-soak-results.json',
    'hydi-preflight-smoke-results.json',
    'hydi-phase1-worktree-audit.json',
    'HYDI_PRODUCTION_RELEASE_GATE.json',
    'HYDI_PRODUCTION_RELEASE_GATE.md',
    'HYDI_FINAL_RELEASE_STATUS.json',
    'HYDI_FINAL_RELEASE_STATUS.md',
  ];
  const allGenerated = testFiles.every((f) => classify(f) === 'GENERATED');
  assert('G14-01', 'Qualification artifacts do not cause G14 failure', allGenerated,
    `${testFiles.length} qualification artifacts classified as GENERATED`);
}

// G14-02: Known persistent user workspace does not cause G14 failure
{
  const testFiles = [
    'HEIDI_REAL_COGNITIVE_CYCLE_REPORT.md',
    'protoforge-applications/rezonate/src/persistence/supabase-store.js',
    'protoforge-applications/rezonate/src/storage/local-storage-provider.js',
    'protoforge-applications/rezonate/tests/storage-provider.test.js',
    'docs/REZONATE_CANONICAL_PATH.md',
    'docs/HEIDI_REZONATE_FINAL_REPORT.md',
    'HARD_ACCEPTANCE_AUDIT_REPORT.md',
    'HEIDI_STATE_OF_THE_SYSTEM.md',
    'scripts/audit-db.js',
    'scripts/check-daemon-state.ps1',
    '.github/workflows/rezonate-capability-contract.yml',
    'data/awareness/reflections.json',
    'data/memory/reflective_memory.json',
  ];
  const allUserOwned = testFiles.every((f) => classify(f) === 'USER_OWNED');
  assert('G14-02', 'Known persistent user workspace does not cause G14 failure', allUserOwned,
    `${testFiles.length} user workspace files classified as USER_OWNED`);
}

// G14-03: Unknown modified source file DOES cause G14 failure
{
  const testFile = 'src/new-feature.ts';
  const classification = classify(testFile);
  assert('G14-03', 'Unknown modified source file DOES cause G14 failure',
    classification === 'UNKNOWN',
    `src/new-feature.ts classified as ${classification} (expected UNKNOWN)`);
}

// G14-04: Unknown untracked source file DOES cause G14 failure
{
  const testFile = 'lib/new-module/index.ts';
  const classification = classify(testFile);
  assert('G14-04', 'Unknown untracked source file DOES cause G14 failure',
    classification === 'UNKNOWN',
    `lib/new-module/index.ts classified as ${classification} (expected UNKNOWN)`);
}

// G14-05: Modified HYDI safety code DOES cause G14 failure
{
  const testFiles = [
    'lib/heidi/CognitiveCore.ts',
    'lib/heidi/HumanActionEngine.ts',
    'lib/heidi/AdaptiveOperator.ts',
  ];
  const allProtected = testFiles.every((f) => classify(f) === 'PROTECTED');
  assert('G14-05', 'Modified HYDI safety code DOES cause G14 failure', allProtected,
    `${testFiles.length} safety code files classified as PROTECTED`);
}

// G14-06: Modified governance code DOES cause G14 failure
{
  const testFiles = [
    'lib/protoforge/policy-engine.js',
    'lib/protoforge/auto-gate.js',
    'kilo/index.js',
    'cascade/index.js',
  ];
  const allProtected = testFiles.every((f) => classify(f) === 'PROTECTED');
  assert('G14-06', 'Modified governance code DOES cause G14 failure', allProtected,
    `${testFiles.length} governance code files classified as PROTECTED`);
}

// G14-07: Modified release-gate logic DOES cause G14 failure
{
  const testFiles = [
    'scripts/production-release-gate.ts',
    'scripts/soak-24h-harness.ts',
    'tests/qualification/test-security-boundaries.ts',
    'tests/qualification/test-g14-ownership-policy.ts',
  ];
  const allProtected = testFiles.every((f) => classify(f) === 'PROTECTED');
  assert('G14-07', 'Modified release-gate logic DOES cause G14 failure', allProtected,
    `${testFiles.length} release-gate files classified as PROTECTED`);
}

// G14-08: Generated runtime artifacts are handled correctly
{
  const testFiles = [
    'tmp-debug-output.txt',
    '_boot2.txt',
    '.commit-msg-temp.txt',
  ];
  const allTransient = testFiles.every((f) => classify(f) === 'TRANSIENT');
  assert('G14-08', 'Generated runtime artifacts are handled correctly', allTransient,
    `${testFiles.length} transient files classified as TRANSIENT`);
}

// G14-09: Classification cannot be bypassed through filename tricks
{
  // A file that looks like user workspace but is actually in a protected path
  const trickFiles = [
    'lib/protoforge/REZONATE_CANONICAL_PATH.md',  // protected path, user-workspace filename
    'api/HEIDI_STATE_OF_THE_SYSTEM.md',            // protected path, user-workspace filename
    'kilo/audit-db.js',                             // protected path, user-workspace filename
    'workers/check-daemon-state.ps1',               // protected path, user-workspace filename
  ];
  const allProtected = trickFiles.every((f) => classify(f) === 'PROTECTED');
  assert('G14-09', 'Classification cannot be bypassed through filename tricks', allProtected,
    `${trickFiles.length} filename-trick files correctly classified as PROTECTED (protectedPaths takes precedence)`);
}

// G14-10: The policy itself is version-controlled and auditable
{
  const policyExists = fs.existsSync(policyPath);
  const hasVersion = typeof policy.version === 'number';
  const hasProtectedPaths = Array.isArray(policy.protectedPaths) && policy.protectedPaths.length > 0;
  const hasUserWorkspacePaths = Array.isArray(policy.userWorkspacePaths) && policy.userWorkspacePaths.length > 0;
  const hasGeneratedOutputPatterns = Array.isArray(policy.generatedOutputPatterns);
  const hasTransientPatterns = Array.isArray(policy.transientPatterns);
  const hasUnknownPolicy = typeof policy.unknownPolicy === 'string' && policy.unknownPolicy.includes('UNKNOWN');
  const hasPrecedenceRules = Array.isArray(policy.precedenceRules) && policy.precedenceRules.length >= 5;
  const policyIsProtected = isProtected('hydi-g14-ownership-policy.json');

  const allValid = policyExists && hasVersion && hasProtectedPaths && hasUserWorkspacePaths &&
    hasGeneratedOutputPatterns && hasTransientPatterns && hasUnknownPolicy && hasPrecedenceRules &&
    policyIsProtected;

  assert('G14-10', 'The policy itself is version-controlled and auditable', allValid,
    `Policy exists=${policyExists}, version=${hasVersion}, protected=${policyIsProtected}, has all sections=${allValid}`);
}

// ─── Summary ──────────────────────────────────────────────────────
console.log('\n═══════════════════════════════════════════════════════════════');
console.log(`  G14 OWNERSHIP POLICY: ${passed} passed, ${failed} failed`);
console.log('═══════════════════════════════════════════════════════════════\n');

if (failed > 0) {
  console.log('FAILED INVARIANTS:');
  results.filter((r) => r.status === 'FAIL').forEach((r) => {
    console.log(`  ✗ ${r.id}: ${r.invariant} — ${r.detail}`);
  });
}

// Write results JSON
const resultsPath = path.join(process.cwd(), 'hydi-g14-ownership-policy-results.json');
fs.writeFileSync(resultsPath, JSON.stringify({
  test: 'g14-ownership-policy',
  timestamp: new Date().toISOString(),
  passed,
  failed,
  results,
}, null, 2));

process.exit(failed > 0 ? 1 : 0);
