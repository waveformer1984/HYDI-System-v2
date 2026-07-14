/**
 * Unit tests for the real ReplayEngine (lib/protoforge/replay-engine.ts).
 *
 * Ported from the archived modules/replay-engine-v2.js test suite — same
 * assertions, same key invariant (same RAW LEDGER input -> same pipeline
 * output; any divergence == real drift), but dependencies are injected via
 * the constructor instead of jest.mock'd module singletons, matching how
 * createReplayEngine() wires the real kilo/ + lib/protoforge/ pipeline.
 */

import { ReplayEngine, ReplayDeps, LedgerEvent, CascadeResult, KiloResult, ProtoForgeResult } from '../../lib/protoforge/replay-engine';

function makeLedgerEvent(fingerprint = 'evt-001'): LedgerEvent {
  return { fingerprint, event_type: 'test_event', payload: {}, created_at: new Date().toISOString() };
}

function makeCascadeResult(classification = 'NOMINAL', confidence = 0.9): CascadeResult {
  return { classification, confidence };
}

function makeKiloResult(hypotheses: string[] = ['System stable']): KiloResult {
  return { hypotheses };
}

function makeDeps(overrides: Partial<ReplayDeps> = {}): ReplayDeps {
  return {
    getEvent: jest.fn(async () => makeLedgerEvent()),
    classify: jest.fn(async () => makeCascadeResult()),
    generateHypotheses: jest.fn(async () => makeKiloResult()),
    decide: jest.fn(async (): Promise<ProtoForgeResult | null> => ({ decision: 'approve' })),
    ...overrides,
  };
}

// ── normalize() ─────────────────────────────────────────────────────────────

describe('normalize()', () => {
  const engine = new ReplayEngine(makeDeps());

  it('returns safe defaults for null input', () => {
    expect(engine.normalize(null)).toEqual({ type: 'NONE', confidence: '0.00', count: 0, success: false });
  });

  it('returns safe defaults for undefined', () => {
    expect(engine.normalize(undefined)).toEqual({ type: 'NONE', confidence: '0.00', count: 0, success: false });
  });

  it('normalizes classification and rounds confidence to 2 dp', () => {
    const result = engine.normalize({ classification: 'ALERT', confidence: 0.8567, hypotheses_count: 3, success: true });
    expect(result.type).toBe('ALERT');
    expect(result.confidence).toBe('0.86');
    expect(result.count).toBe(3);
    expect(result.success).toBe(true);
  });

  it('treats missing confidence as 0.00', () => {
    const result = engine.normalize({ classification: 'X', success: false });
    expect(result.confidence).toBe('0.00');
  });

  it('treats missing hypotheses_count as 0', () => {
    const result = engine.normalize({ classification: 'X', success: false });
    expect(result.count).toBe(0);
  });

  it('produces identical output for identical input (determinism check)', () => {
    const stage = { classification: 'STABLE', confidence: 0.75, hypotheses_count: 1, success: true };
    expect(engine.normalize(stage)).toEqual(engine.normalize(stage));
  });
});

// ── compareWithStoredTrace() ────────────────────────────────────────────────

