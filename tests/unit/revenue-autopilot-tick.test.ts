/**
 * Tests for scripts/revenue-autopilot-tick.ts — the boot-module cadence
 * that closes the "satisfied human prerequisite waits for the next chat
 * message" gap (see the file's own header comment).
 *
 * The tick itself is deliberately thin — all stage logic lives in
 * lib/revenue/revenue-autopilot.js and lib/human-actions/*, which are
 * mocked here. These tests verify only the tick's own control flow:
 * the sync sweep runs before advance, stage transitions are reported,
 * errors back off rather than crash the loop, and injected deps are used.
 */

jest.mock('../../lib/human-actions', () => ({
  HumanActionService: jest.fn(() => ({ __svc: true })),
  syncHumanActions: jest.fn(),
}));
jest.mock('../../lib/revenue/revenue-autopilot', () => ({
  advance: jest.fn(),
}));
jest.mock('../../lib/revenue/JobManager', () => ({ JobManager: jest.fn() }));
jest.mock('../../lib/heidi/GoalSystem', () => ({
  getGoalSystem: jest.fn(() => ({ __goals: true })),
}));

import { HumanActionService, syncHumanActions } from '../../lib/human-actions';
import { advance } from '../../lib/revenue/revenue-autopilot';
import { runOnce, mainLoop } from '../../scripts/revenue-autopilot-tick';

const mockSync = syncHumanActions as jest.Mock;
const mockAdvance = advance as jest.Mock;
const MockService = HumanActionService as unknown as jest.Mock;

describe('revenue-autopilot-tick: runOnce', () => {
  beforeEach(() => {
    mockSync.mockReset().mockResolvedValue(undefined);
    mockAdvance.mockReset().mockResolvedValue({ stage: 'payment', outcome: null });
    MockService.mockClear();
  });

  it('runs the human-action sync sweep before advancing the mission', async () => {
    const calls: string[] = [];
    mockSync.mockImplementation(async () => { calls.push('sync'); });
    mockAdvance.mockImplementation(async () => { calls.push('advance'); return { stage: 'payment' }; });
    await runOnce();
    expect(calls).toEqual(['sync', 'advance']);
  });

  it('returns the reported stage', async () => {
    mockAdvance.mockResolvedValue({ stage: 'proven', outcome: 'TEST_PIPELINE_PROVEN' });
    const result = await runOnce();
    expect(result.stage).toBe('proven');
  });

  it('returns null stage when advance reports nothing', async () => {
    mockAdvance.mockResolvedValue(null);
    const result = await runOnce();
    expect(result.stage).toBeNull();
  });

  it('uses injected goals/service instead of constructing them', async () => {
    const goals = { injected: true };
    const service = { injected: true };
    await runOnce({ goals, service });
    expect(mockSync).toHaveBeenCalledWith(service, goals);
    expect(mockAdvance).toHaveBeenCalledWith(expect.objectContaining({ goals }));
    expect(MockService).not.toHaveBeenCalled();
  });

  it('sweeps open app-realization goals through their managed advance', async () => {
    const appGoal = { goalId: 'g_app', status: 'escalated', context: { appRealization: { appId: 'checkpoint' } } };
    const doneGoal = { goalId: 'g_done', status: 'completed', context: { appRealization: { appId: 'old-app' } } };
    const otherGoal = { goalId: 'g_other', status: 'pending', context: {} };
    const goals = { listGoals: async () => [appGoal, doneGoal, otherGoal] };
    const advanceApp = jest.fn(async () => ({ stage: 'WAITING_ON_HUMAN' }));
    await runOnce({ goals, service: {}, realization: { advance: advanceApp } });
    expect(advanceApp).toHaveBeenCalledTimes(1);
    expect(advanceApp).toHaveBeenCalledWith(expect.objectContaining({ appId: 'checkpoint', goals }));
  });
});

describe('revenue-autopilot-tick: mainLoop', () => {
  beforeEach(() => {
    mockSync.mockReset().mockResolvedValue(undefined);
    mockAdvance.mockReset().mockResolvedValue({ stage: 'payment' });
  });

  it('ticks repeatedly until shouldStop, sleeping between ticks', async () => {
    const sleeps: number[] = [];
    await mainLoop({
      shouldStop: () => mockAdvance.mock.calls.length >= 3,
      sleepFn: async (ms) => { sleeps.push(ms); },
      tickIntervalMs: 60000,
      service: {},
      goals: {},
    });
    expect(mockAdvance.mock.calls.length).toBe(3);
    expect(sleeps).toEqual([60000, 60000, 60000]);
  });

  it('backs off longer on a thrown error and keeps going', async () => {
    let calls = 0;
    const sleeps: number[] = [];
    mockAdvance.mockImplementation(async () => {
      calls += 1;
      if (calls === 1) throw new Error('transient db failure');
      return { stage: 'payment' };
    });
    await mainLoop({
      shouldStop: () => calls >= 3,
      sleepFn: async (ms) => { sleeps.push(ms); },
      tickIntervalMs: 60000,
      errorBackoffMs: 120000,
      service: {},
      goals: {},
    });
    expect(calls).toBe(3);
    expect(sleeps[0]).toBe(120000); // backoff after the error
    expect(sleeps.slice(1)).toEqual([60000, 60000]);
  });
});
