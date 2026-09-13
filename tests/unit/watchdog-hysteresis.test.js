'use strict';

/**
 * Regression test for the watchdog hysteresis gap found 2026-09-12:
 * protoforge-core crashed and stayed down for 9+ hours (272 consecutive
 * real ECONNREFUSED polls) because checkEndpoint/checkOllama never fed
 * their observations into classifyObservation/observationHysteresis --
 * only the Docker-based checks (supabase_db, supabase_rest) did. Every
 * endpoint result's `f._hysteresisState` was always undefined, which
 * scripts/watchdog.js's recovery gate defaults to 'HEALTHY', so
 * "need FAILURE_CONFIRMED" printed on literally every poll forever and
 * RecoveryEngine was never invoked no matter how long the outage ran.
 *
 * classifyEndpointObservation is a pure function over hysteresis state
 * shared at module scope (same singleton scripts/watchdog.js uses in
 * production) -- each test below uses its own unique component name so
 * they can't see each other's history.
 */

const { classifyEndpointObservation } = require('../../scripts/watchdog');

describe('classifyEndpointObservation: the actual fix', () => {
  it('advances to FAILURE_CONFIRMED after 2 consecutive UNAVAILABLE observations (the crashed-process case)', () => {
    const name = 'test-crashed-service';
    const first = classifyEndpointObservation(name, 'UNAVAILABLE');
    expect(first.hysteresisState).toBe('FAILURE_SUSPECTED');
    expect(first.assessment.recoveryAuthorized).toBe(true);

    const second = classifyEndpointObservation(name, 'UNAVAILABLE');
    expect(second.hysteresisState).toBe('FAILURE_CONFIRMED');
  });

  it('does NOT get stuck the way the real 9-hour incident did: it must not report HEALTHY across repeated UNAVAILABLE observations', () => {
    const name = 'test-stuck-repro';
    const states = [];
    for (let i = 0; i < 10; i += 1) {
      states.push(classifyEndpointObservation(name, 'UNAVAILABLE').hysteresisState);
    }
    // The pre-fix bug: every single one of these would have been read as
    // 'HEALTHY' by the caller (f._hysteresisState || 'HEALTHY' with
    // _hysteresisState always undefined). Prove that's no longer possible.
    expect(states.every((s) => s !== 'HEALTHY')).toBe(true);
    expect(states[states.length - 1]).toBe('FAILURE_CONFIRMED');
  });
});

describe('classifyEndpointObservation: DEGRADED must never authorize recovery', () => {
  it('a real, honestly-reported DEGRADED state (e.g. heidi-web mid-CRITICAL-escalation) stays HEALTHY hysteresis, not a failure', () => {
    const name = 'test-degraded-service';
    for (let i = 0; i < 5; i += 1) {
      const result = classifyEndpointObservation(name, 'DEGRADED');
      expect(result.hysteresisState).toBe('HEALTHY');
      expect(result.assessment.recoveryAuthorized).toBe(false);
    }
  });
});

describe('classifyEndpointObservation: HEALTHY and UNKNOWN', () => {
  it('HEALTHY keeps hysteresis at HEALTHY', () => {
    const name = 'test-healthy-service';
    const result = classifyEndpointObservation(name, 'HEALTHY');
    expect(result.hysteresisState).toBe('HEALTHY');
    expect(result.assessment.classification).toBe('HEALTHY');
  });

  it('UNKNOWN is treated as an observer failure, never as a confirmed target failure', () => {
    const name = 'test-unknown-service';
    for (let i = 0; i < 5; i += 1) {
      const result = classifyEndpointObservation(name, 'UNKNOWN');
      expect(result.assessment.recoveryAuthorized).toBe(false);
      expect(result.hysteresisState).not.toBe('FAILURE_CONFIRMED');
    }
  });
});

describe('classifyEndpointObservation: recovery from a confirmed failure', () => {
  it('a service that comes back HEALTHY after being confirmed-down resets to HEALTHY', () => {
    const name = 'test-recovered-service';
    classifyEndpointObservation(name, 'UNAVAILABLE');
    const confirmed = classifyEndpointObservation(name, 'UNAVAILABLE');
    expect(confirmed.hysteresisState).toBe('FAILURE_CONFIRMED');

    const recovered = classifyEndpointObservation(name, 'HEALTHY');
    expect(recovered.hysteresisState).toBe('HEALTHY');
  });
});
