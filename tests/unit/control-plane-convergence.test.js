/**
 * Phase 12: Control-plane convergence regression tests
 *
 * Proves that the ungoverned HealthObserver cannot bypass the governed
 * control plane when HYDI_DELEGATE_RECOVERY=true.
 */

const path = require('path');
const fs = require('fs');

// Mock memory interface for HealthObserver
function createMockMemory() {
  const missions = [];
  return {
    createMission: jest.fn(async (goal, priority, context, agent) => {
      const id = missions.length + 1;
      missions.push({ id, goal, priority, context, assigned_agent: agent });
      return id;
    }),
    getMissions: jest.fn(async () => missions),
    updateMission: jest.fn(async () => {}),
    getMissionsCreated: () => missions.length,
  };
}

const TEST_CONFIG_PATH = path.join(__dirname, '..', 'fixtures', 'health-observer-test-config.json');

function writeTestConfig() {
  fs.writeFileSync(TEST_CONFIG_PATH, JSON.stringify({
    modules: [
      {
        id: 'test-module',
        type: 'process',
        enabled: true,
        health: { url: 'http://127.0.0.1:9999/health' },
      },
    ],
  }));
}

function cleanupTestConfig() {
  try { fs.unlinkSync(TEST_CONFIG_PATH); } catch { /* ok */ }
}

describe('Control-Plane Convergence — Phase 12', () => {
  describe('HealthObserver cannot bypass governed control plane', () => {
    beforeEach(() => {
      delete process.env.HYDI_DELEGATE_RECOVERY;
      delete process.env.HEIDI_AUTONOMOUS_ACTIONS;
      jest.resetModules();
      writeTestConfig();
    });

    afterEach(() => {
      delete process.env.HYDI_DELEGATE_RECOVERY;
      delete process.env.HEIDI_AUTONOMOUS_ACTIONS;
      cleanupTestConfig();
    });

    it('does NOT create missions when HYDI_DELEGATE_RECOVERY=true (governed plane active)', async () => {
      process.env.HYDI_DELEGATE_RECOVERY = 'true';
      const HealthObserver = require('../../heidi-core/missions/health-observer');
      const mockMemory = createMockMemory();

      const observer = new HealthObserver(mockMemory, {
        configPath: TEST_CONFIG_PATH,
        intervalMs: 999999,
        probeTimeoutMs: 1000,
        debounceFailures: 1,
        cooldownMs: 0,
        log: () => {},
      });

      await observer.tick();

      expect(mockMemory.getMissionsCreated()).toBe(0);
      expect(mockMemory.createMission).not.toHaveBeenCalled();
    });

    it('CAN create missions when HYDI_DELEGATE_RECOVERY is not set (fallback mode)', async () => {
      const HealthObserver = require('../../heidi-core/missions/health-observer');
      const mockMemory = createMockMemory();

      const observer = new HealthObserver(mockMemory, {
        configPath: TEST_CONFIG_PATH,
        intervalMs: 999999,
        probeTimeoutMs: 1000,
        debounceFailures: 1,
        cooldownMs: 0,
        log: () => {},
      });

      await observer.tick();

      expect(mockMemory.getMissionsCreated()).toBe(1);
      expect(mockMemory.createMission).toHaveBeenCalled();
    });

    it('classifies as OBSERVE-ONLY in log output when governed plane is active', async () => {
      process.env.HYDI_DELEGATE_RECOVERY = 'true';
      const HealthObserver = require('../../heidi-core/missions/health-observer');
      const mockMemory = createMockMemory();
      const logs = [];

      const observer = new HealthObserver(mockMemory, {
        configPath: TEST_CONFIG_PATH,
        intervalMs: 999999,
        probeTimeoutMs: 1000,
        debounceFailures: 1,
        cooldownMs: 0,
        log: (msg) => logs.push(msg),
      });

      await observer.tick();

      const observeOnlyLog = logs.find((l) => l.includes('OBSERVE-ONLY'));
      expect(observeOnlyLog).toBeDefined();
      expect(observeOnlyLog).toContain('governed control plane is active');
    });
  });

  describe('MissionWorker dry-run gate', () => {
    it('does NOT execute actions when HEIDI_AUTONOMOUS_ACTIONS is not set', () => {
      delete process.env.HEIDI_AUTONOMOUS_ACTIONS;
      const src = fs.readFileSync(
        path.join(__dirname, '..', '..', 'heidi-core', 'missions', 'mission-worker.js'),
        'utf8',
      );
      expect(src).toContain('HEIDI_AUTONOMOUS_ACTIONS');
      expect(src).toContain('dry-run');
      expect(src).toContain('dryRun');
    });
  });

  describe('One authoritative mutation path', () => {
    it('RecoveryEngine is the only component that executes docker restart', () => {
      const recoveryEngineSrc = fs.readFileSync(
        path.join(__dirname, '..', '..', 'lib', 'operational', 'RecoveryEngine.ts'),
        'utf8',
      );
      expect(recoveryEngineSrc).toContain('restartContainer');
      expect(recoveryEngineSrc).toContain('docker restart');
    });

    it('HealthObserver does NOT call docker restart directly', () => {
      const healthObserverSrc = fs.readFileSync(
        path.join(__dirname, '..', '..', 'heidi-core', 'missions', 'health-observer.js'),
        'utf8',
      );
      // Check it doesn't call docker commands directly
      expect(healthObserverSrc).not.toMatch(/docker\s+(restart|start|stop)/);
      expect(healthObserverSrc).not.toContain('execSync');
      expect(healthObserverSrc).not.toContain('spawn(');
    });

    it('HealthObserver does NOT import or instantiate RecoveryEngine/PolicyEngine', () => {
      const healthObserverSrc = fs.readFileSync(
        path.join(__dirname, '..', '..', 'heidi-core', 'missions', 'health-observer.js'),
        'utf8',
      );
      // Check it doesn't import or instantiate governed components
      expect(healthObserverSrc).not.toMatch(/require.*RecoveryEngine/);
      expect(healthObserverSrc).not.toMatch(/require.*PolicyEngine/);
      expect(healthObserverSrc).not.toMatch(/require.*PolicyDecisionRecord/);
      expect(healthObserverSrc).not.toMatch(/new\s+RecoveryEngine/);
      expect(healthObserverSrc).not.toMatch(/new\s+PolicyEngine/);
    });
  });
});
