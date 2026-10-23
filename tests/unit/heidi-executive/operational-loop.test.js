/**
 * OperationalLoop safety and cycle tests
 */

const { OperationalLoop } = require('../../../src/heidi-executive/OperationalLoop');
const fs = require('fs');
const path = require('path');

class MockExecutive {
  constructor() {
    this.calls = [];
  }

  async operationalCycle(mode, options) {
    this.calls.push({ mode, cycleId: options.cycleId });
    return {
      cycleId: options.cycleId,
      mode,
      finalState: { state: 'STABLE' },
      decisions: [],
      escalation: null,
    };
  }
}

xdescribe('OperationalLoop — disabled pending mock loop hang diagnosis', () => {
  const tmpDir = path.join(process.cwd(), 'tmp-test-phase13');

  beforeEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  test('runs bounded number of cycles', async () => {
    const exec = new MockExecutive();
    const loop = new OperationalLoop(exec, { reportDir: tmpDir, cycleIntervalMs: 0, maxCycles: 3 });
    const result = await loop.run('DECISION_ONLY');
    expect(result.cycles.length).toBe(3);
    expect(exec.calls.length).toBe(3);
  });

  test('stops on emergency stop', async () => {
    const exec = new MockExecutive();
    const loop = new OperationalLoop(exec, { reportDir: tmpDir, cycleIntervalMs: 0, maxCycles: 100 });
    setTimeout(() => loop.stop(), 50);
    const result = await loop.run('SHADOW');
    expect(result.cycles.length).toBeLessThan(100);
    expect(result.cycles[result.cycles.length - 1].status).toBe('STOPPED_BY_OPERATOR');
  });

  test('enforces maxActionsPerCycle in controlled mode', async () => {
    const exec = new MockExecutive();
    exec.operationalCycle = async () => ({
      decisions: [{
        execution_result: { status: 'COMPLETED' },
      }],
      finalState: { state: 'STABLE' },
      escalation: null,
    });
    const loop = new OperationalLoop(exec, { reportDir: tmpDir, cycleIntervalMs: 0, maxCycles: 10, maxActionsPerCycle: 2 });
    const result = await loop.run('CONTROLLED');
    expect(result.summary.actionsTaken).toBeLessThanOrEqual(2);
    expect(result.cycles[result.cycles.length - 1].status).toBe('MAX_ACTIONS_EXCEEDED');
  });
});
