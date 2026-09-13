/**
 * Tests for the real autonomous recovery loop with verification predicates.
 *
 * Tests:
 * 1. Ollama repair handler — idempotent (returns success if already healthy)
 * 2. Ollama repair handler — reports failure when service doesn't come up
 * 3. Stale state repair handler — real state clearing with verification
 * 4. SelfRepairEngine.executeRepair — independent verification overrides handler success
 * 5. SelfRepairEngine.executeRepair — independent verification confirms handler success
 * 6. BlockerResolutionEngine — no handler means escalation, not false resolution
 */

import dotenv from 'dotenv';
import path from 'path';
import fs from 'fs';
import os from 'os';

dotenv.config({ path: path.resolve(__dirname, '../../.env.local') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { SelfRepairEngine, createStaleStateRepairHandler, createOllamaRepairHandler } from '../../lib/operational/SelfRepairEngine';

// ─── Helpers ─────────────────────────────────────────────────────────────

function makeBlockedReport(capabilityId: string, classification: string = 'INFRASTRUCTURE_RUNTIME_PROBLEM'): any {
  return {
    capabilityId,
    description: `Test ${capabilityId}`,
    provider: 'local',
    dependencies: [],
    state: 'UNAVAILABLE',
    evidence: `Unavailable: ${capabilityId}`,
    lastSuccessfulVerification: null,
    lastFailure: new Date().toISOString(),
    failureClassification: classification,
    repairability: 'auto_repairable',
    requiredAuthorization: 'R0',
    requiredCredentials: [],
    recoveryProcedure: 'Restart service',
    verificationProcedure: 'Check health endpoint',
    checkedAt: new Date().toISOString(),
  };
}

function makeSummary(reports: any[]): any {
  return {
    total: reports.length,
    ready: 0,
    degraded: 0,
    blocked: 0,
    unavailable: reports.filter((r) => r.state === 'UNAVAILABLE').length,
    repairable: reports.filter((r) => r.repairability === 'auto_repairable').length,
    humanRequired: 0,
    prohibited: 0,
    unknown: 0,
    reports,
  };
}

// ─── Tests ───────────────────────────────────────────────────────────────

describe('Real autonomous recovery with verification', () => {
  test('1. Ollama repair handler is idempotent — returns success if already healthy', async () => {
    // Mock fetch to return healthy response
    const originalFetch = global.fetch;
    (global as any).fetch = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
    });

    try {
      const handler = createOllamaRepairHandler({ url: 'http://localhost:11434' });
      const result = await handler('system.local_model', 'Start Ollama');

      expect(result.success).toBe(true);
      expect(result.evidence).toContain('already healthy');
    } finally {
      (global as any).fetch = originalFetch;
    }
  });

  test('2. Ollama repair handler reports failure when service does not come up', async () => {
    // Mock fetch to always fail
    const originalFetch = global.fetch;
    (global as any).fetch = jest.fn().mockRejectedValue(new Error('connection refused'));

    try {
      const handler = createOllamaRepairHandler({ url: 'http://localhost:99999' });
      // Use a short timeout to avoid waiting 15s
      const result = await handler('system.local_model', 'Start Ollama');

      // The handler should report failure (service never came up)
      // Note: this test may take ~15s due to the retry loop
      expect(result.success).toBe(false);
      expect(result.evidence).toContain('not responding');
    } finally {
      (global as any).fetch = originalFetch;
    }
  }, 30000);

  test('3. Stale state repair handler performs real state clearing with verification', async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'heidi-stale-'));
    const statePath = path.join(tmpDir, 'stale-runtime.json');
    fs.writeFileSync(statePath, '{"stale": true}', 'utf8');

    const handler = createStaleStateRepairHandler({ statePath });
    const result = await handler('test.capability', 'clear stale state');

    expect(result.success).toBe(true);
    expect(result.evidence).toContain('removed and verified absent');
    expect(fs.existsSync(statePath)).toBe(false);

    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('4. Independent verification overrides handler success (handler lies, verifier catches it)', async () => {
    const sre = new SelfRepairEngine({
      verifyRepair: async (_capabilityId: string) => {
        // Independent verification says the capability is NOT healthy
        return { healthy: false, evidence: 'Capability still UNAVAILABLE after repair' };
      },
    });

    // Register a handler that lies — returns success without doing anything
    sre.registerRepairHandler('test.liar', async () => ({
      success: true,
      evidence: 'Claimed success but did nothing',
    }));

    const summary = makeSummary([makeBlockedReport('test.liar')]);
    const result = await sre.runSelfRepair(summary) as any;

    // The repair should NOT be counted as repaired — verification caught the lie
    expect(result.repaired).toBe(0);
    expect(result.escalated).toBeGreaterThanOrEqual(1);

    // Check the repair action was marked as not verified
    const history = sre.getHistory();
    const repair = history.find((h) => h.capabilityId === 'test.liar' && h.executed);
    expect(repair).toBeDefined();
    expect(repair!.verified).toBe(false);
    expect(repair!.verificationEvidence).toContain('independent verification failed');
  });

  test('5. Independent verification confirms handler success', async () => {
    const sre = new SelfRepairEngine({
      verifyRepair: async (_capabilityId: string) => {
        // Independent verification confirms the capability IS healthy
        return { healthy: true, evidence: 'Capability is READY' };
      },
    });

    sre.registerRepairHandler('test.honest', async () => ({
      success: true,
      evidence: 'Real repair performed',
    }));

    const summary = makeSummary([makeBlockedReport('test.honest')]);
    const result = await sre.runSelfRepair(summary) as any;

    // The repair should be counted as repaired — both handler and verifier agree
    expect(result.repaired).toBe(1);

    const history = sre.getHistory();
    const repair = history.find((h) => h.capabilityId === 'test.honest' && h.executed);
    expect(repair).toBeDefined();
    expect(repair!.verified).toBe(true);
    expect(repair!.verificationEvidence).toContain('independently verified');
  });

  test('6. BlockerResolutionEngine does not falsely count resolved when no handler is available', async () => {
    // This tests the fix for the false "resolved++" bug
    const sre = new SelfRepairEngine();

    // No repair handler registered for 'test.nohandler'
    const summary = makeSummary([makeBlockedReport('test.nohandler')]);
    const result = await sre.runSelfRepair(summary) as any;

    // Should escalate, not repair
    expect(result.repaired).toBe(0);
    expect(result.escalated).toBeGreaterThanOrEqual(1);
  });
});
