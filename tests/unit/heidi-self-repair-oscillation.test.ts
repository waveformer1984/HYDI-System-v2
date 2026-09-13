/**
 * Oscillation detection test for HEIDI's self-repair loop.
 *
 * This test simulates the scenario where two capabilities perturb each
 * other: repairing capability A breaks capability B, and repairing B
 * breaks A again. Each individual cycle stays well under the per-cycle
 * repair cap, but the system oscillates indefinitely across cycles.
 *
 * Without a cross-cycle flapping guardrail, this produces:
 *   - Infinite repair attempts (1 per cycle, under the per-cycle cap)
 *   - Repair history showing a repeating A→B→A→B pattern
 *   - Audit log looking like healthy ongoing self-repair activity
 *   - No convergence, no escalation, no detection
 *
 * With the flapping guardrail, after N repairs to the same capability
 * that don't stick (capability goes unhealthy again within M cycles),
 * the engine should stop auto-repairing and flag it as flapping.
 */

import {
  CapabilityHealthManager,
  type CapabilityProbe,
  type CapabilityHealthState,
  type BlockerClassification,
} from '../../lib/operational/CapabilityHealthManager';
import { SelfRepairEngine } from '../../lib/operational/SelfRepairEngine';

// ─── Mock capability state ───────────────────────────────────────────────

/**
 * Mutable mock state for a capability. The test flips these to simulate
 * perturbation across repair cycles.
 */
interface MockCapState {
  state: CapabilityHealthState;
  evidence: string;
  failureClassification: BlockerClassification;
}

/**
 * Create a mock probe that reads from a mutable state object.
 * The test can flip the state between READY and BLOCKED to simulate
 * perturbation from another capability's repair handler.
 */
function createMockProbe(
  capabilityId: string,
  stateRef: MockCapState,
): CapabilityProbe {
  return {
    capabilityId,
    description: `Mock capability ${capabilityId}`,
    provider: 'mock',
    dependencies: [],
    requiredCredentials: [],
    requiredAuthorization: 'R0',
    verificationProcedure: 'Check mock state',
    recoveryProcedure: `Repair ${capabilityId}`,
    async probe() {
      return {
        state: stateRef.state,
        evidence: stateRef.evidence,
        lastSuccessfulVerification:
          stateRef.state === 'READY' ? new Date().toISOString() : undefined,
        lastFailure: stateRef.state !== 'READY' ? new Date().toISOString() : undefined,
        failureClassification: stateRef.failureClassification,
      };
    },
  };
}

