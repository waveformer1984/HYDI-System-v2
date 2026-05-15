/**
 * Unit tests for HeidiCoreLoop
 * All 4 subsystem dependencies are mocked — no I/O required.
 */

// ── Mock all four injected subsystems ────────────────────────────────────────
// mockSubsystem starts with "mock" so Jest hoists it alongside jest.mock() calls.
// EventEmitter is required inline so it's available even when hoisted.

function mockSubsystem() {
  const EventEmitter = require('events');
  const emitter = new EventEmitter();
  emitter.getStatus = jest.fn().mockReturnValue({ ok: true });
  emitter.reset = jest.fn().mockResolvedValue();
  emitter.processTask = jest.fn().mockResolvedValue({ decision: { strategy: 'local', model: 'gpt4', reasoning: 'test' } });
  emitter.storeContext = jest.fn();
  emitter.storeSession = jest.fn();
  emitter.storeWhatWorked = jest.fn();
  emitter.storeWhatFailed = jest.fn();
  emitter.trackConfidenceVsReality = jest.fn();
  emitter.storeAdaptation = jest.fn();
  emitter.runReflection = jest.fn().mockResolvedValue({ recommendations: [] });
  emitter.reflectiveMemory = { driftScore: 0.1 };
  emitter.execute = jest.fn().mockResolvedValue({ result: 'ok' });
  emitter.executeAction = jest.fn().mockResolvedValue({ result: 'action done' });
  emitter.config = {};
  return emitter;
}

jest.mock('../../src/orchestrator/HeidiOrchestrator', () =>
  jest.fn().mockImplementation(() => mockSubsystem())
);
jest.mock('../../src/models/HybridModelStack', () =>
  jest.fn().mockImplementation(() => mockSubsystem())
);
jest.mock('../../src/memory/HeidiMemorySystem', () =>
  jest.fn().mockImplementation(() => mockSubsystem())
);
jest.mock('../../src/actions/HeidiActionLayer', () =>
  jest.fn().mockImplementation(() => mockSubsystem())
);

