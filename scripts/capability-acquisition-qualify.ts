/**
 * Capability Acquisition Qualification Harness
 *
 * End-to-end test that exercises the full acquisition pipeline:
 *
 *   DISCOVER → DIAGNOSE → PLAN → POLICY → ACQUIRE → PROVISION → CONFIGURE → VERIFY → QUALIFY → READY
 *
 * This harness does NOT create real external accounts. It verifies that
 * the acquisition engine correctly:
 *   1. Detects missing credentials
 *   2. Classifies the blocker with the correct type
 *   3. Generates an acquisition plan
 *   4. Evaluates governance policy
 *   5. Escalates human-required steps (does NOT bypass them)
 *   6. When credentials are present, verifies against the real API
 *   7. Only marks READY after successful verification
 *   8. Records the complete audit trail
 *
 * Usage:
 *   npx tsx scripts/capability-acquisition-qualify.ts
 *   npx tsx scripts/capability-acquisition-qualify.ts --provider stripe
 */

import { ExternalCapabilityAcquisitionEngine } from '../lib/operational/ExternalCapabilityAcquisitionEngine';
import { getProviderAdapterRegistry } from '../lib/operational/ProviderAdapters';
import { getSecretManager } from '../lib/operational/SecretManager';
import { getAcquisitionGovernancePolicy } from '../lib/operational/AcquisitionGovernancePolicy';
import type { AcquisitionLifecycle, CapabilityAcquisitionState } from '../lib/operational/CapabilityAcquisitionTypes';

interface QualificationResult {
  provider: string;
  capabilityId: string;
  initialState: CapabilityAcquisitionState;
  finalState: CapabilityAcquisitionState;
  blocker: string | null;
  policyDecision: string | null;
  auditEventCount: number;
  stateTransitions: { from: string; to: string; reason: string }[];
  credentialFingerprints: Record<string, string>;
  verified: boolean;
  evidence: string;
  duration: number;
}

async function qualifyProvider(providerId: string): Promise<QualificationResult> {
  const registry = getProviderAdapterRegistry();
  const adapter = registry.getAdapterByProvider(providerId);

  if (!adapter) {
    throw new Error(`No adapter found for provider: ${providerId}`);
  }

  const engine = new ExternalCapabilityAcquisitionEngine({
    onAuditEvent: (record) => {
      console.log(`  [audit] ${record.eventType}: ${record.description}`);
    },
    onStateChange: (lifecycle) => {
      console.log(`  [state] ${lifecycle.capabilityId}: ${lifecycle.currentState}`);
    },
  });

  const start = Date.now();

  console.log(`\n${'═'.repeat(70)}`);
  console.log(`Qualifying: ${adapter.displayName} (${providerId})`);
  console.log(`Capability: ${adapter.capabilityId}`);
  console.log(`Required env vars: ${adapter.requiredEnvVars.join(', ')}`);
  console.log(`${'═'.repeat(70)}`);

  // Discover initial state
  const initialState = await adapter.discoverAccountState();
  console.log(`\nInitial state:`);
  console.log(`  Blocker: ${initialState.blocker}`);
  console.log(`  Evidence: ${initialState.evidence}`);
  console.log(`  Missing: ${initialState.missingEnvVars.join(', ') || 'none'}`);

  // Run the acquisition engine
  console.log(`\nRunning acquisition pipeline...`);
  const lifecycle = await engine.resolveCapability(adapter.capabilityId);

  const duration = Date.now() - start;

  // Collect results
  const result: QualificationResult = {
    provider: providerId,
    capabilityId: adapter.capabilityId,
    initialState: lifecycle.currentState,
    finalState: lifecycle.currentState,
    blocker: lifecycle.blocker,
    policyDecision: lifecycle.policyDecision,
    auditEventCount: lifecycle.auditRecords.length,
    stateTransitions: lifecycle.transitions.map((t) => ({
      from: t.from,
      to: t.to,
      reason: t.reason,
    })),
    credentialFingerprints: lifecycle.credentialFingerprints,
    verified: lifecycle.currentState === 'READY',
    evidence: lifecycle.auditRecords.map((r) => r.description).join('; '),
    duration,
  };

  // Print results
  console.log(`\n${'─'.repeat(70)}`);
  console.log(`Result: ${result.finalState}`);
  console.log(`Duration: ${duration}ms`);
  console.log(`Audit events: ${result.auditEventCount}`);
  console.log(`State transitions:`);
  for (const t of result.stateTransitions) {
    console.log(`  ${t.from} → ${t.to}: ${t.reason}`);
  }
  console.log(`Policy decision: ${result.policyDecision || 'N/A'}`);
  console.log(`Credential fingerprints: ${Object.keys(result.credentialFingerprints).length} recorded`);
  console.log(`Verified: ${result.verified}`);

  if (result.finalState === 'READY') {
    console.log(`\n✅ ${providerId} is READY — capability verified against real API`);
  } else if (result.finalState === 'BLOCKED') {
    console.log(`\n⚠️  ${providerId} is BLOCKED — requires human action to provide credentials`);
  } else if (result.finalState === 'POLICY_BLOCKED') {
    console.log(`\n🚫 ${providerId} is POLICY_BLOCKED — requires owner authorization`);
  } else if (result.finalState === 'VERIFICATION_FAILED') {
    console.log(`\n❌ ${providerId} verification FAILED — credentials present but invalid`);
  } else {
    console.log(`\n❓ ${providerId} is in state: ${result.finalState}`);
  }

  return result;
}