describe('Self-repair oscillation detection', () => {
  test('WITHOUT guardrail: two perturbing capabilities oscillate indefinitely', async () => {
    // This test documents the gap: without a flapping guardrail, the
    // system oscillates forever, each cycle doing 1 repair (under the
    // per-cycle cap of 5), never converging.
    //
    // We use a SelfRepairEngine WITHOUT the flapping guardrail to
    // demonstrate the gap. The engine is constructed with default
    // options (no flapping detection).

    const capAState: MockCapState = {
      state: 'BLOCKED',
      evidence: 'Capability A is down',
      failureClassification: 'CONFIGURATION_BUG',
    };
    const capBState: MockCapState = {
      state: 'READY',
      evidence: 'Capability B is up',
      failureClassification: 'NOT_BLOCKED',
    };

    const chm = new CapabilityHealthManager();
    chm.registerProbe(createMockProbe('test.capA', capAState));
    chm.registerProbe(createMockProbe('test.capB', capBState));

    const sre = new SelfRepairEngine();

    // Register repair handlers that perturb each other:
    // Repairing A flips B to BLOCKED, repairing B flips A to BLOCKED.
    sre.registerRepairHandler('test.capA', async () => {
      // "Repair" A → set A to READY, but break B
      capAState.state = 'READY';
      capAState.evidence = 'A repaired';
      capAState.failureClassification = 'NOT_BLOCKED';
      // Perturbation: break B
      capBState.state = 'BLOCKED';
      capBState.evidence = 'B broken by A repair';
      capBState.failureClassification = 'CONFIGURATION_BUG';
      return { success: true, evidence: 'A repaired (B perturbed)' };
    });
    sre.registerRepairHandler('test.capB', async () => {
      // "Repair" B → set B to READY, but break A
      capBState.state = 'READY';
      capBState.evidence = 'B repaired';
      capBState.failureClassification = 'NOT_BLOCKED';
      // Perturbation: break A
      capAState.state = 'BLOCKED';
      capAState.evidence = 'A broken by B repair';
      capAState.failureClassification = 'CONFIGURATION_BUG';
      return { success: true, evidence: 'B repaired (A perturbed)' };
    });

    // Simulate 20 self-sufficiency cycles
    const cycleResults: Array<{
      cycle: number;
      repaired: number;
      capAState: string;
      capBState: string;
      repairs: string[];
    }> = [];

    for (let cycle = 0; cycle < 20; cycle++) {
      const summary = await chm.checkAll();
      const result = await sre.runSelfRepair(summary);
      cycleResults.push({
        cycle,
        repaired: result.repaired,
        capAState: capAState.state,
        capBState: capBState.state,
        repairs: result.repairs.map((r) => `${r.capabilityId}:${r.plannedAction}`),
      });
    }

    // ─── Assert the oscillation pattern ───────────────────────────

    // Count how many times each capability was repaired
    const history = sre.getHistory();
    const aRepairs = history.filter(
      (r) => r.capabilityId === 'test.capA' && r.executed && r.verified,
    );
    const bRepairs = history.filter(
      (r) => r.capabilityId === 'test.capB' && r.executed && r.verified,
    );

    // Without a guardrail, both capabilities get repaired many times
    // (alternating), never converging.
    expect(aRepairs.length).toBeGreaterThan(5);
    expect(bRepairs.length).toBeGreaterThan(5);

    // The pattern should be alternating: A repaired, then B, then A, ...
    // Verify by checking the repair history order
    const actualRepairs = history.filter((r) => r.executed && r.verified);
    for (let i = 1; i < actualRepairs.length; i++) {
      const prev = actualRepairs[i - 1].capabilityId;
      const curr = actualRepairs[i].capabilityId;
      expect(prev).not.toBe(curr); // Should alternate
    }

    // The system never reaches a stable state where both are READY
    // at the end of a cycle
    const lastCycle = cycleResults[cycleResults.length - 1];
    const bothReady = lastCycle.capAState === 'READY' && lastCycle.capBState === 'READY';
    expect(bothReady).toBe(false);

    // Each cycle does at most 1 repair (well under the per-cycle cap of 5)
    // — the per-cycle cap does NOT catch this
    const maxRepairsPerCycle = Math.max(...cycleResults.map((c) => c.repaired));
    expect(maxRepairsPerCycle).toBeLessThanOrEqual(1);

    // Total repairs across 20 cycles should be high (oscillating)
    const totalRepairs = cycleResults.reduce((sum, c) => sum + c.repaired, 0);
    expect(totalRepairs).toBeGreaterThan(10);

    // Document the gap: no flapping detection exists
    // (This assertion will need to change when the guardrail is added)
    const flappingRepairs = history.filter((r) =>
      r.plannedAction.includes('FLAPPING') || r.plannedAction.includes('flapping'),
    );
    // Without the guardrail, there are zero flapping detections
    expect(flappingRepairs.length).toBe(0);
  });

  test('WITH guardrail: flapping is detected and auto-repair stops after threshold', async () => {
    // This test verifies the flapping guardrail works: after a capability
    // has been repaired and gone unhealthy again more than N times within
    // M cycles, the engine stops auto-repairing it and flags it as
    // flapping instead of continuing to retry.

    const capAState: MockCapState = {
      state: 'BLOCKED',
      evidence: 'Capability A is down',
      failureClassification: 'CONFIGURATION_BUG',
    };
    const capBState: MockCapState = {
      state: 'READY',
      evidence: 'Capability B is up',
      failureClassification: 'NOT_BLOCKED',
    };

    const chm = new CapabilityHealthManager();
    chm.registerProbe(createMockProbe('test.capA', capAState));
    chm.registerProbe(createMockProbe('test.capB', capBState));

    // Construct with flapping detection enabled:
    // - flappingThreshold: 3 (after 3 repairs that don't stick, flag as flapping)
    // - flappingWindowCycles: 10 (look back over the last 10 cycles)
    const sre = new SelfRepairEngine({
      flappingThreshold: 3,
      flappingWindowCycles: 10,
    });

    // Same perturbing handlers as the previous test
    sre.registerRepairHandler('test.capA', async () => {
      capAState.state = 'READY';
      capAState.evidence = 'A repaired';
      capAState.failureClassification = 'NOT_BLOCKED';
      capBState.state = 'BLOCKED';
      capBState.evidence = 'B broken by A repair';
      capBState.failureClassification = 'CONFIGURATION_BUG';
      return { success: true, evidence: 'A repaired (B perturbed)' };
    });
    sre.registerRepairHandler('test.capB', async () => {
      capBState.state = 'READY';
      capBState.evidence = 'B repaired';
      capBState.failureClassification = 'NOT_BLOCKED';
      capAState.state = 'BLOCKED';
      capAState.evidence = 'A broken by B repair';
      capAState.failureClassification = 'CONFIGURATION_BUG';
      return { success: true, evidence: 'B repaired (A perturbed)' };
    });

    // Simulate 20 cycles
    const cycleResults: Array<{
      cycle: number;
      repaired: number;
      escalated: number;
      capAState: string;
      capBState: string;
    }> = [];

    for (let cycle = 0; cycle < 20; cycle++) {
      const summary = await chm.checkAll();
      const result = await sre.runSelfRepair(summary);
      cycleResults.push({
        cycle,
        repaired: result.repaired,
        escalated: result.escalated,
        capAState: capAState.state,
        capBState: capBState.state,
      });
    }

    const history = sre.getHistory();

    // After the threshold is hit, the engine should stop repairing and
    // escalate/flag as flapping. Count actual repairs vs flapping flags.
    const actualRepairs = history.filter(
      (r) => r.executed && r.verified && !r.plannedAction.includes('FLAPPING'),
    );
    const flappingFlags = history.filter(
      (r) => r.plannedAction.includes('FLAPPING'),
    );

    // The guardrail should have detected flapping for both capabilities
    expect(flappingFlags.length).toBeGreaterThan(0);

    // Total actual repairs should be bounded — after 3 repairs per
    // capability (6 total), both should be flagged as flapping
    expect(actualRepairs.length).toBeLessThanOrEqual(6);

    // After the guardrail kicks in, later cycles should show escalated
    // (flapping) rather than repaired
    const laterCycles = cycleResults.slice(10);
    const laterRepairs = laterCycles.reduce((sum, c) => sum + c.repaired, 0);
    const laterEscalations = laterCycles.reduce((sum, c) => sum + c.escalated, 0);
    expect(laterRepairs).toBe(0);
    expect(laterEscalations).toBeGreaterThan(0);
  });

  test('guardrail does not trigger for a capability that is repaired once and stays healthy', async () => {
    // The guardrail should NOT trigger false positives: if a capability
    // is repaired once and stays READY, it should not be flagged as
    // flapping.

    const capState: MockCapState = {
      state: 'BLOCKED',
      evidence: 'Capability is down',
      failureClassification: 'CONFIGURATION_BUG',
    };

    const chm = new CapabilityHealthManager();
    chm.registerProbe(createMockProbe('test.stable', capState));

    const sre = new SelfRepairEngine({
      flappingThreshold: 3,
      flappingWindowCycles: 10,
    });

    // Repair handler that fixes the capability permanently
    sre.registerRepairHandler('test.stable', async () => {
      capState.state = 'READY';
      capState.evidence = 'Repaired permanently';
      capState.failureClassification = 'NOT_BLOCKED';
      return { success: true, evidence: 'Repaired' };
    });

    // Run 10 cycles
    for (let cycle = 0; cycle < 10; cycle++) {
      const summary = await chm.checkAll();
      await sre.runSelfRepair(summary);
    }

    const history = sre.getHistory();
    const actualRepairs = history.filter(
      (r) => r.capabilityId === 'test.stable' && r.executed && r.verified,
    );
    const flappingFlags = history.filter(
      (r) => r.capabilityId === 'test.stable' && r.plannedAction.includes('FLAPPING'),
    );

    // Should have exactly 1 repair (cycle 0), then stay READY
    expect(actualRepairs.length).toBe(1);
    // No flapping flag
    expect(flappingFlags.length).toBe(0);
  });
});
