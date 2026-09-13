/**
 * Regression test: self-awareness drift detection crash
 *
 * Bug: calculateDrift() replaced this.metrics.drift with a new object
 * that omitted the `history` field. On the next call, determineDriftTrend()
 * accessed this.metrics.drift.history.length → undefined.length → crash:
 *   "Cannot read properties of undefined (reading 'length')"
 *
 * Fix: update drift fields in-place instead of replacing the entire object.
 */

const path = require('path');

describe('HeidiSelfAwareness drift detection regression', () => {
  let HeidiSelfAwareness;

  beforeAll(() => {
    HeidiSelfAwareness = require('../../src/awareness/HeidiSelfAwareness');
  });

  afterEach(() => {
    // Clear any timers left by constructed instances
    jest.clearAllTimers();
  });

  function makeAction(overrides = {}) {
    return {
      type: 'test_action',
      success: true,
      confidence: 0.8,
      latency: 100,
      cost: 0.05,
      revenue: 0,
      model: 'test-model',
      timestamp: Date.now(),
      ...overrides,
    };
  }

  it('does not crash when calculateDrift is called twice (history field preserved)', async () => {
    const sa = new HeidiSelfAwareness({
      driftCheckInterval: 999999, // don't auto-start
      driftWindow: 20,
      driftThreshold: 0.5,
    });

    // Record enough actions to pass the minimum threshold (10)
    for (let i = 0; i < 15; i++) {
      sa.trackAction(makeAction({ success: i % 3 !== 0 }));
    }

    // First call should work and set history
    await sa.calculateDrift();
    expect(sa.metrics.drift.history).toBeDefined();
    expect(sa.metrics.drift.history.length).toBe(1);

    // Second call should NOT crash — this is the regression
    await sa.calculateDrift();
    expect(sa.metrics.drift.history.length).toBe(2);

    // Third call to verify stability
    await sa.calculateDrift();
    expect(sa.metrics.drift.history.length).toBe(3);
  });

  it('preserves history across multiple drift calculations with trend detection', async () => {
    const sa = new HeidiSelfAwareness({
      driftCheckInterval: 999999,
      driftWindow: 20,
      driftThreshold: 0.5,
    });

    for (let i = 0; i < 15; i++) {
      sa.trackAction(makeAction({ success: true, confidence: 0.9 }));
    }

    // First call — trend should be 'stable' (no history yet)
    await sa.calculateDrift();
    expect(sa.metrics.drift.trend).toBe('stable');

    // Second call — trend should be 'stable' or 'increasing'/'decreasing'
    // but it must NOT crash
    await sa.calculateDrift();
    expect(['stable', 'increasing', 'decreasing']).toContain(sa.metrics.drift.trend);
  });

  it('history field survives reset()', async () => {
    const sa = new HeidiSelfAwareness({
      driftCheckInterval: 999999,
      driftWindow: 20,
    });

    for (let i = 0; i < 15; i++) {
      sa.trackAction(makeAction());
    }

    await sa.calculateDrift();
    expect(sa.metrics.drift.history.length).toBe(1);

    await sa.reset();
    expect(sa.metrics.drift.history).toBeDefined();
    expect(sa.metrics.drift.history.length).toBe(0);

    // After reset, calculateDrift should still work
    for (let i = 0; i < 15; i++) {
      sa.trackAction(makeAction());
    }
    await sa.calculateDrift();
    expect(sa.metrics.drift.history.length).toBe(1);
  });
});
