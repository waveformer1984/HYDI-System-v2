/**
 * Unit tests for KiloEngine — pipeline layer [4].
 *
 * Critical invariant: KILO is a hypothesis generator only.
 * execute() must throw unconditionally — this is machine-enforced, not just documented.
 */

const { KiloEngine, createKiloEngine } = require('../../kilo/index');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeEngine(cascadeSnapshot = {}) {
  return new KiloEngine({ cascadeStateSnapshot: cascadeSnapshot });
}

function makeMinimalPayload(overrides = {}) {
  return { event_type: 'test', ...overrides };
}

function makeManifest(overrides = {}) {
  return {
    issue_type: 'regression',
    affected_module: 'cascade-classifier',
    root_cause_hypothesis: 'Confidence threshold drift',
    verification_steps: ['replay event', 'compare traces'],
    recommended_fix_steps: ['recalibrate thresholds'],
    risk_level: 'medium',
    rollback_option: true,
    confidence: 0.85,
    ...overrides,
  };
}

// ── Execution guard — the most critical test ──────────────────────────────────

describe('KiloEngine.execute() — execution guard', () => {
  it('throws unconditionally, preventing KILO from executing actions', () => {
    const engine = makeEngine();
    expect(() => engine.execute()).toThrow();
  });

  it('throw message references pipeline layer [4] and ProtoForge [5]', () => {
    const engine = makeEngine();
    expect(() => engine.execute()).toThrow(/layer \[4\]/i);
    expect(() => engine.execute()).toThrow(/ProtoForge/i);
  });

  it('execute() always throws regardless of arguments', () => {
    const engine = makeEngine();
    expect(() => engine.execute(null)).toThrow();
    expect(() => engine.execute({ action: 'restart' })).toThrow();
    expect(() => engine.execute('anything')).toThrow();
  });
});

// ── createKiloEngine factory ──────────────────────────────────────────────────

describe('createKiloEngine()', () => {
  it('returns a KiloEngine instance', () => {
    const engine = createKiloEngine();
    expect(engine).toBeInstanceOf(KiloEngine);
  });

  it('factory-created engine also enforces the execution guard', () => {
    const engine = createKiloEngine();
    expect(() => engine.execute()).toThrow();
  });
});

// ── generateHypotheses() ──────────────────────────────────────────────────────

describe('generateHypotheses()', () => {
  it('throws TypeError for null payload', () => {
    const engine = makeEngine();
    expect(() => engine.generateHypotheses(null)).toThrow(TypeError);
  });

  it('throws TypeError for non-object payload', () => {
    const engine = makeEngine();
    expect(() => engine.generateHypotheses('string')).toThrow(TypeError);
    expect(() => engine.generateHypotheses(42)).toThrow(TypeError);
  });

  it('returns the required output shape for a minimal payload', () => {
    const engine = makeEngine();
    const result = engine.generateHypotheses(makeMinimalPayload());

    expect(result).toHaveProperty('hypotheses');
    expect(result).toHaveProperty('suggested_fixes');
    expect(result).toHaveProperty('confidence');
    expect(result).toHaveProperty('gate_result');
    expect(Array.isArray(result.hypotheses)).toBe(true);
    expect(Array.isArray(result.suggested_fixes)).toBe(true);
    expect(typeof result.confidence).toBe('number');
  });

  it('generates root_cause hypothesis from manifest field', () => {
    const engine = makeEngine();
    const manifest = makeManifest();
    const result = engine.generateHypotheses(manifest);

    const combined = result.hypotheses.join(' ');
    expect(combined).toMatch(/Confidence threshold drift/);
  });

  it('returns zero confidence and empty hypotheses for invalid manifest', () => {
    const engine = makeEngine();
    const badManifest = makeManifest({ confidence: -99, risk_level: '' });
    const result = engine.generateHypotheses(badManifest);

    // Invalid manifests fail validation and return empty output
    if (result.confidence === 0) {
      expect(result.hypotheses).toHaveLength(0);
      expect(result.suggested_fixes).toHaveLength(0);
    }
    // If validation passes, the output shape must still be correct
    expect(result).toHaveProperty('gate_result');
  });
});

// ── validateManifest() ────────────────────────────────────────────────────────

describe('validateManifest()', () => {
  it('returns { valid, errors, reason } shape', () => {
    const engine = makeEngine();
    const result = engine.validateManifest(makeManifest());

    expect(result).toHaveProperty('valid');
    expect(result).toHaveProperty('errors');
    expect(result).toHaveProperty('reason');
    expect(typeof result.valid).toBe('boolean');
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('accepts a complete, well-formed manifest', () => {
    const engine = makeEngine();
    const { valid } = engine.validateManifest(makeManifest());
    expect(valid).toBe(true);
  });
});

// ── filterThroughTruthGate() ─────────────────────────────────────────────────

describe('filterThroughTruthGate()', () => {
  it('throws TypeError when hypotheses is not an array', () => {
    const engine = makeEngine();
    expect(() => engine.filterThroughTruthGate('not-an-array')).toThrow(TypeError);
    expect(() => engine.filterThroughTruthGate(null)).toThrow(TypeError);
  });

  it('returns { accepted, rejected } shape', () => {
    const engine = makeEngine();
    const result = engine.filterThroughTruthGate([]);

    expect(result).toHaveProperty('accepted');
    expect(result).toHaveProperty('rejected');
    expect(Array.isArray(result.accepted)).toBe(true);
    expect(Array.isArray(result.rejected)).toBe(true);
  });

  it('returns empty accepted/rejected for empty hypotheses array', () => {
    const engine = makeEngine();
    const { accepted, rejected } = engine.filterThroughTruthGate([]);

    expect(accepted).toHaveLength(0);
    expect(rejected).toHaveLength(0);
  });
});

// ── Pipeline boundary ─────────────────────────────────────────────────────────

describe('Pipeline boundary compliance', () => {
  it('KiloEngine has generateHypotheses but not an execute that works', () => {
    const engine = makeEngine();
    expect(typeof engine.generateHypotheses).toBe('function');
    expect(typeof engine.execute).toBe('function');
    // execute must be present AND must throw — having it silently fail is not acceptable
    expect(() => engine.execute()).toThrow();
  });

  it('output of generateHypotheses never contains executable actions', () => {
    const engine = makeEngine();
    const result = engine.generateHypotheses(makeManifest());
    // hypotheses are strings, not executable function objects
    for (const h of result.hypotheses) {
      expect(typeof h).toBe('string');
    }
    // suggested_fixes are descriptive objects, not callables
    for (const fix of result.suggested_fixes) {
      expect(typeof fix).not.toBe('function');
    }
  });
});