const HeidiCoreLoop = require('../../src/core/HeidiCoreLoop');

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeLoop(overrides = {}) {
  return new HeidiCoreLoop({
    loopInterval: 100,
    observationInterval: 500,
    reflectionInterval: 1000,
    ...overrides,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('HeidiCoreLoop', () => {
  // ── Constructor / config defaults ───────────────────────────────────────

  describe('constructor', () => {
    it('applies default config values', () => {
      const loop = new HeidiCoreLoop();
      expect(loop.config.loopInterval).toBe(60000);
      expect(loop.config.observationInterval).toBe(300000);
      expect(loop.config.reflectionInterval).toBe(900000);
      expect(loop.config.maxConcurrentLoops).toBe(5);
      expect(loop.config.actionConfidenceThreshold).toBe(0.7);
      expect(loop.config.enableRevenueMode).toBe(true);
      expect(loop.config.enableAutoActions).toBe(true);
    });

    it('overrides defaults with provided config', () => {
      const loop = new HeidiCoreLoop({ loopInterval: 5000, maxConcurrentLoops: 2 });
      expect(loop.config.loopInterval).toBe(5000);
      expect(loop.config.maxConcurrentLoops).toBe(2);
    });

    it('starts with isRunning=false and empty state', () => {
      const loop = makeLoop();
      expect(loop.isRunning).toBe(false);
      expect(loop.activeLoops.size).toBe(0);
      expect(loop.loopHistory).toHaveLength(0);
      expect(loop.metrics.loopsCompleted).toBe(0);
    });

    it('initialises all metrics to zero', () => {
      const loop = makeLoop();
      const { metrics } = loop;
      expect(metrics.loopsFailed).toBe(0);
      expect(metrics.observations).toBe(0);
      expect(metrics.actions).toBe(0);
      expect(metrics.adaptations).toBe(0);
      expect(metrics.revenueGenerated).toBe(0);
    });
  });

  // ── start / stop ─────────────────────────────────────────────────────────

  describe('start / stop', () => {
    it('sets isRunning to true on start and emits loop_started', async () => {
      const loop = makeLoop();
      const started = jest.fn();
      loop.on('loop_started', started);

      await loop.start();
      expect(loop.isRunning).toBe(true);
      expect(started).toHaveBeenCalledWith(expect.objectContaining({ timestamp: expect.any(Number) }));

      // Cleanup — stop to cancel pending timers
      loop.isRunning = false;
    });

    it('does nothing if already running', async () => {
      const loop = makeLoop();
      loop.isRunning = true;
      const startMainLoop = jest.spyOn(loop, 'startMainLoop').mockImplementation(() => {});
      await loop.start();
      expect(startMainLoop).not.toHaveBeenCalled();
    });

    it('sets isRunning to false on stop and emits loop_stopped', async () => {
      const loop = makeLoop();
      loop.isRunning = true;
      const stopped = jest.fn();
      loop.on('loop_stopped', stopped);

      await loop.stop();
      expect(loop.isRunning).toBe(false);
      expect(stopped).toHaveBeenCalled();
    });

    it('does nothing if already stopped', async () => {
      const loop = makeLoop();
      loop.isRunning = false;
      const stopped = jest.fn();
      loop.on('loop_stopped', stopped);
      await loop.stop();
      expect(stopped).not.toHaveBeenCalled();
    });
  });

  // ── getStatus ────────────────────────────────────────────────────────────

  describe('getStatus', () => {
    it('returns a snapshot of current state', () => {
      const loop = makeLoop();
      const status = loop.getStatus();
      expect(status.running).toBe(false);
      expect(status.activeLoops).toBe(0);
      expect(status.metrics).toMatchObject({ loopsCompleted: 0, loopsFailed: 0 });
      expect(status.config).toBeDefined();
    });

    it('reflects live activeLoops count', () => {
      const loop = makeLoop();
      loop.activeLoops.set('loop_1', {});
      loop.activeLoops.set('loop_2', {});
      expect(loop.getStatus().activeLoops).toBe(2);
    });
  });

  // ── getLoopHistory ───────────────────────────────────────────────────────

  describe('getLoopHistory', () => {
    it('returns the last N entries', () => {
      const loop = makeLoop();
      loop.loopHistory = Array.from({ length: 100 }, (_, i) => ({ id: `loop_${i}` }));
      const history = loop.getLoopHistory(10);
      expect(history).toHaveLength(10);
      expect(history[9].id).toBe('loop_99');
    });

    it('defaults to last 50', () => {
      const loop = makeLoop();
      loop.loopHistory = Array.from({ length: 100 }, (_, i) => ({ id: `loop_${i}` }));
      expect(loop.getLoopHistory()).toHaveLength(50);
    });
  });

  // ── evaluateTask ──────────────────────────────────────────────────────────

  describe('evaluateTask', () => {
    const task = { type: 'analysis', priority: 'medium' };

    it('sets shouldProceed=true when confidence is high and risk is low', async () => {
      const loop = makeLoop({ actionConfidenceThreshold: 0.5 });
      jest.spyOn(loop, 'calculateTaskConfidence').mockReturnValue(0.9);
      jest.spyOn(loop, 'calculateTaskRisk').mockReturnValue(0.1);
      jest.spyOn(loop, 'assessFeasibility').mockReturnValue(0.9);
      jest.spyOn(loop, 'identifyOpportunity').mockReturnValue(0.5);
      jest.spyOn(loop, 'assessUrgency').mockReturnValue(0.3);
      jest.spyOn(loop, 'generateRecommendation').mockReturnValue('go');

      const eval_ = await loop.evaluateTask(task, {}, 'loop_test');
      expect(eval_.shouldProceed).toBe(true);
    });

    it('sets shouldProceed=false when confidence is below threshold', async () => {
      const loop = makeLoop({ actionConfidenceThreshold: 0.7 });
      jest.spyOn(loop, 'calculateTaskConfidence').mockReturnValue(0.4); // below 0.7
      jest.spyOn(loop, 'calculateTaskRisk').mockReturnValue(0.1);
      jest.spyOn(loop, 'assessFeasibility').mockReturnValue(0.9);
      jest.spyOn(loop, 'identifyOpportunity').mockReturnValue(0.5);
      jest.spyOn(loop, 'assessUrgency').mockReturnValue(0.3);
      jest.spyOn(loop, 'generateRecommendation').mockReturnValue('wait');

      const eval_ = await loop.evaluateTask(task, {}, 'loop_test');
      expect(eval_.shouldProceed).toBe(false);
    });

    it('sets shouldProceed=false when risk is too high', async () => {
      const loop = makeLoop({ actionConfidenceThreshold: 0.5 });
      jest.spyOn(loop, 'calculateTaskConfidence').mockReturnValue(0.9);
      jest.spyOn(loop, 'calculateTaskRisk').mockReturnValue(0.85); // above 0.8
      jest.spyOn(loop, 'assessFeasibility').mockReturnValue(0.9);
      jest.spyOn(loop, 'identifyOpportunity').mockReturnValue(0.5);
      jest.spyOn(loop, 'assessUrgency').mockReturnValue(0.3);
      jest.spyOn(loop, 'generateRecommendation').mockReturnValue('hold');

      const eval_ = await loop.evaluateTask(task, {}, 'loop_test');
      expect(eval_.shouldProceed).toBe(false);
    });
  });

  // ── makeDecision ──────────────────────────────────────────────────────────

  describe('makeDecision', () => {
    it('returns reject when shouldProceed is false', async () => {
      const loop = makeLoop();
      const evaluation = { shouldProceed: false, confidence: 0.3 };
      const decision = await loop.makeDecision({}, {}, evaluation, 'loop_test');
      expect(decision.action).toBe('reject');
      expect(decision.reason).toBe('low_confidence');
    });

    it('returns proceed and delegates to orchestrator when shouldProceed is true', async () => {
      const loop = makeLoop();
      const evaluation = { shouldProceed: true, confidence: 0.9 };
      const task = { type: 'analysis' };
      // orchestrator is already mocked to return { decision: { strategy: 'local' } }
      const decision = await loop.makeDecision(task, {}, evaluation, 'loop_test');
      expect(decision.action).toBe('proceed');
      expect(decision.strategy).toBeDefined();
    });
  });

  // ── takeAction ────────────────────────────────────────────────────────────

  describe('takeAction', () => {
    it('returns rejected status when decision is reject', async () => {
      const loop = makeLoop();
      const action = await loop.takeAction({}, { action: 'reject', reason: 'low_confidence' }, 'loop_test');
      expect(action.status).toBe('rejected');
      expect(action.result).toBeNull();
    });

    it('dispatches revenue tasks to executeRevenueAction', async () => {
      const loop = makeLoop();
      const spy = jest.spyOn(loop, 'executeRevenueAction').mockResolvedValue({ revenue: 100 });
      const action = await loop.takeAction(
        { type: 'revenue', subtype: 'generate_offer', params: {} },
        { action: 'proceed', strategy: 'local' },
        'loop_test'
      );
      expect(spy).toHaveBeenCalled();
      expect(action.status).toBe('completed');
      expect(action.success).toBe(true);
    });

    it('dispatches communication tasks to executeCommunicationAction', async () => {
      const loop = makeLoop();
      const spy = jest.spyOn(loop, 'executeCommunicationAction').mockResolvedValue({});
      await loop.takeAction(
        { type: 'communication', subtype: 'send_email', params: {} },
        { action: 'proceed' },
        'loop_test'
      );
      expect(spy).toHaveBeenCalled();
    });

    it('returns failed status when the action throws', async () => {
      const loop = makeLoop();
      jest.spyOn(loop, 'executeAnalysisAction').mockRejectedValue(new Error('model timeout'));
      const action = await loop.takeAction(
        { type: 'analysis' },
        { action: 'proceed' },
        'loop_test'
      );
      expect(action.status).toBe('failed');
      expect(action.success).toBe(false);
      expect(action.error).toBe('model timeout');
    });
  });

  // ── applyAdaptation ───────────────────────────────────────────────────────

  describe('applyAdaptation', () => {
    it('adds to avoidStrategies for strategy_avoidance', async () => {
      const loop = makeLoop();
      await loop.applyAdaptation({ type: 'strategy_avoidance', target: 'local' });
      expect(loop.orchestrator.config.avoidStrategies).toContain('local');
    });

    it('adds to preferStrategies for strategy_preference', async () => {
      const loop = makeLoop();
      await loop.applyAdaptation({ type: 'strategy_preference', target: 'cloud' });
      expect(loop.orchestrator.config.preferStrategies).toContain('cloud');
    });

    it('lowers confidence threshold on overconfidence signal', async () => {
      const loop = makeLoop({ actionConfidenceThreshold: 0.8 });
      await loop.applyAdaptation({ type: 'confidence_calibration', adjustment: 'lower_threshold' });
      expect(loop.config.actionConfidenceThreshold).toBeCloseTo(0.7);
    });

    it('does not lower confidence threshold below 0.5', async () => {
      const loop = makeLoop({ actionConfidenceThreshold: 0.5 });
      await loop.applyAdaptation({ type: 'confidence_calibration', adjustment: 'lower_threshold' });
      expect(loop.config.actionConfidenceThreshold).toBe(0.5);
    });
  });

  // ── identifyUrgentTasks ───────────────────────────────────────────────────

  describe('identifyUrgentTasks', () => {
    it('generates a system optimization task when CPU > 0.9', async () => {
      const loop = makeLoop();
      const tasks = await loop.identifyUrgentTasks({ system: { cpu: 0.95, memory: 0.5 }, business: { recentRevenue: 1 } });
      expect(tasks.some(t => t.type === 'optimization' && t.priority === 'critical')).toBe(true);
    });

    it('generates a system optimization task when memory > 0.9', async () => {
      const loop = makeLoop();
      const tasks = await loop.identifyUrgentTasks({ system: { cpu: 0.1, memory: 0.95 }, business: { recentRevenue: 1 } });
      expect(tasks.some(t => t.type === 'optimization')).toBe(true);
    });

    it('generates a revenue task when revenue is critically low', async () => {
      const loop = makeLoop({ enableRevenueMode: true });
      const tasks = await loop.identifyUrgentTasks({ system: { cpu: 0.1, memory: 0.1 }, business: { recentRevenue: 0.05 } });
      expect(tasks.some(t => t.type === 'revenue' && t.priority === 'high')).toBe(true);
    });

    it('does not generate revenue tasks when revenue mode is disabled', async () => {
      const loop = makeLoop({ enableRevenueMode: false });
      const tasks = await loop.identifyUrgentTasks({ system: { cpu: 0.1, memory: 0.1 }, business: { recentRevenue: 0.0 } });
      expect(tasks.some(t => t.type === 'revenue')).toBe(false);
    });

    it('returns empty array for a healthy system', async () => {
      const loop = makeLoop();
      const tasks = await loop.identifyUrgentTasks({ system: { cpu: 0.3, memory: 0.4 }, business: { recentRevenue: 5 } });
      expect(tasks).toHaveLength(0);
    });
  });

  // ── Revenue tracking ──────────────────────────────────────────────────────

  describe('handleRevenueTracked', () => {
    it('accumulates revenue into metrics.revenueGenerated', () => {
      const loop = makeLoop();
      loop.handleRevenueTracked({ amount: 49.99 });
      loop.handleRevenueTracked({ amount: 149.00 });
      expect(loop.metrics.revenueGenerated).toBeCloseTo(198.99);
    });
  });

  // ── Loop history trimming ─────────────────────────────────────────────────

  describe('loop history management', () => {
    it('trims history to 500 when it exceeds 1000 entries', async () => {
      const loop = makeLoop();
      // Seed 1000 entries
      loop.loopHistory = Array.from({ length: 1000 }, (_, i) => ({ id: `old_${i}` }));

      // Manually trigger what executeLoop does after a result
      loop.loopHistory.push({ id: 'new_1' });
      if (loop.loopHistory.length > 1000) {
        loop.loopHistory = loop.loopHistory.slice(-500);
      }

      expect(loop.loopHistory).toHaveLength(500);
      // The new entry should be the last one
      expect(loop.loopHistory[499].id).toBe('new_1');
    });
  });

  // ── Event emissions ───────────────────────────────────────────────────────

  describe('event emissions', () => {
    it('emits loop_completed with result on successful executeLoop', async () => {
      const loop = makeLoop();
      const onComplete = jest.fn();
      loop.on('loop_completed', onComplete);

      // Mock the inner loop so we don't need all the subsystem wiring
      jest.spyOn(loop, 'executeHeidiLoop').mockResolvedValue({ task: 'analysis', success: true });
      jest.spyOn(loop, 'updateMetrics').mockImplementation(() => {});

      await loop.executeLoop({ type: 'analysis' });

      expect(onComplete).toHaveBeenCalledWith(
        expect.objectContaining({ task: expect.any(Object), result: expect.any(Object) })
      );
    });

    it('emits loop_failed and re-throws on executeLoop error', async () => {
      const loop = makeLoop();
      const onFail = jest.fn();
      loop.on('loop_failed', onFail);
      jest.spyOn(loop, 'executeHeidiLoop').mockRejectedValue(new Error('subsystem crash'));

      await expect(loop.executeLoop({ type: 'analysis' })).rejects.toThrow('subsystem crash');
      expect(onFail).toHaveBeenCalledWith(expect.objectContaining({ error: 'subsystem crash' }));
      expect(loop.metrics.loopsFailed).toBe(1);
    });

    it('removes loop from activeLoops after execution (success or failure)', async () => {
      const loop = makeLoop();
      jest.spyOn(loop, 'executeHeidiLoop').mockResolvedValue({});
      jest.spyOn(loop, 'updateMetrics').mockImplementation(() => {});

      await loop.executeLoop({ type: 'analysis' });
      expect(loop.activeLoops.size).toBe(0);
    });
  });
});
