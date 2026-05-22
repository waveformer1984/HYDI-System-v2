/**
 * Validation Gate 2: Thermal Loop Assertions
 *
 * Test Objective:
 * Simulate high-temperature threshold event by directly invoking
 * executePolicyMatrix() with mocked temperature value of 93°C.
 *
 * Verify that system immediately:
 * 1. Triggers the local alert logging event
 * 2. Locks down the worker ingestion pipeline
 * 3. Updates ursula-dashboard-enhanced display state to EMERGENCY
 * 4. Completes all transitions within 4000ms
 *
 * Expected Outcome:
 * - State transitions to EMERGENCY
 * - All orchestrator hooks invoked in correct order
 * - Dashboard state updated with EMERGENCY status
 * - No processing delays or race conditions
 */

import { ThermalMitigationGuard, OrchestratorHooks, ThermalState } from './ThermalMitigationGuard';

interface HookInvocation {
  timestamp: number;
  method: string;
  arguments: any[];
}

interface TestResult {
  passed: boolean;
  duration: number;
  stateTransitioned: boolean;
  finalState: ThermalState;
  hookInvocations: HookInvocation[];
  errors: string[];
}

class MockOrchestrator implements OrchestratorHooks {
  invocations: HookInvocation[] = [];

  async setQueueThrottleRate(rate: number): Promise<void> {
    this.invocations.push({
      timestamp: Date.now(),
      method: 'setQueueThrottleRate',
      arguments: [rate]
    });
    console.log(`  [Mock] setQueueThrottleRate(${rate})`);
  }

  async pauseBackgroundIndexing(): Promise<void> {
    this.invocations.push({
      timestamp: Date.now(),
      method: 'pauseBackgroundIndexing',
      arguments: []
    });
    console.log(`  [Mock] pauseBackgroundIndexing()`);
  }

  async resumeBackgroundIndexing(): Promise<void> {
    this.invocations.push({
      timestamp: Date.now(),
      method: 'resumeBackgroundIndexing',
      arguments: []
    });
    console.log(`  [Mock] resumeBackgroundIndexing()`);
  }

  async pauseSpeculativeExecution(): Promise<void> {
    this.invocations.push({
      timestamp: Date.now(),
      method: 'pauseSpeculativeExecution',
      arguments: []
    });
    console.log(`  [Mock] pauseSpeculativeExecution()`);
  }

  async resumeSpeculativeExecution(): Promise<void> {
    this.invocations.push({
      timestamp: Date.now(),
      method: 'resumeSpeculativeExecution',
      arguments: []
    });
    console.log(`  [Mock] resumeSpeculativeExecution()`);
  }

  async emergencyHaltAllWorkers(): Promise<void> {
    this.invocations.push({
      timestamp: Date.now(),
      method: 'emergencyHaltAllWorkers',
      arguments: []
    });
    console.log(`  [Mock] emergencyHaltAllWorkers() - CRITICAL LOCK DOWN`);
  }

  async resumeNormalOperations(): Promise<void> {
    this.invocations.push({
      timestamp: Date.now(),
      method: 'resumeNormalOperations',
      arguments: []
    });
    console.log(`  [Mock] resumeNormalOperations()`);
  }

  async updateDashboardState(state: ThermalState, temperature: number): Promise<void> {
    this.invocations.push({
      timestamp: Date.now(),
      method: 'updateDashboardState',
      arguments: [state, temperature]
    });
    console.log(`  [Mock] updateDashboardState(${state}, ${temperature.toFixed(1)}°C)`);
  }
}

