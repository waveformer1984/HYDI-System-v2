'use strict';

const {
  evaluateExecTripleGate,
  shouldYieldLease,
  parseHeartbeat,
  assertAllowedAdvisorModel,
  boundsRowUsable,
} = require('../../lib/heidi/agent-persistent-loop');

describe('heidi-agent phase2 — triple gate (8 combinations)', () => {
  const cases = [
    [false, false, false, false],
    [false, false, true, false],
    [false, true, false, false],
    [false, true, true, false],
    [true, false, false, false],
    [true, false, true, false],
    [true, true, false, false],
    [true, true, true, true],
  ];

  it.each(cases)(
    'allowExec=%s advisor=%s bounds=%s -> mayExecute=%s',
    (allowExec, advisorAutoApprove, withinBounds, expected) => {
      const r = evaluateExecTripleGate({ allowExec, advisorAutoApprove, withinBounds });
      expect(r.mayExecute).toBe(expected);
      if (!expected) expect(r.failedGates.length).toBeGreaterThan(0);
    }
  );
});

describe('heidi-agent phase2 — snapshot lease takeover', () => {
  const interval = 30000;
  const selfId = 'instance-a';
  const holder = 'frank';

  it('yields when another instance has a fresh heartbeat', () => {
    const latest = {
      captured_at: new Date().toISOString(),
      payload: {
        lease_holder: holder,
        instance_id: 'instance-b',
        lease_released: false,
      },
    };
    expect(
      shouldYieldLease({ latestRow: latest, holder, instanceId: selfId, intervalMs: interval })
    ).toBe(true);
  });

  it('does not yield when heartbeat is stale (> 2 intervals)', () => {
    const stale = new Date(Date.now() - interval * 3).toISOString();
    const latest = {
      captured_at: stale,
      payload: { lease_holder: holder, instance_id: 'instance-b' },
    };
    expect(
      shouldYieldLease({ latestRow: latest, holder, instanceId: selfId, intervalMs: interval })
    ).toBe(false);
  });

  it('does not yield to own heartbeat', () => {
    const latest = {
      captured_at: new Date().toISOString(),
      payload: { lease_holder: holder, instance_id: selfId },
    };
    expect(
      shouldYieldLease({ latestRow: latest, holder, instanceId: selfId, intervalMs: interval })
    ).toBe(false);
  });

  it('parseHeartbeat respects lease_released', () => {
    const hb = parseHeartbeat({
      captured_at: new Date().toISOString(),
      payload: { lease_holder: 'x', lease_released: true },
    });
    expect(hb.released).toBe(true);
  });
});

describe('heidi-agent phase2 — bounds + advisor model', () => {
  it('boundsRowUsable requires auto_approve_threshold', () => {
    expect(boundsRowUsable({ auto_approve_threshold: 0.85 })).toBe(true);
    expect(boundsRowUsable({})).toBe(false);
    expect(boundsRowUsable(null)).toBe(false);
  });

  it('rejects 1b advisor models', () => {
    expect(() => assertAllowedAdvisorModel('tinyllama:1b')).toThrow(/not allowed/);
    expect(() => assertAllowedAdvisorModel('qwen2.5:3b-instruct-q4_K_M')).not.toThrow();
  });
});