describe('compareWithStoredTrace()', () => {
  let engine: ReplayEngine;
  beforeEach(() => {
    engine = new ReplayEngine(makeDeps());
  });

  it('returns NO_BASELINE when no stored trace exists', () => {
    const trace = { fingerprint: 'evt-new', replay_timestamp: '', stages: { cascade: { classification: 'OK', confidence: 0.9, success: true } } };
    const result = engine.compareWithStoredTrace('evt-new', trace);
    expect(result.detected).toBe(false);
    expect(result.type).toBe('NO_BASELINE');
  });

  it('detects no drift when traces match exactly', () => {
    const trace = {
      fingerprint: 'evt-match',
      replay_timestamp: '',
      stages: {
        cascade: { classification: 'ALERT', confidence: 0.9, success: true },
        kilo: { hypotheses_count: 2, success: true },
      },
    };
    engine.executionTraces.set('evt-match', trace);
    const result = engine.compareWithStoredTrace('evt-match', trace);
    expect(result.detected).toBe(false);
    expect(result.type).toBe('NONE');
  });

  it('flags SIGNIFICANT_DRIFT when classification changes (HIGH impact)', () => {
    engine.executionTraces.set('evt-drift', {
      fingerprint: 'evt-drift',
      replay_timestamp: '',
      stages: { cascade: { classification: 'NOMINAL', confidence: 0.9, success: true }, kilo: { hypotheses_count: 0, success: true } },
    });
    const updated = {
      fingerprint: 'evt-drift',
      replay_timestamp: '',
      stages: { cascade: { classification: 'ALERT', confidence: 0.9, success: true }, kilo: { hypotheses_count: 0, success: true } },
    };
    const result = engine.compareWithStoredTrace('evt-drift', updated);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('SIGNIFICANT_DRIFT');
    const cascadeDiff = result.differences?.find((d) => d.field === 'classification');
    expect(cascadeDiff).toBeDefined();
    expect(cascadeDiff?.impact).toBe('HIGH');
  });

  it('flags NULL_OUTPUT drift when new trace is null', () => {
    engine.executionTraces.set('evt-null', {
      fingerprint: 'evt-null',
      replay_timestamp: '',
      stages: { cascade: { classification: 'OK', confidence: 0.8, success: true } },
    });
    const result = engine.compareWithStoredTrace('evt-null', null);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('NULL_OUTPUT');
  });

  it('flags NULL_BASELINE drift when stored trace has no stages', () => {
    engine.executionTraces.set('evt-no-stages', { fingerprint: 'evt-no-stages', replay_timestamp: '', stages: null as any });
    const newTrace = { fingerprint: 'evt-no-stages', replay_timestamp: '', stages: { cascade: { classification: 'OK', confidence: 0.9, success: true } } };
    const result = engine.compareWithStoredTrace('evt-no-stages', newTrace);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('NULL_BASELINE');
  });

  it('surfaces confidence difference as MEDIUM impact', () => {
    engine.executionTraces.set('evt-conf', {
      fingerprint: 'evt-conf',
      replay_timestamp: '',
      stages: { cascade: { classification: 'NOMINAL', confidence: 0.9, success: true }, kilo: { hypotheses_count: 0, success: true } },
    });
    const changed = {
      fingerprint: 'evt-conf',
      replay_timestamp: '',
      stages: { cascade: { classification: 'NOMINAL', confidence: 0.5, success: true }, kilo: { hypotheses_count: 0, success: true } },
    };
    const result = engine.compareWithStoredTrace('evt-conf', changed);
    const confDiff = result.differences?.find((d) => d.field === 'confidence');
    expect(confDiff).toBeDefined();
    expect(confDiff?.impact).toBe('MEDIUM');
  });
});

// ── getStats() / getDriftReport() / getInfo() / clearHistory() ─────────────

describe('getStats()', () => {
  it('returns zeroed stats on a fresh engine', () => {
    const engine = new ReplayEngine(makeDeps());
    const stats = engine.getStats();
    expect(stats.totalReplays).toBe(0);
    expect(stats.successfulReplays).toBe(0);
    expect(stats.driftDetected).toBe(0);
    expect(stats.determinism_rate).toBe('100%');
    expect(stats.drift_rate).toBe('0%');
  });
});

describe('getDriftReport()', () => {
  it('returns empty report when no drift events exist', () => {
    const engine = new ReplayEngine(makeDeps());
    const report = engine.getDriftReport();
    expect(report.total_drift_events).toBe(0);
    expect(report.drift_rate).toBe('0%');
    expect(report.recent_drift).toHaveLength(0);
  });
});

describe('getInfo()', () => {
  const engine = new ReplayEngine(makeDeps());

  it('returns the correct engine type', () => {
    expect(engine.getInfo().type).toBe('REPLAY_ENGINE');
  });

  it('lists determinism rules', () => {
    const { rules } = engine.getInfo();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((r) => /same input/i.test(r))).toBe(true);
  });

  it('includes current config', () => {
    const { config } = engine.getInfo();
    expect(typeof config.driftThreshold).toBe('number');
    expect(config.driftThreshold).toBeLessThan(1);
  });
});