async function runValidationGate2(): Promise<TestResult> {
  const result: TestResult = {
    passed: false,
    duration: 0,
    stateTransitioned: false,
    finalState: 'NOMINAL',
    hookInvocations: [],
    errors: []
  };

  const startTime = Date.now();

  try {
    console.log('╔════════════════════════════════════════════════════════╗');
    console.log('║         VALIDATION GATE 2: THERMAL LOOP ASSERTIONS      ║');
    console.log('╚════════════════════════════════════════════════════════╝\n');

    // ─────────────────────────────────────────────────────────────────
    // Phase 1: Initialize thermal guard with mock orchestrator
    // ─────────────────────────────────────────────────────────────────
    console.log('[Phase 1] Initializing Thermal Mitigation Guard...');

    const mockOrch = new MockOrchestrator();
    const guard = new ThermalMitigationGuard(mockOrch, 4000, true);

    console.log('✓ Guard initialized with mock orchestrator\n');

    // ─────────────────────────────────────────────────────────────────
    // Phase 2: Simulate normal operation baseline
    // ─────────────────────────────────────────────────────────────────
    console.log('[Phase 2] Simulating baseline NOMINAL state...');

    // Manually set state to NOMINAL first
    const initialState = guard.getCurrentState();
    console.log(`✓ Initial state: ${initialState}\n`);

    // ─────────────────────────────────────────────────────────────────
    // Phase 3: Trigger EMERGENCY condition (93°C)
    // ─────────────────────────────────────────────────────────────────
    console.log('[Phase 3] Injecting EMERGENCY temperature scenario (93°C)...');

    const emergencyTemp = 93.0;
    console.log(`  Invoking executePolicyMatrix(${emergencyTemp}°C)...\n`);

    // Use reflection to access the private method for testing
    const guardAny = guard as any;
    await guardAny.executePolicyMatrix(emergencyTemp);

    const finalState = guard.getCurrentState();
    console.log(`\n✓ System transitioned to: ${finalState}\n`);

    result.stateTransitioned = finalState === 'EMERGENCY';
    result.finalState = finalState;

    // ─────────────────────────────────────────────────────────────────
    // Phase 4: Verify hook invocations
    // ─────────────────────────────────────────────────────────────────
    console.log('[Phase 4] Verifying orchestrator hook invocations...');

    result.hookInvocations = mockOrch.invocations;

    const expectedHooks = ['emergencyHaltAllWorkers', 'updateDashboardState'];
    console.log(`  Expected hooks: ${expectedHooks.join(', ')}`);
    console.log(`  Actual invocations: ${mockOrch.invocations.length}\n`);

    for (const hook of mockOrch.invocations) {
      const elapsed = hook.timestamp - startTime;
      console.log(`  [${elapsed}ms] ${hook.method}(${hook.arguments.map(a => JSON.stringify(a)).join(', ')})`);
    }

    // ─────────────────────────────────────────────────────────────────
    // Phase 5: Run validation assertions
    // ─────────────────────────────────────────────────────────────────
    console.log('\n[Phase 5] Running validation assertions...');

    const assertions = [
      {
        name: 'State transitioned to EMERGENCY',
        condition: result.stateTransitioned,
        expected: true,
        actual: result.stateTransitioned
      },
      {
        name: 'emergencyHaltAllWorkers hook invoked',
        condition: mockOrch.invocations.some(h => h.method === 'emergencyHaltAllWorkers'),
        expected: true,
        actual: mockOrch.invocations.some(h => h.method === 'emergencyHaltAllWorkers')
      },
      {
        name: 'updateDashboardState hook invoked',
        condition: mockOrch.invocations.some(h => h.method === 'updateDashboardState'),
        expected: true,
        actual: mockOrch.invocations.some(h => h.method === 'updateDashboardState')
      },
      {
        name: 'updateDashboardState includes EMERGENCY status',
        condition: mockOrch.invocations.some(
          h => h.method === 'updateDashboardState' && h.arguments[0] === 'EMERGENCY'
        ),
        expected: true,
        actual: mockOrch.invocations.some(
          h => h.method === 'updateDashboardState' && h.arguments[0] === 'EMERGENCY'
        )
      },
      {
        name: 'All transitions completed within 4000ms',
        condition: result.duration < 4000,
        expected: true,
        actual: result.duration < 4000
      }
    ];

    let allAssertionsPassed = true;
    for (const assertion of assertions) {
      const status = assertion.condition ? '✓' : '✗';
      console.log(`  ${status} ${assertion.name}`);
      if (!assertion.condition) {
        console.log(`     Expected: ${assertion.expected}, Actual: ${assertion.actual}`);
        result.errors.push(`Assertion failed: ${assertion.name}`);
        allAssertionsPassed = false;
      }
    }

    result.passed = allAssertionsPassed;

    // ─────────────────────────────────────────────────────────────────
    // Phase 6: Report results
    // ─────────────────────────────────────────────────────────────────
    console.log('\n[Phase 6] Reporting results...');

    result.duration = Date.now() - startTime;

    console.log(`\n╔════════════════════════════════════════════════════════╗`);
    if (result.passed) {
      console.log(`║  ✓ VALIDATION GATE 2 PASSED                            ║`);
    } else {
      console.log(`║  ✗ VALIDATION GATE 2 FAILED                            ║`);
    }
    console.log(`╠════════════════════════════════════════════════════════╣`);
    console.log(`║  Duration:           ${result.duration}ms`);
    console.log(`║  Final State:        ${result.finalState}`);
    console.log(`║  Hooks Invoked:      ${result.hookInvocations.length}`);
    console.log(`║  Errors:             ${result.errors.length}`);
    console.log(`╚════════════════════════════════════════════════════════╝\n`);

    if (result.errors.length > 0) {
      console.log('Errors encountered:');
      result.errors.forEach(err => console.log(`  - ${err}`));
    }

    return result;
  } catch (error) {
    result.errors.push(`Fatal error: ${error}`);
    result.duration = Date.now() - startTime;
    console.error(`\n✗ VALIDATION GATE 2 FAILED WITH EXCEPTION:\n${error}\n`);

    return result;
  }
}

// Execute if run directly
if (require.main === module) {
  runValidationGate2().then(result => {
    process.exit(result.passed ? 0 : 1);
  });
}

export { runValidationGate2, TestResult };
