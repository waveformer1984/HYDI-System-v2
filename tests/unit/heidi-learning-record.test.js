'use strict';

// Regression coverage: HeidiControlPlane.recordActionOutcome() emits a CASCADE v3
// feedbackPacket shaped as { task_type, model_used, strategy, action_id,
// expected_outcome: {...}, actual_outcome: {...}, success_boolean, revenue_delta, ... },
// but HYDISystem.handleLearningRecorded() used to read record.actionType / record.success /
// record.actionId / record.confidence / record.latency / record.cost / record.revenue /
// record.model -- none of which ever existed on the packet -- so every
// "[HYDI SYSTEM] Learning recorded: undefined (success: undefined)" log line and every
// downstream selfAwareness.trackAction() call silently received all-undefined fields.

const HeidiControlPlane = require('../../src/control/HeidiControlPlane');
const HYDISystem = require('../../src/HYDISystem');

describe('HeidiControlPlane.recordActionOutcome -> feedbackPacket shape', () => {
  test('feedbackPacket carries the action id and strategy through, not just type/model', () => {
    const controlPlane = new HeidiControlPlane({ adaptationThreshold: 9999 });
    const events = [];
    controlPlane.on('learning_recorded', (packet) => events.push(packet));

    controlPlane.recordActionOutcome(
      { id: 'task-123', type: 'revenue', model: 'gpt-4-local', strategy: 'local', confidence: 0.8, cost: 0.01 },
      { success: true, latency: 250, revenue: 42 }
    );

    expect(events).toHaveLength(1);
    const packet = events[0];
    expect(packet.action_id).toBe('task-123');
    expect(packet.task_type).toBe('revenue');
    expect(packet.model_used).toBe('gpt-4-local');
    expect(packet.strategy).toBe('local');
    expect(packet.success_boolean).toBe(true);
    expect(packet.revenue_delta).toBe(42);
    expect(packet.expected_outcome.confidence).toBe(0.8);
    expect(packet.actual_outcome.latency).toBe(250);
  });
});

describe('HYDISystem.handleLearningRecorded reads the real feedbackPacket field names', () => {
  function makeFakeSystem() {
    const trackAction = jest.fn();
    const fakeSystem = { selfAwareness: { trackAction } };
    return { fakeSystem, trackAction };
  }

  test('maps task_type/success_boolean/model_used/strategy/action_id onto selfAwareness.trackAction', () => {
    const { fakeSystem, trackAction } = makeFakeSystem();

    const feedbackPacket = {
      action_id: 'task-123',
      task_type: 'revenue',
      model_used: 'gpt-4-local',
      strategy: 'local',
      expected_outcome: { success: true, confidence: 0.8, estimated_cost: 0.01 },
      actual_outcome: { success: true, revenue_delta: 42, latency: 250 },
      success_boolean: true,
      revenue_delta: 42,
      timestamp: Date.now(),
    };

    HYDISystem.prototype.handleLearningRecorded.call(fakeSystem, feedbackPacket);

    expect(trackAction).toHaveBeenCalledTimes(1);
    const arg = trackAction.mock.calls[0][0];
    expect(arg.id).toBe('task-123');
    expect(arg.type).toBe('revenue');
    expect(arg.success).toBe(true);
    expect(arg.confidence).toBe(0.8);
    expect(arg.latency).toBe(250);
    expect(arg.cost).toBe(0.01);
    expect(arg.revenue).toBe(42);
    expect(arg.model).toBe('gpt-4-local');
    expect(arg.strategy).toBe('local');

    // None of the fields should ever be the literal string 'undefined' via template
    // interpolation, and none of the mapped values should be JS `undefined` either --
    // this is exactly what regressed before the fix.
    expect(arg.type).not.toBeUndefined();
    expect(arg.success).not.toBeUndefined();
  });

  test('a failed outcome maps success_boolean=false through correctly (not undefined -> true)', () => {
    const { fakeSystem, trackAction } = makeFakeSystem();

    HYDISystem.prototype.handleLearningRecorded.call(fakeSystem, {
      action_id: 'task-456',
      task_type: 'critical',
      model_used: 'gpt-35-turbo',
      strategy: 'external',
      expected_outcome: { success: false, confidence: 0.4 },
      actual_outcome: { latency: 8000 },
      success_boolean: false,
      revenue_delta: 0,
    });

    const arg = trackAction.mock.calls[0][0];
    expect(arg.success).toBe(false);
  });
});
