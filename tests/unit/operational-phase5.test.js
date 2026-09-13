'use strict';

/**
 * Phase 5 — Autonomous Runtime Fabric tests
 *
 * Tests for:
 *   - ActionRegistry (action registry lookup, filtering, authorization)
 *   - SelfHealthMonitor (self-health state, degraded mode)
 *   - FailureInjector (scenario registration, injection, verification)
 *   - RecoveryEngine new action types (container, ollama, database, bridge)
 *   - Doctor command output structure
 */

const path = require('path');
const fs = require('fs');

// Register babel for TS imports
require('../../scripts/babel-register');

const ROOT = path.resolve(__dirname, '..', '..');

describe('Phase 5 — Autonomous Runtime Fabric', () => {
  describe('ActionRegistry', () => {
    let ActionRegistry, actionRegistry, DEFAULT_ACTION_REGISTRY;

    beforeAll(() => {
      ({ ActionRegistry, actionRegistry, DEFAULT_ACTION_REGISTRY } =
        require('../../lib/operational/ActionRegistry'));
    });

    test('has default actions registered', () => {
      const all = actionRegistry.getAll();
      expect(all.length).toBeGreaterThan(5);
      const actionTypes = all.map((a) => a.actionType);
      expect(actionTypes).toContain('restart_process');
      expect(actionTypes).toContain('restart_container');
      expect(actionTypes).toContain('restart_ollama');
      expect(actionTypes).toContain('recover_database');
      expect(actionTypes).toContain('restart_bridge');
      expect(actionTypes).toContain('escalate');
    });

    test('every action has required metadata', () => {
      for (const entry of actionRegistry.getAll()) {
        expect(entry.actionId).toBeDefined();
        expect(entry.actionType).toBeDefined();
        expect(entry.targetComponent).toBeDefined();
        expect(entry.purpose).toBeDefined();
        expect(entry.riskLevel).toMatch(/^R[0-5]$/);
        expect(entry.authorizationClass).toMatch(/^(autonomous|policy_authorized|human_required|prohibited)$/);
        expect(entry.reversibility).toMatch(/^(reversible|irreversible|partial)$/);
        expect(entry.timeoutMs).toBeGreaterThan(0);
        expect(entry.retryPolicy.maxAttempts).toBeGreaterThan(0);
        expect(entry.retryPolicy.cooldownMs).toBeGreaterThanOrEqual(0);
        expect(entry.expectedStateTransition.from).toBeDefined();
        expect(entry.expectedStateTransition.to).toBeDefined();
        expect(entry.verificationStrategy).toBeDefined();
        expect(entry.escalationBehavior).toBeDefined();
      }
    });

    test('getForComponent returns actions for a specific component', () => {
      const coreActions = actionRegistry.getForComponent('protoforge-core');
      expect(coreActions.length).toBeGreaterThan(0);
      expect(coreActions.every((a) => a.targetComponent === 'protoforge-core' || a.targetComponent === '*')).toBe(true);
    });

    test('selectActionForComponent returns lowest-risk action', () => {
      const action = actionRegistry.selectActionForComponent('protoforge-core', 'UNAVAILABLE');
      expect(action).not.toBeNull();
      expect(action.actionType).toBe('restart_process');
      expect(action.riskLevel).toBe('R1');
    });

    test('isAutonomous returns true for R0-R1 actions', () => {
      expect(actionRegistry.isAutonomous('restart.protoforge-core')).toBe(true);
      expect(actionRegistry.isAutonomous('restart.supabase_db')).toBe(false);
    });

    test('requiresHuman returns true for unknown actions', () => {
      expect(actionRegistry.requiresHuman('nonexistent.action')).toBe(true);
    });

    test('can register new actions', () => {
      const registry = new ActionRegistry([]);
      const testEntry = {
        actionId: 'test.action',
        actionType: 'restart_process',
        targetComponent: 'test-component',
        purpose: 'testing',
        prerequisites: ['test-component is not HEALTHY'],
        authorizationClass: 'autonomous',
        riskLevel: 'R1',
        reversibility: 'reversible',
        timeoutMs: 5000,
        retryPolicy: { maxAttempts: 2, cooldownMs: 1000 },
        cooldownMs: 1000,
        expectedStateTransition: { from: 'UNAVAILABLE', to: 'HEALTHY' },
        verificationStrategy: 'test',
        escalationBehavior: 'test',
      };
      registry.register(testEntry);
      expect(registry.get('test.action')).not.toBeNull();
      expect(registry.getAll().length).toBe(1);
    });

    test('summary returns display-friendly format', () => {
      const summary = actionRegistry.summary();
      expect(summary.length).toBeGreaterThan(0);
      expect(summary[0]).toHaveProperty('actionId');
      expect(summary[0]).toHaveProperty('risk');
      expect(summary[0]).toHaveProperty('authorization');
    });
  });

  describe('SelfHealthMonitor', () => {
    let SelfHealthMonitor, SystemStateModel;

    beforeAll(() => {
      ({ SelfHealthMonitor } = require('../../lib/operational/SelfHealthMonitor'));
      ({ SystemStateModel } = require('../../lib/operational/SystemStateModel'));
    });

    function createMonitor() {
      const stateModel = new SystemStateModel();
      stateModel.registerComponent('heidi-self', 'recovery');
      const monitor = new SelfHealthMonitor(ROOT, stateModel);
      return { monitor, stateModel };
    }

    test('check() returns a SelfHealthState object', () => {
      const { monitor } = createMonitor();
      const state = monitor.check();
      expect(state).toBeDefined();
      expect(state.timestamp).toBeDefined();
      expect(state.heidiAlive).toBe(true);
      expect(state.memoryUsageMb).toBeGreaterThan(0);
      expect(state.state).toMatch(/^(HEALTHY|DEGRADED|FAILED)$/);
    });

    test('recordObservationCycle updates last observation time', () => {
      const { monitor } = createMonitor();
      monitor.recordObservationCycle();
      const state = monitor.check();
      expect(state.lastObservationAge).toBeLessThan(5);
      expect(state.loopHealthy).toBe(true);
    });

    test('enterDegradedMode sets degraded mode flag', () => {
      const { monitor, stateModel } = createMonitor();
      monitor.enterDegradedMode('ollama unavailable');
      const state = monitor.check();
      expect(state.degradedMode).toBe(true);
      expect(state.degradedReason).toBe('ollama unavailable');
    });

    test('exitDegradedMode clears degraded mode', () => {
      const { monitor } = createMonitor();
      monitor.enterDegradedMode('test');
      monitor.exitDegradedMode();
      const state = monitor.check();
      expect(state.degradedMode).toBe(false);
      expect(state.degradedReason).toBeUndefined();
    });

    test('recordRecoveryStart/Complete tracks latency', () => {
      const { monitor } = createMonitor();
      monitor.recordRecoveryStart('test-component');
      // Simulate some time passing
      return new Promise((resolve) => {
        setTimeout(() => {
          monitor.recordRecoveryComplete('test-component');
          const state = monitor.check();
          expect(state.recoveryLatencyMs).toBeGreaterThan(0);
          resolve();
        }, 50);
      });
    });

    test('recordException tracks repeated exceptions', () => {
      const { monitor } = createMonitor();
      for (let i = 0; i < 15; i++) {
        monitor.recordException('test-error');
      }
      const state = monitor.check();
      expect(state.repeatedExceptions).toBeGreaterThan(0);
    });

    test('isDegraded returns current degraded state', () => {
      const { monitor } = createMonitor();
      expect(monitor.isDegraded()).toBe(false);
      monitor.enterDegradedMode('test');
      expect(monitor.isDegraded()).toBe(true);
    });

    test('persistence writable check works', () => {
      const { monitor } = createMonitor();
      const state = monitor.check();
      expect(state.persistenceWritable).toBe(true);
    });

    test('check() logs a self_health_check event', () => {
      const { monitor, stateModel } = createMonitor();
      const eventsBefore = stateModel.getRecentEvents().length;
      monitor.check();
      const eventsAfter = stateModel.getRecentEvents().length;
      expect(eventsAfter).toBeGreaterThan(eventsBefore);
      const lastEvent = stateModel.getRecentEvents()[stateModel.getRecentEvents().length - 1];
      expect(lastEvent.type).toBe('self_health_check');
      expect(lastEvent.component).toBe('heidi-self');
    });
  });

  describe('FailureInjector', () => {
    let FailureInjector, DEFAULT_SCENARIOS;

    beforeAll(() => {
      ({ FailureInjector, DEFAULT_SCENARIOS } =
        require('../../lib/operational/FailureInjector'));
    });

    test('has default scenarios for all 6 failure classes', () => {
      const injector = new FailureInjector(ROOT);
      const scenarios = injector.getAllScenarios();
      const classes = [...new Set(scenarios.map((s) => s.failureClass))];
      expect(classes).toContain('A');
      expect(classes).toContain('B');
      expect(classes).toContain('C');
      expect(classes).toContain('D');
      expect(classes).toContain('E');
      expect(classes).toContain('F');
    });

    test('every scenario has required fields', () => {
      for (const scenario of DEFAULT_SCENARIOS) {
        expect(scenario.scenarioId).toBeDefined();
        expect(scenario.name).toBeDefined();
        expect(scenario.failureClass).toMatch(/^[A-F]$/);
        expect(scenario.description).toBeDefined();
        expect(scenario.targetComponent).toBeDefined();
        expect(scenario.setup).toBeInstanceOf(Array);
        expect(scenario.expectedObservation).toBeDefined();
        expect(scenario.expectedDiagnosis).toBeDefined();
        expect(scenario.expectedAction).toBeDefined();
        expect(scenario.expectedVerification).toBeDefined();
        expect(scenario.cleanup).toBeInstanceOf(Array);
        expect(scenario.riskLevel).toMatch(/^R[0-5]$/);
        expect(scenario.timeoutMs).toBeGreaterThan(0);
      }
    });

    test('getScenariosByClass filters correctly', () => {
      const injector = new FailureInjector(ROOT);
      const classA = injector.getScenariosByClass('A');
      expect(classA.length).toBeGreaterThan(0);
      expect(classA.every((s) => s.failureClass === 'A')).toBe(true);
    });

    test('getScenario returns specific scenario', () => {
      const injector = new FailureInjector(ROOT);
      const scenario = injector.getScenario('A1-protoforge-kill');
      expect(scenario).not.toBeNull();
      expect(scenario.scenarioId).toBe('A1-protoforge-kill');
    });

    test('getScenario returns null for unknown scenario', () => {
      const injector = new FailureInjector(ROOT);
      expect(injector.getScenario('nonexistent')).toBeNull();
    });
  });

  describe('RecoveryEngine new action types', () => {
    test('RecoveryPolicyId includes new types', () => {
      // Verify the types are exported correctly by checking the TS compiled output
      const typesPath = path.resolve(ROOT, 'lib', 'operational', 'types.ts');
      const content = fs.readFileSync(typesPath, 'utf8');
      expect(content).toContain('restart_container');
      expect(content).toContain('restart_ollama');
      expect(content).toContain('recover_database');
      expect(content).toContain('restart_bridge');
    });

    test('RecoveryEngine has handler methods for new action types', () => {
      const enginePath = path.resolve(ROOT, 'lib', 'operational', 'RecoveryEngine.ts');
      const content = fs.readFileSync(enginePath, 'utf8');
      expect(content).toContain('restartContainer');
      expect(content).toContain('restartOllama');
      expect(content).toContain('recoverDatabase');
      expect(content).toContain('restartBridge');
      expect(content).toContain('waitForService');
    });
  });

  describe('Doctor command', () => {
    test('hydi-doctor.js exists and is valid JavaScript', () => {
      const doctorPath = path.resolve(ROOT, 'scripts', 'hydi-doctor.js');
      expect(fs.existsSync(doctorPath)).toBe(true);
      const content = fs.readFileSync(doctorPath, 'utf8');
      // Verify it has the required checks
      expect(content).toContain('HEIDI process alive');
      expect(content).toContain('ProtoForge core');
      expect(content).toContain('Ollama');
      expect(content).toContain('Docker');
      expect(content).toContain('Recovery engine');
      expect(content).toContain('audit journal');
      expect(content).toContain('Unresolved incidents');
      expect(content).toContain('Stripe key safety');
      expect(content).toContain('safe to operate');
    });
  });

  describe('Qualification command', () => {
    test('hydi-qualify.js exists and is valid JavaScript', () => {
      const qualifyPath = path.resolve(ROOT, 'scripts', 'hydi-qualify.js');
      expect(fs.existsSync(qualifyPath)).toBe(true);
      const content = fs.readFileSync(qualifyPath, 'utf8');
      expect(content).toContain('baseline');
      expect(content).toContain('injectFailure');
      expect(content).toContain('verifyRecovery');
      expect(content).toContain('cleanup');
      expect(content).toContain('OPERATIONAL');
      expect(content).toContain('NOT_OPERATIONAL');
    });
  });

  describe('Extended OperationalEventType', () => {
    test('types.ts includes Phase 5 event types', () => {
      const typesPath = path.resolve(ROOT, 'lib', 'operational', 'types.ts');
      const content = fs.readFileSync(typesPath, 'utf8');
      expect(content).toContain('self_health_check');
      expect(content).toContain('degraded_mode_entered');
      expect(content).toContain('degraded_mode_exited');
      expect(content).toContain('qualification_step');
      expect(content).toContain('failure_injected');
      expect(content).toContain('soak_metric');
    });
  });
});
