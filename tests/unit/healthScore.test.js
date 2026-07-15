'use strict';

const { computeSubsystemHealth, computeOverallHealth } = require('../../lib/realtime/healthScore');

describe('computeSubsystemHealth', () => {
  const NOW = Date.parse('2026-07-15T12:00:00Z');

  it('reports unknown/0 for a subsystem that has never heartbeat-ed', () => {
    expect(computeSubsystemHealth(null, NOW)).toEqual({ status: 'unknown', health_score: 0 });
    expect(computeSubsystemHealth({ status: 'healthy' }, NOW)).toEqual({ status: 'unknown', health_score: 0 });
  });

  it('reports healthy/100 for a fresh healthy heartbeat', () => {
    const row = { status: 'healthy', last_heartbeat: new Date(NOW - 5000).toISOString() };
    expect(computeSubsystemHealth(row, NOW)).toEqual({ status: 'healthy', health_score: 100 });
  });

  it('downgrades to degraded once the heartbeat is stale, even if last-reported status was healthy', () => {
    const row = { status: 'healthy', last_heartbeat: new Date(NOW - 90 * 1000).toISOString() };
    expect(computeSubsystemHealth(row, NOW)).toEqual({ status: 'degraded', health_score: 60 });
  });

  it('reports offline/0 once the heartbeat exceeds the offline threshold, overriding any reported status', () => {
    const row = { status: 'healthy', last_heartbeat: new Date(NOW - 3 * 60 * 1000).toISOString() };
    expect(computeSubsystemHealth(row, NOW)).toEqual({ status: 'offline', health_score: 0 });
  });

  it('passes through an explicit critical status while fresh', () => {
    const row = { status: 'critical', last_heartbeat: new Date(NOW - 1000).toISOString() };
    expect(computeSubsystemHealth(row, NOW)).toEqual({ status: 'critical', health_score: 20 });
  });
});

describe('computeOverallHealth', () => {
  it('returns 0 for no subsystems', () => {
    expect(computeOverallHealth({})).toBe(0);
  });

  it('averages health scores across subsystems', () => {
    const map = {
      hydi_core: { status: 'healthy', health_score: 100 },
      ursula: { status: 'degraded', health_score: 60 },
      memory: { status: 'offline', health_score: 0 },
      database: { status: 'healthy', health_score: 100 },
    };
    expect(computeOverallHealth(map)).toBe(65); // (100+60+0+100)/4 = 65
  });

  it('an unconfigured subsystem (unknown/0) correctly drags the overall score down', () => {
    const map = {
      hydi_core: { status: 'healthy', health_score: 100 },
      rave_voice: { status: 'unknown', health_score: 0 },
    };
    expect(computeOverallHealth(map)).toBe(50);
  });
});
