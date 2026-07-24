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
    expect(typeof result.summary.healthScore).toBe('number');
  });

  test('exports prometheus metrics', () => {
    dashboard.recordSnapshot({});
    const metrics = dashboard.exportMetrics('prometheus');
    expect(metrics).toContain('hydi_agent_health');
    expect(metrics).toContain('hydi_health_score');
  });

  test('respects history limit', () => {
    for (let i = 0; i < 15; i++) {
      dashboard.recordSnapshot({});
    }
    expect(dashboard.history.timestamps.length).toBeLessThanOrEqual(10);
  });

  test('getHealthScore returns a number between 0 and 1', () => {
    dashboard.recordSnapshot({});
    const score = dashboard.getHealthScore();
    expect(typeof score).toBe('number');
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(1);
  });

  test('getTrend returns historical trend data', () => {
    dashboard.recordSnapshot({});
    dashboard.recordSnapshot({});
    const trend = dashboard.getTrend('agentHealth', 60000);
    expect(trend).toHaveProperty('values');
    expect(trend).toHaveProperty('average');
    expect(trend).toHaveProperty('slope');
  });

  test('getTrend for unknown metric returns null', () => {
    expect(dashboard.getTrend('unknown', 1000)).toBeNull();
  });

  test('getDashboard includes new metrics', () => {
    const coreLoop = {
      metrics: { revenueGenerated: 100, loopsFailed: 0 },
      getMemoryUsage: () => 0.2,
      getGPUUsage: () => 0.5,
      getNetworkLatency: () => 120,
    };
    const reflectionEngine = {
      getStatus: () => ({
        totalReflections: 3,
        latestReflection: { revenue: 10 },
        rankings: { revenue: [{ strategy: 'outreach', score: 0.9 }] },
      }),
    };

    const result = dashboard.getDashboard({ coreLoop, reflectionEngine });

    expect(result.summary.gpuUsage).toBe(0.5);
    expect(result.summary.networkLatency).toBe(120);
    expect(result.summary.reflectionStats.totalReflections).toBe(3);
    expect(typeof result.summary.revenueTrend).toBe('number');
    expect(typeof result.summary.failureTrend).toBe('number');
    expect(result.missionReplay).toBeDefined();
    expect(result.historicalAnalytics).toBeDefined();
  });

  test('exportDashboard supports json and csv', () => {
    dashboard.recordSnapshot({});
    const json = dashboard.exportDashboard('json');
    expect(JSON.parse(json)).toHaveProperty('summary');

    const csv = dashboard.exportDashboard('csv');
    const rows = csv.trim().split('\n');
    expect(rows.length).toBe(2);
    expect(rows[0].split(',').length).toBeGreaterThan(0);
  });

  test('exportDashboard csv with includeHistory has multiple rows', () => {
    dashboard.recordSnapshot({});
    dashboard.recordSnapshot({});
    const csv = dashboard.exportDashboard('csv', { includeHistory: true });
    const rows = csv.trim().split('\n');
    expect(rows.length).toBeGreaterThan(2);
  });

  test('getMissionReplay returns mission timeline', () => {
    const fakeMissionPlanner = {
      getMission: (id) => ({
        id,
        name: 'benchmark',
        status: 'active',
        progress: 0.5,
        tasks: [
          {
            id: 't1',
            status: 'completed',
            type: 'automation',
            startedAt: '2024-01-01T00:00:00.000Z',
            completedAt: '2024-01-01T00:00:01.000Z',
          },
        ],
      }),
    };

    const replay = dashboard.getMissionReplay('m1', { missionPlanner: fakeMissionPlanner });
    expect(replay.missionId).toBe('m1');
    expect(replay.replay[0].duration).toBe(1000);
  });

  test('getHistoricalAnalytics returns aggregated metrics', () => {
    dashboard.recordSnapshot({});
    const analytics = dashboard.getHistoricalAnalytics();
    expect(analytics).toHaveProperty('avgAgentHealth');
    expect(analytics).toHaveProperty('revenueGrowthPerSecond');
    expect(analytics).toHaveProperty('failureRatePerSecond');
  });

  test('tracks recovery events from watchdog and selfHealing', () => {
    const fakeWatchdog = new (require('events').EventEmitter)();
    const fakeSelfHealing = new (require('events').EventEmitter)();

    dashboard.getDashboard({ watchdog: fakeWatchdog, selfHealing: fakeSelfHealing });
    fakeWatchdog.emit('agent_recovered', { agentId: 'a1' });
    fakeSelfHealing.emit('healing_completed', { symptom: { type: 'api_failure' } });

    const result = dashboard.getDashboard({ watchdog: fakeWatchdog, selfHealing: fakeSelfHealing });
    expect(result.summary.recoveryEvents).toBe(2);
    expect(dashboard.recoveryEvents.length).toBe(2);
  });
});