describe('clearHistory()', () => {
  it('resets replayHistory and driftEvents', () => {
    const engine = new ReplayEngine(makeDeps());
    engine.replayHistory.push({ event_id: 'x' } as any);
    engine.driftEvents.push({ detected: true, type: 'MINOR_DRIFT', message: '' });
    engine.clearHistory();
    expect(engine.replayHistory).toHaveLength(0);
    expect(engine.driftEvents).toHaveLength(0);
  });
});

// ── replayEvent() ───────────────────────────────────────────────────────────

describe('replayEvent()', () => {
  it('passes an event through all pipeline stages and stores a trace', async () => {
    const deps = makeDeps({
      getEvent: jest.fn(async () => makeLedgerEvent('evt-100')),
      classify: jest.fn(async () => makeCascadeResult('NOMINAL', 0.95)),
      generateHypotheses: jest.fn(async () => makeKiloResult()),
      decide: jest.fn(async () => ({ decision: 'approve' })),
    });
    const engine = new ReplayEngine(deps);

    const result = await engine.replayEvent('evt-100');

    expect(result.event_id).toBe('evt-100');
    expect(result.trace.stages.cascade?.classification).toBe('NOMINAL');
    expect(result.trace.stages.cascade?.success).toBe(true);
    expect(result.trace.stages.kilo).toBeDefined();
    expect(result.trace.stages.kilo?.success).toBe(true);
    expect(result.trace.stages.protoforge?.success).toBe(true);
    expect(typeof result.replay_duration_ms).toBe('number');
  });

  it('increments totalReplays and successfulReplays stats', async () => {
    const engine = new ReplayEngine(makeDeps({ getEvent: jest.fn(async () => makeLedgerEvent('evt-stat')) }));
    await engine.replayEvent('evt-stat');
    expect(engine.stats.totalReplays).toBe(1);
    expect(engine.stats.successfulReplays).toBe(1);
  });

  it('throws when event is not found in the ledger', async () => {
    const engine = new ReplayEngine(makeDeps({ getEvent: jest.fn(async () => null) }));
    await expect(engine.replayEvent('evt-missing')).rejects.toThrow('Event not found in ledger: evt-missing');
  });

  it('stores the trace in executionTraces map', async () => {
    const engine = new ReplayEngine(makeDeps({ getEvent: jest.fn(async () => makeLedgerEvent('evt-store')) }));
    await engine.replayEvent('evt-store', true);
    expect(engine.executionTraces.has('evt-store')).toBe(true);
  });
});

// ── Determinism invariant ────────────────────────────────────────────────────

describe('Determinism invariant — same input must produce same output', () => {
  it('replaying the same event twice with identical pipeline output produces no drift', async () => {
    const engine = new ReplayEngine(
      makeDeps({
        getEvent: jest.fn(async () => makeLedgerEvent('evt-det')),
        classify: jest.fn(async () => makeCascadeResult('STABLE', 0.8)),
        generateHypotheses: jest.fn(async () => makeKiloResult(['System stable'])),
      }),
    );

    const first = await engine.replayEvent('evt-det');
    engine.executionTraces.set('evt-det', first.trace);

    const second = await engine.replayEvent('evt-det');

    expect(second.drift_detected.detected).toBe(false);
  });

  it('detects drift when classification changes between replays', async () => {
    let call = 0;
    const engine = new ReplayEngine(
      makeDeps({
        getEvent: jest.fn(async () => makeLedgerEvent('evt-change')),
        classify: jest.fn(async () => {
          call++;
          return call === 1 ? makeCascadeResult('NOMINAL', 0.9) : makeCascadeResult('ALERT', 0.9);
        }),
      }),
    );

    const first = await engine.replayEvent('evt-change');
    engine.executionTraces.set('evt-change', first.trace);

    const second = await engine.replayEvent('evt-change');

    expect(second.drift_detected.detected).toBe(true);
    expect(second.drift_detected.type).toBe('SIGNIFICANT_DRIFT');
  });
});