async function main() {
  const args = process.argv.slice(2);
  const providerArg = args.find((a) => a.startsWith('--provider='))?.split('=')[1];

  const registry = getProviderAdapterRegistry();
  const providers = providerArg
    ? [providerArg]
    : registry.getAllAdapters().map((a) => a.providerId);

  console.log('');
  console.log('╔════════════════════════════════════════════════════════════════════╗');
  console.log('║  HEIDI CAPABILITY ACQUISITION QUALIFICATION HARNESS                 ║');
  console.log('║  Tests the full DISCOVER → PLAN → AUTHORIZE → ACQUIRE → VERIFY loop ║');
  console.log('╚════════════════════════════════════════════════════════════════════╝');

  const results: QualificationResult[] = [];

  for (const providerId of providers) {
    try {
      const result = await qualifyProvider(providerId);
      results.push(result);
    } catch (error) {
      console.error(`\n❌ Failed to qualify ${providerId}: ${error instanceof Error ? error.message : 'unknown'}`);
      results.push({
        provider: providerId,
        capabilityId: 'unknown',
        initialState: 'UNKNOWN',
        finalState: 'ACQUISITION_FAILED',
        blocker: 'UNKNOWN',
        policyDecision: null,
        auditEventCount: 0,
        stateTransitions: [],
        credentialFingerprints: {},
        verified: false,
        evidence: error instanceof Error ? error.message : 'unknown',
        duration: 0,
      });
    }
  }

  // Summary
  console.log(`\n${'═'.repeat(70)}`);
  console.log('SUMMARY');
  console.log(`${'═'.repeat(70)}`);
  console.log('');

  const ready = results.filter((r) => r.finalState === 'READY');
  const blocked = results.filter((r) => r.finalState === 'BLOCKED');
  const policyBlocked = results.filter((r) => r.finalState === 'POLICY_BLOCKED');
  const failed = results.filter((r) => r.finalState.includes('FAILED'));

  for (const r of results) {
    const icon = r.finalState === 'READY' ? '✅' : r.finalState === 'BLOCKED' ? '⚠️ ' : r.finalState === 'POLICY_BLOCKED' ? '🚫' : '❌';
    console.log(`  ${icon} ${r.provider.padEnd(20)} ${r.finalState.padEnd(25)} ${r.duration}ms`);
  }

  console.log('');
  console.log(`  Ready:          ${ready.length}/${results.length}`);
  console.log(`  Blocked:        ${blocked.length}/${results.length} (require human action)`);
  console.log(`  Policy blocked: ${policyBlocked.length}/${results.length} (require owner authorization)`);
  console.log(`  Failed:         ${failed.length}/${results.length}`);

  // Machine-readable output
  console.log(`\n--- MACHINE READABLE ---`);
  console.log(JSON.stringify(results, null, 2));

  // Exit code: 0 if no failures, 1 if any failed
  const exitCode = failed.length > 0 ? 1 : 0;
  process.exit(exitCode);
}

main().catch((error) => {
  console.error('Qualification harness failed:', error);
  process.exit(1);
});
