/**
 * Phase II regression tests — HYDI core false-success elimination.
 *
 * The defect these lock down, reproduced from the live boot-agent log:
 *
 *   [MEMORY] Strategy that failed: loop_1789044103921_far1msxcs
 *   [CORE LOOP] Drift updated: 1.000
 *   [MEMORY] Confidence vs reality tracked: ... (accuracy: 0.00)
 *   [SELF-AWARENESS] Action tracked: core_loop (success: true)   <-- the lie
 *
 * Mechanism: evaluation.shouldProceed was false, makeDecision returned
 * {action:'reject'}, takeAction returned an object with NO `success` field,
 * measureResults read `action.success` as undefined (falsy, so the memory layer
 * recorded a failure), and HYDISystem.handleLoopCompleted hardcoded
 * `success: true, confidence: 0.9` for anything that reached 'loop_completed'.
 *
 * A rejected decision is neither success nor failure — it is BLOCKED.
 */

'use strict';

// Mock the four injected subsystems exactly as tests/unit/heidi-core-loop.test.js
// does — no I/O, and no real Ollama client. mockSubsystem starts with "mock" so
// Jest hoists it alongside the jest.mock() calls.
function mockSubsystem() {
  const EventEmitter = require('events');
  const emitter = new EventEmitter();
  emitter.getStatus = jest.fn().mockReturnValue({ ok: true });
  emitter.reset = jest.fn().mockResolvedValue();
  emitter.processTask = jest.fn().mockResolvedValue({ decision: { strategy: 'local', model: 'gpt4' } });
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
const { LOOP_OUTCOME } = require('../../src/core/HeidiCoreLoop');

// A loop instance with every collaborator stubbed — we are testing the outcome
// contract, not the cognition.
function makeLoop(overrides = {}) {
  return new HeidiCoreLoop({ enableAutoActions: true, ...overrides });
}

describe('HeidiCoreLoop outcome contract', () => {
  describe('1. successful valid model execution → SUCCESS', () => {
    it('takeAction reports SUCCESS when a model is selected and a result is produced', async () => {
      const loop = makeLoop();
      loop.executeGeneralAction = jest.fn().mockResolvedValue({ text: 'done' });

      const action = await loop.takeAction(
        { type: 'general' },
        { action: 'proceed', strategy: 'local', model: 'llama3.2:3b' },
        'loop-1'
      );

      expect(action.outcome).toBe(LOOP_OUTCOME.SUCCESS);
      expect(action.success).toBe(true);
      expect(action.model).toBe('llama3.2:3b');
    });

    it('measureResults carries the SUCCESS outcome through', async () => {
      const loop = makeLoop();
      const m = await loop.measureResults(
        { type: 'general' },
        { outcome: LOOP_OUTCOME.SUCCESS, success: true, result: { text: 'x' } }
      );
      expect(m.outcome).toBe(LOOP_OUTCOME.SUCCESS);
      expect(m.success).toBe(true);
    });
  });

  describe('2. unavailable / unselected model → BLOCKED', () => {
    it('a proceed decision with no model is BLOCKED, not SUCCESS', async () => {
      const loop = makeLoop();
      loop.executeGeneralAction = jest.fn().mockResolvedValue({ text: 'should never run' });

      const action = await loop.takeAction(
        { type: 'general' },
        { action: 'proceed', strategy: 'local', model: undefined },
        'loop-2'
      );

      expect(action.outcome).toBe(LOOP_OUTCOME.BLOCKED);
      expect(action.success).toBe(false);
      expect(action.blockedReason).toBe('no_model_selected');
      // Critically: the action handler must not have been invoked, so no
      // completion can be claimed for it.
      expect(loop.executeGeneralAction).not.toHaveBeenCalled();
    });

    it('action-layer tasks are exempt — revenue needs no model and is not blocked', async () => {
      // revenue/payment/communication dispatch to the action layer (Stripe,
      // email, webhooks), not the model stack. Gating them on a model would
      // block real work, so the precondition is scoped to model-backed types.
      const loop = makeLoop();
      const spy = jest.spyOn(loop, 'executeRevenueAction').mockResolvedValue({ revenue: 100 });

      const action = await loop.takeAction(
        { type: 'revenue', subtype: 'generate_offer', params: {} },
        { action: 'proceed', strategy: 'local' },
        'loop-2b'
      );

      expect(spy).toHaveBeenCalled();
      expect(action.outcome).toBe(LOOP_OUTCOME.SUCCESS);
      expect(action.success).toBe(true);
    });

    it('action-layer tasks: communication is likewise exempt', async () => {
      const loop = makeLoop();
      const spy = jest.spyOn(loop, 'executeCommunicationAction').mockResolvedValue({ sent: true });
      const action = await loop.takeAction(
        { type: 'communication', subtype: 'send_email', params: {} },
        { action: 'proceed' },
        'loop-2c'
      );
      expect(spy).toHaveBeenCalled();
      expect(action.outcome).toBe(LOOP_OUTCOME.SUCCESS);
    });

    it('a rejected decision is BLOCKED and explicitly not successful', async () => {
      const loop = makeLoop();
      const action = await loop.takeAction(
        { type: 'revenue' },
        { action: 'reject', reason: 'low_confidence', strategy: 'none', confidence: 0.2 },
        'loop-3'
      );

      expect(action.status).toBe('rejected');
      expect(action.outcome).toBe(LOOP_OUTCOME.BLOCKED);
      expect(action.success).toBe(false);
      expect(action.blockedReason).toBe('low_confidence');
    });

    it('regression: a rejected action no longer leaves `success` undefined', async () => {
      const loop = makeLoop();
      const action = await loop.takeAction(
        { type: 'revenue' },
        { action: 'reject', reason: 'high_risk' },
        'loop-4'
      );
      // The old shape was { status, reason, result } — `success` was absent,
      // which is what let two layers disagree about what happened.
      expect(action).toHaveProperty('success');
      expect(action.success).not.toBeUndefined();
    });
  });

  describe('3. model execution exception → FAILED', () => {
    it('a throwing action handler produces FAILED, not SUCCESS', async () => {
      const loop = makeLoop();
      loop.executeGeneralAction = jest.fn().mockRejectedValue(new Error('Model timed out after 15000ms'));

      const action = await loop.takeAction(
        { type: 'general' },
        { action: 'proceed', strategy: 'local', model: 'gpt-35-turbo' },
        'loop-5'
      );

      expect(action.outcome).toBe(LOOP_OUTCOME.FAILED);
      expect(action.success).toBe(false);
      expect(action.error).toContain('timed out');
    });

    it('a disabled-auto-actions revenue task surfaces as FAILED with its reason, not SUCCESS', async () => {
      const loop = makeLoop({ enableAutoActions: false });
      const action = await loop.takeAction(
        { type: 'revenue', subtype: 'generate_offer' },
        { action: 'proceed', strategy: 'local', model: 'llama3.2:3b' },
        'loop-6'
      );
      expect(action.success).toBe(false);
      expect(action.outcome).toBe(LOOP_OUTCOME.FAILED);
      expect(action.error).toContain('Auto actions are disabled');
    });
  });

  describe('4. a loop whose action did not succeed is never reported as a success', () => {
    async function runLoopWithAction(action) {
      const loop = makeLoop();
      loop.observeForTask = jest.fn().mockResolvedValue({ ts: 1 });
      loop.evaluateTask = jest.fn().mockResolvedValue({ shouldProceed: true, confidence: 0.9 });
      loop.makeDecision = jest.fn().mockResolvedValue({ action: 'proceed', strategy: 'local', model: 'm' });
      loop.takeAction = jest.fn().mockResolvedValue(action);
      loop.reflectOnLoop = jest.fn().mockResolvedValue({ recommendations: [] });
      loop.adaptStrategy = jest.fn().mockResolvedValue({});

      const events = [];
      loop.on('loop_completed', (e) => events.push(e));
      const result = await loop.executeLoop({ type: 'general' });
      return { loop, result, event: events[0] };
    }

    it('BLOCKED action → loop outcome BLOCKED and success false', async () => {
      const { result, event } = await runLoopWithAction({
        status: 'rejected',
        outcome: LOOP_OUTCOME.BLOCKED,
        success: false,
        reason: 'low_confidence',
        result: null,
      });
      expect(result.outcome).toBe(LOOP_OUTCOME.BLOCKED);
      expect(result.success).toBe(false);
      expect(event.outcome).toBe(LOOP_OUTCOME.BLOCKED);
      expect(event.success).toBe(false);
    });

    it('FAILED action → loop outcome FAILED and success false', async () => {
      const { result, event } = await runLoopWithAction({
        status: 'failed',
        outcome: LOOP_OUTCOME.FAILED,
        success: false,
        error: 'boom',
        result: null,
      });
      expect(result.outcome).toBe(LOOP_OUTCOME.FAILED);
      expect(result.success).toBe(false);
      expect(event.success).toBe(false);
    });

    it('SUCCESS action → loop outcome SUCCESS', async () => {
      const { result, event } = await runLoopWithAction({
        status: 'completed',
        outcome: LOOP_OUTCOME.SUCCESS,
        success: true,
        result: { ok: 1 },
      });
      expect(result.outcome).toBe(LOOP_OUTCOME.SUCCESS);
      expect(result.success).toBe(true);
      expect(event.success).toBe(true);
    });

    it('loop_completed carries the outcome so listeners cannot infer success from the event name', async () => {
      const { event } = await runLoopWithAction({
        outcome: LOOP_OUTCOME.BLOCKED,
        success: false,
        reason: 'low_confidence',
        result: null,
      });
      expect(event).toHaveProperty('outcome');
      expect(event).toHaveProperty('success');
      expect(event.reason).toBe('low_confidence');
    });

    it('metrics break loops down by outcome, so "running" cannot read as "working"', async () => {
      const { loop } = await runLoopWithAction({
        outcome: LOOP_OUTCOME.BLOCKED,
        success: false,
        result: null,
      });
      expect(loop.metrics.loopsCompleted).toBe(1);
      expect(loop.metrics.loopsByOutcome.BLOCKED).toBe(1);
      expect(loop.metrics.loopsByOutcome.SUCCESS).toBe(0);
    });
  });

  describe('5. no fabricated model fallback', () => {
    it('the loop does not substitute another model when none was selected', async () => {
      const loop = makeLoop();
      loop.executeGeneralAction = jest.fn();
      loop.executeAnalysisAction = jest.fn();
      loop.executeOptimizationAction = jest.fn();

      const action = await loop.takeAction({ type: 'general' }, { action: 'proceed', strategy: 'local' }, 'loop-7');

      expect(action.outcome).toBe(LOOP_OUTCOME.BLOCKED);
      expect(loop.executeGeneralAction).not.toHaveBeenCalled();
      expect(loop.executeAnalysisAction).not.toHaveBeenCalled();
      expect(loop.executeOptimizationAction).not.toHaveBeenCalled();
      expect(action.model).toBeUndefined();
    });
  });

  describe('6. success cannot be recorded without evidence of execution', () => {
    it('a handler returning undefined is UNVERIFIED, not SUCCESS', async () => {
      const loop = makeLoop();
      loop.executeGeneralAction = jest.fn().mockResolvedValue(undefined);

      const action = await loop.takeAction(
        { type: 'general' },
        { action: 'proceed', strategy: 'local', model: 'm' },
        'loop-8'
      );

      expect(action.outcome).toBe(LOOP_OUTCOME.UNVERIFIED);
      expect(action.success).toBe(false);
      expect(action.reason).toContain('could not be verified');
    });

    it('a handler returning null is UNVERIFIED, not SUCCESS', async () => {
      const loop = makeLoop();
      loop.executeGeneralAction = jest.fn().mockResolvedValue(null);
      const action = await loop.takeAction(
        { type: 'general' },
        { action: 'proceed', strategy: 'local', model: 'm' },
        'loop-9'
      );
      expect(action.outcome).toBe(LOOP_OUTCOME.UNVERIFIED);
      expect(action.success).toBe(false);
    });

    it('only SUCCESS is in the set of outcomes reportable as a success', () => {
      const { SUCCESSFUL_OUTCOMES } = require('../../src/core/HeidiCoreLoop');
      expect(SUCCESSFUL_OUTCOMES.has(LOOP_OUTCOME.SUCCESS)).toBe(true);
      for (const bad of [LOOP_OUTCOME.FAILED, LOOP_OUTCOME.BLOCKED, LOOP_OUTCOME.DEGRADED, LOOP_OUTCOME.UNVERIFIED]) {
        expect(SUCCESSFUL_OUTCOMES.has(bad)).toBe(false);
      }
    });

    it('measureResults never reports success:true for a non-SUCCESS outcome', async () => {
      const loop = makeLoop();
      for (const outcome of [LOOP_OUTCOME.FAILED, LOOP_OUTCOME.BLOCKED, LOOP_OUTCOME.UNVERIFIED]) {
        const m = await loop.measureResults({ type: 'general' }, { outcome, success: false });
        expect(`${outcome}:${m.success}`).toBe(`${outcome}:false`);
      }
    });

    it('regression: measureResults coerces a missing success flag to false, never undefined', async () => {
      const loop = makeLoop();
      const m = await loop.measureResults({ type: 'general' }, { status: 'rejected', result: null });
      expect(m.success).toBe(false);
      expect(m.outcome).toBe(LOOP_OUTCOME.FAILED);
    });
  });
});

describe('HYDISystem.handleLoopCompleted — self-awareness records the real outcome', () => {
  const HYDISystem = require('../../src/HYDISystem');

  function makeSystem() {
    const system = Object.create(HYDISystem.prototype);
    system.selfAwareness = { trackAction: jest.fn() };
    return system;
  }

  it('records success:false for a BLOCKED loop (the exact live false-green)', () => {
    const system = makeSystem();
    system.handleLoopCompleted({
      loopId: 'loop_1789044103921_far1msxcs',
      outcome: 'BLOCKED',
      success: false,
      reason: 'low_confidence',
      duration: 1,
      result: { outcome: 'BLOCKED', outcomeReason: 'low_confidence' },
    });

    const tracked = system.selfAwareness.trackAction.mock.calls[0][0];
    expect(tracked.type).toBe('core_loop');
    expect(tracked.success).toBe(false);
    expect(tracked.loopOutcome).toBe('BLOCKED');
  });

  it('does not assert confidence 0.9 for an unsuccessful loop', () => {
    const system = makeSystem();
    system.handleLoopCompleted({ loopId: 'l', outcome: 'FAILED', success: false, duration: 5, result: {} });
    expect(system.selfAwareness.trackAction.mock.calls[0][0].confidence).toBe(0);
  });

  it('still records success:true for a genuinely successful loop', () => {
    const system = makeSystem();
    system.handleLoopCompleted({ loopId: 'l', outcome: 'SUCCESS', success: true, duration: 5, result: {} });
    const tracked = system.selfAwareness.trackAction.mock.calls[0][0];
    expect(tracked.success).toBe(true);
    expect(tracked.confidence).toBe(0.9);
  });

  it('an event with no outcome at all is UNVERIFIED, not a success', () => {
    const system = makeSystem();
    system.handleLoopCompleted({ loopId: 'l', duration: 5, result: {} });
    const tracked = system.selfAwareness.trackAction.mock.calls[0][0];
    expect(tracked.loopOutcome).toBe('UNVERIFIED');
    expect(tracked.success).toBe(false);
  });

  it('falls back to the outcome on the result when the event lacks one', () => {
    const system = makeSystem();
    system.handleLoopCompleted({ loopId: 'l', duration: 5, result: { outcome: 'SUCCESS' } });
    expect(system.selfAwareness.trackAction.mock.calls[0][0].success).toBe(true);
  });
});
