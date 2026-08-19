/**
 * Canonical adaptation vocabulary tests
 *
 * Verifies that all adaptation types and actions produced by
 * HeidiMemorySystem, HeidiSelfAwareness, and other producers
 * are recognized by the canonical vocabulary, and that consumers
 * no longer log "Unknown adaptation type".
 */

const {
  ADAPTATION_TYPES,
  ADAPTATION_ACTIONS,
  ACTION_TO_TYPE,
  normalize,
  isValidType,
  isValidAction,
} = require('../../src/core/adaptation-vocabulary');

describe('Canonical Adaptation Vocabulary', () => {
  describe('known types', () => {
    it('includes all previously-unknown types', () => {
      // These were the types that caused "Unknown adaptation type" logs
      expect(isValidType('drift_mitigation')).toBe(true);
      expect(isValidType('failure_mitigation')).toBe(true);
      expect(isValidType('success_amplification')).toBe(true);
    });

    it('includes all originally-handled types', () => {
      expect(isValidType('strategy_avoidance')).toBe(true);
      expect(isValidType('strategy_preference')).toBe(true);
      expect(isValidType('confidence_calibration')).toBe(true);
    });

    it('includes new canonical types', () => {
      expect(isValidType('cost_optimization')).toBe(true);
      expect(isValidType('model_switch')).toBe(true);
    });
  });

  describe('known actions', () => {
    it('includes all actions from HeidiMemorySystem', () => {
      expect(isValidAction('reduce_confidence_threshold')).toBe(true);
      expect(isValidAction('avoid_strategy')).toBe(true);
      expect(isValidAction('increase_strategy_preference')).toBe(true);
    });

    it('includes all actions from HeidiSelfAwareness', () => {
      expect(isValidAction('reduce_confidence_threshold')).toBe(true);
      expect(isValidAction('switch_primary_model')).toBe(true);
      expect(isValidAction('reduce_external_usage')).toBe(true);
      expect(isValidAction('reduce_drift')).toBe(true);
      expect(isValidAction('improve_roi')).toBe(true);
    });
  });

  describe('normalize', () => {
    it('infers type from action when type is missing (HeidiSelfAwareness pattern)', () => {
      const rec = normalize({ action: 'reduce_drift', priority: 'high', reason: 'test' });
      expect(rec.type).toBe('drift_mitigation');
      expect(rec.action).toBe('reduce_drift');
    });

    it('infers type from avoid_strategy action', () => {
      const rec = normalize({ action: 'avoid_strategy', target: 'failing_strategy' });
      expect(rec.type).toBe('strategy_avoidance');
    });

    it('preserves explicit type when provided (HeidiMemorySystem pattern)', () => {
      const rec = normalize({ type: 'drift_mitigation', action: 'reduce_confidence_threshold' });
      expect(rec.type).toBe('drift_mitigation');
    });

    it('sets type to null for unknown actions', () => {
      const rec = normalize({ action: 'completely_unknown' });
      expect(rec.type).toBeNull();
    });

    it('does not mutate the original recommendation', () => {
      const original = { action: 'reduce_drift', priority: 'high' };
      const normalized = normalize(original);
      expect(original.type).toBeUndefined();
      expect(normalized.type).toBe('drift_mitigation');
    });
  });

  describe('ACTION_TO_TYPE mapping', () => {
    it('maps reduce_confidence_threshold to confidence_calibration', () => {
      expect(ACTION_TO_TYPE['reduce_confidence_threshold']).toBe('confidence_calibration');
    });

    it('maps increase_strategy_preference to strategy_preference', () => {
      expect(ACTION_TO_TYPE['increase_strategy_preference']).toBe('strategy_preference');
    });

    it('maps improve_roi to cost_optimization', () => {
      expect(ACTION_TO_TYPE['improve_roi']).toBe('cost_optimization');
    });
  });
});
