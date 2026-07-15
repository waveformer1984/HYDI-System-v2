const ObservabilityDashboard = require('../../../src/hydi-v3/ObservabilityDashboard');

describe('ObservabilityDashboard', () => {
  let dashboard;

  beforeEach(() => {
    dashboard = new ObservabilityDashboard({ historyLimit: 10 });
  });

  test('records snapshot and builds dashboard', () => {
    const fakeWatchdog = {
      getStatus: () => ({ healthy: 4, warning: 0, dead: 0, agents: {} }),
    };
    const fakeMissionPlanner = {
      getStatus: () => ({ total: 2, completed: 1 }),
    };
    const fakeDecisionIntelligence = {
      averageConfidence: () => 0.85,
      getStatus: () => ({ totalDecisions: 5 }),
      getHistorySummary: () => ({ revenue: 100 }),
    };

    const result = dashboard.getDashboard({
      watchdog: fakeWatchdog,
      missionPlanner: fakeMissionPlanner,
      decisionIntelligence: fakeDecisionIntelligence,
    });

    expect(result.summary.agentHealth).toBe(1);
    expect(result.summary.missionProgress).toBe(0.5);
    expect(result.summary.decisionConfidence).toBe(0.85);
  });

  test('exports prometheus metrics', () => {
    dashboard.recordSnapshot({});
    const metrics = dashboard.exportMetrics('prometheus');
    expect(metrics).toContain('hydi_agent_health');
  });

  test('respects history limit', () => {
    for (let i = 0; i < 15; i++) {
      dashboard.recordSnapshot({});
    }
    expect(dashboard.history.timestamps.length).toBeLessThanOrEqual(10);
  });
});
