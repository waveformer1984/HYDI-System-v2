import {
  classifyObservation,
  ObservationHysteresis,
  ObservationMetricsCollector,
} from '../../lib/operational/ObservationConfidence';
import type { ObservationSource } from '../../lib/operational/types';

describe('ObservationConfidence — Phase 6: Observer Integrity', () => {
  // Helper to create an observation source
  const src = (
    name: string,
    ok: boolean,
    value: string,
    isObserverFailure = false,
  ): ObservationSource => ({
    name,
    ok,
    value,
    isObserverFailure,
    checkedAt: new Date().toISOString(),
  });

  describe('classifyObservation', () => {
    it('classifies as OBSERVER_FAILURE when docker inspect fails but REST probe succeeds', () => {
      const sources = [
        src('docker-inspect', false, 'docker inspect failed', true),
        src('rest-probe', true, 'REST API responding', false),
      ];
      const result = classifyObservation('supabase_db', sources);
      expect(result.classification).toBe('OBSERVER_FAILURE');
      expect(result.confidence).toBe('HIGH');
      expect(result.recoveryAuthorized).toBe(false);
      expect(result.reason).toContain('Observer failure');
    });

    it('classifies as CONFIRMED_FAILURE when all sources agree target is down', () => {
      const sources = [
        src('docker-inspect', false, 'stopped', false),
        src('rest-probe', false, 'REST API unreachable', false),
      ];
      const result = classifyObservation('supabase_db', sources);
      expect(result.classification).toBe('CONFIRMED_FAILURE');
      expect(result.recoveryAuthorized).toBe(true);
      expect(result.confidence).toBe('HIGH'); // 2 sources agree
    });

    it('classifies as OBSERVATION_UNCERTAIN when sources conflict (one says down, one says healthy)', () => {
      const sources = [
        src('docker-inspect', false, 'stopped', false),
        src('rest-probe', true, 'REST API responding', false),
      ];
      const result = classifyObservation('supabase_db', sources);
      expect(result.classification).toBe('OBSERVATION_UNCERTAIN');
      expect(result.confidence).toBe('LOW');
      expect(result.recoveryAuthorized).toBe(false);
    });

    it('classifies as OBSERVATION_UNCERTAIN when all observers fail (no target evidence)', () => {
      const sources = [
        src('docker-inspect', false, 'docker inspect failed', true),
        src('rest-probe', false, 'timeout', true),
      ];
      const result = classifyObservation('supabase_db', sources);
      expect(result.classification).toBe('OBSERVATION_UNCERTAIN');
      expect(result.confidence).toBe('NONE');
      expect(result.recoveryAuthorized).toBe(false);
    });

    it('classifies as OBSERVER_FAILURE with HIGH confidence when observer fails but service is healthy', () => {
      const sources = [
        src('docker-inspect', false, 'docker not available', true),
        src('rest-probe', true, 'HTTP 200', false),
      ];
      const result = classifyObservation('supabase_rest', sources);
      expect(result.classification).toBe('OBSERVER_FAILURE');
      expect(result.recoveryAuthorized).toBe(false);
    });

    it('classifies with MEDIUM confidence when only one source confirms failure', () => {
      const sources = [
        src('docker-inspect', false, 'stopped', false),
      ];
      const result = classifyObservation('supabase_db', sources);
      expect(result.classification).toBe('CONFIRMED_FAILURE');
      expect(result.confidence).toBe('MEDIUM'); // only 1 source
      expect(result.recoveryAuthorized).toBe(true);
    });

    it('returns OBSERVATION_UNCERTAIN when no sources are provided', () => {
      const result = classifyObservation('unknown', []);
      expect(result.classification).toBe('OBSERVATION_UNCERTAIN');
      expect(result.confidence).toBe('NONE');
      expect(result.recoveryAuthorized).toBe(false);
    });

    it('populates corroboratingEvidence and conflictingEvidence correctly', () => {
      const sources = [
        src('docker-inspect', false, 'stopped', false),
        src('rest-probe', true, 'HTTP 200', false),
      ];
      const result = classifyObservation('supabase_db', sources);
      expect(result.corroboratingEvidence.length).toBe(1); // docker-inspect
      expect(result.conflictingEvidence.length).toBe(1); // rest-probe
    });
  });

  describe('ObservationHysteresis', () => {
    it('starts in HEALTHY state', () => {
      const h = new ObservationHysteresis();
      expect(h.getState('supabase_db')).toBe('HEALTHY');
    });

    it('does not authorize recovery on first confirmed failure (needs 2 consecutive)', () => {
      const h = new ObservationHysteresis({ consecutiveFailuresToConfirm: 2 });
      const assessment = classifyObservation('supabase_db', [
        src('docker-inspect', false, 'stopped', false),
        src('rest-probe', false, 'unreachable', false),
      ]);
      const state = h.record('supabase_db', assessment);
      expect(state).toBe('FAILURE_SUSPECTED');
      expect(h.isRecoveryAuthorized('supabase_db')).toBe(false);
    });

    it('authorizes recovery after 2 consecutive confirmed failures', () => {
      const h = new ObservationHysteresis({ consecutiveFailuresToConfirm: 2 });
      const assessment = classifyObservation('supabase_db', [
        src('docker-inspect', false, 'stopped', false),
        src('rest-probe', false, 'unreachable', false),
      ]);
      h.record('supabase_db', assessment);
      const state2 = h.record('supabase_db', assessment);
      expect(state2).toBe('FAILURE_CONFIRMED');
      expect(h.isRecoveryAuthorized('supabase_db')).toBe(true);
    });

    it('resets to HEALTHY after a successful observation', () => {
      const h = new ObservationHysteresis({ consecutiveFailuresToConfirm: 2 });
      const failAssessment = classifyObservation('supabase_db', [
        src('docker-inspect', false, 'stopped', false),
        src('rest-probe', false, 'unreachable', false),
      ]);
      h.record('supabase_db', failAssessment);
      const okAssessment = classifyObservation('supabase_db', [
        src('docker-inspect', true, 'running', false),
        src('rest-probe', true, 'HTTP 200', false),
      ]);
      const state = h.record('supabase_db', okAssessment);
      expect(state).toBe('HEALTHY');
    });

    it('transitions to OBSERVATION_UNCERTAIN on observer failure', () => {
      const h = new ObservationHysteresis();
      const assessment = classifyObservation('supabase_db', [
        src('docker-inspect', false, 'docker inspect failed', true),
        src('rest-probe', true, 'HTTP 200', false),
      ]);
      const state = h.record('supabase_db', assessment);
      expect(state).toBe('OBSERVATION_UNCERTAIN');
      expect(h.isRecoveryAuthorized('supabase_db')).toBe(false);
    });

    it('does not authorize recovery from OBSERVATION_UNCERTAIN state', () => {
      const h = new ObservationHysteresis();
      const assessment = classifyObservation('supabase_db', [
        src('docker-inspect', false, 'docker inspect failed', true),
        src('rest-probe', true, 'HTTP 200', false),
      ]);
      h.record('supabase_db', assessment);
      expect(h.isRecoveryAuthorized('supabase_db')).toBe(false);
    });

    it('transitions to OBSERVER_FAILED after prolonged observer failure', () => {
      const h = new ObservationHysteresis({ consecutiveFailuresToConfirm: 2 });
      const assessment = classifyObservation('supabase_db', [
        src('docker-inspect', false, 'docker inspect failed', true),
        src('rest-probe', false, 'timeout', true),
      ]);
      // Record enough uncertain observations to trigger OBSERVER_FAILED
      for (let i = 0; i < 5; i++) {
        h.record('supabase_db', assessment);
      }
      const state = h.getState('supabase_db');
      expect(state).toBe('OBSERVER_FAILED');
      expect(h.isRecoveryAuthorized('supabase_db')).toBe(false);
    });

    it('tracks recovery state correctly', () => {
      const h = new ObservationHysteresis();
      h.markRecovering('supabase_db');
      expect(h.getState('supabase_db')).toBe('RECOVERING');
      h.markRecovered('supabase_db', true);
      expect(h.getState('supabase_db')).toBe('HEALTHY');
      h.markRecovering('supabase_db');
      h.markRecovered('supabase_db', false);
      expect(h.getState('supabase_db')).toBe('FAILURE_CONFIRMED');
    });

    it('preserves observation history', () => {
      const h = new ObservationHysteresis();
      const assessment = classifyObservation('supabase_db', [
        src('docker-inspect', true, 'running', false),
      ]);
      h.record('supabase_db', assessment);
      const history = h.getHistory('supabase_db');
      expect(history.length).toBe(1);
      expect(history[0].ok).toBe(true);
    });
  });

  describe('ObservationMetricsCollector', () => {
    it('counts observer failures correctly', () => {
      const m = new ObservationMetricsCollector();
      const observerFailure = classifyObservation('supabase_db', [
        src('docker-inspect', false, 'failed', true),
        src('rest-probe', true, 'ok', false),
      ]);
      m.recordObservation(observerFailure);
      const metrics = m.getMetrics();
      expect(metrics.totalObservations).toBe(1);
      expect(metrics.observerFailures).toBe(1);
      expect(metrics.confirmedFailures).toBe(0);
    });

    it('counts false recoveries prevented', () => {
      const m = new ObservationMetricsCollector();
      // Observer failure — recovery should NOT be authorized
      const observerFailure = classifyObservation('supabase_db', [
        src('docker-inspect', false, 'failed', true),
        src('rest-probe', true, 'ok', false),
      ]);
      m.recordObservation(observerFailure);
      // Uncertain — recovery should NOT be authorized
      const uncertain = classifyObservation('supabase_db', [
        src('docker-inspect', false, 'stopped', false),
        src('rest-probe', true, 'ok', false),
      ]);
      m.recordObservation(uncertain);
      const metrics = m.getMetrics();
      expect(metrics.falseRecoveriesPrevented).toBe(2);
    });

    it('counts recovery attempts and escalations', () => {
      const m = new ObservationMetricsCollector();
      m.recordRecoveryAttempt(true);
      m.recordRecoveryAttempt(false);
      m.recordEscalation();
      const metrics = m.getMetrics();
      expect(metrics.recoveryAttempts).toBe(2);
      expect(metrics.successfulRecoveries).toBe(1);
      expect(metrics.failedRecoveries).toBe(1);
      expect(metrics.escalations).toBe(1);
    });
  });
});
