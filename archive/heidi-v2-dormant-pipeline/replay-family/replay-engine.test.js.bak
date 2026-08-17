/**
 * Unit tests for ReplayEngineV2 core determinism logic.
 * All four pipeline dependencies are mocked — no live DB or network required.
 *
 * Key invariant under test: same RAW LEDGER input → same pipeline output.
 * Any divergence == real drift that must be surfaced, not silenced.
 */

// jest.mock() is hoisted before any require(); mocks are in place before the
// singleton ReplayEngineV2 is instantiated at module load time.
jest.mock('../../modules/raw-event-ledger-v2', () => ({
  getById: jest.fn(),
  getRange: jest.fn().mockReturnValue([]),
  getLatest: jest.fn().mockReturnValue([]),
}));
jest.mock('../../modules/cascade-classifier-v2', () => ({
  processEvent: jest.fn(),
}));
jest.mock('../../modules/kilo-analyzer-v2', () => ({
  analyzeEvent: jest.fn(),
}));
jest.mock('../../modules/protoforge-policy-v2', () => ({
  processAnalysis: jest.fn(),
}));

const replayEngine = require('../../modules/replay-engine-v2');
const rawEventLedgerV2 = require('../../modules/raw-event-ledger-v2');
const cascadeClassifierV2 = require('../../modules/cascade-classifier-v2');
const kiloAnalyzerV2 = require('../../modules/kilo-analyzer-v2');
const protoforgePolicyV2 = require('../../modules/protoforge-policy-v2');

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeLedgerRecord(id = 'evt-001') {
  return { id, iso_timestamp: new Date().toISOString() };
}

function makeCascadeResult(classification = 'NOMINAL', confidence = 0.9) {
  return { classification, confidence };
}

function makeKiloResult(hypotheses = ['System stable'], suggested_fixes = []) {
  return { hypotheses, suggested_fixes };
}

// ── Reset singleton state between tests ───────────────────────────────────────

beforeEach(() => {
  jest.clearAllMocks();
  replayEngine.executionTraces.clear();
  replayEngine.replayHistory = [];
  replayEngine.driftEvents = [];
  replayEngine.stats = {
    totalReplays: 0,
    successfulReplays: 0,
    driftDetected: 0,
    averageReplayTime: 0,
    tracesStored: 0,
  };
});

// ── normalize() ───────────────────────────────────────────────────────────────

describe('normalize()', () => {
  it('returns safe defaults for null input', () => {
    expect(replayEngine.normalize(null)).toEqual({
      type: 'NONE',
      confidence: '0.00',
      count: 0,
      success: false,
    });
  });

  it('returns safe defaults for undefined', () => {
    expect(replayEngine.normalize(undefined)).toEqual({
      type: 'NONE',
      confidence: '0.00',
      count: 0,
      success: false,
    });
  });

  it('returns safe defaults for non-object primitives', () => {
    expect(replayEngine.normalize('string').type).toBe('NONE');
    expect(replayEngine.normalize(42).type).toBe('NONE');
  });

  it('normalizes classification and rounds confidence to 2 dp', () => {
    const result = replayEngine.normalize({
      classification: 'ALERT',
      confidence: 0.8567,
      hypotheses_count: 3,
      success: true,
    });
    expect(result.type).toBe('ALERT');
    expect(result.confidence).toBe('0.86');
    expect(result.count).toBe(3);
    expect(result.success).toBe(true);
  });

  it('falls back to type field when classification is absent', () => {
    const result = replayEngine.normalize({ type: 'DRIFT', confidence: 0.5 });
    expect(result.type).toBe('DRIFT');
  });

  it('treats missing confidence as 0.00', () => {
    const result = replayEngine.normalize({ classification: 'X' });
    expect(result.confidence).toBe('0.00');
  });

  it('treats missing hypotheses_count as 0', () => {
    const result = replayEngine.normalize({ classification: 'X' });
    expect(result.count).toBe(0);
  });

  it('produces identical output for identical input (determinism check)', () => {
    const stage = { classification: 'STABLE', confidence: 0.75, hypotheses_count: 1, success: true };
    expect(replayEngine.normalize(stage)).toEqual(replayEngine.normalize(stage));
  });
});

// ── compareWithStoredTrace() ──────────────────────────────────────────────────

describe('compareWithStoredTrace()', () => {
  it('returns NO_BASELINE when no stored trace exists', () => {
    const trace = { stages: { cascade: { classification: 'OK', confidence: 0.9, success: true } } };
    const result = replayEngine.compareWithStoredTrace('evt-new', trace);
    expect(result.detected).toBe(false);
    expect(result.type).toBe('NO_BASELINE');
  });

  it('detects no drift when traces match exactly', () => {
    const trace = {
      stages: {
        cascade: { classification: 'ALERT', confidence: 0.9, success: true },
        kilo: { hypotheses_count: 2, success: true },
      },
    };
    replayEngine.executionTraces.set('evt-match', trace);
    const result = replayEngine.compareWithStoredTrace('evt-match', trace);
    expect(result.detected).toBe(false);
    expect(result.type).toBe('NONE');
  });

  it('flags SIGNIFICANT_DRIFT when classification changes (HIGH impact)', () => {
    const stored = {
      stages: {
        cascade: { classification: 'NOMINAL', confidence: 0.9, success: true },
        kilo: { hypotheses_count: 0, success: true },
      },
    };
    replayEngine.executionTraces.set('evt-drift', stored);

    const updated = {
      stages: {
        cascade: { classification: 'ALERT', confidence: 0.9, success: true },
        kilo: { hypotheses_count: 0, success: true },
      },
    };
    const result = replayEngine.compareWithStoredTrace('evt-drift', updated);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('SIGNIFICANT_DRIFT');
    const cascadeDiff = result.differences.find((d) => d.field === 'classification');
    expect(cascadeDiff).toBeDefined();
    expect(cascadeDiff.impact).toBe('HIGH');
  });

  it('flags NULL_OUTPUT drift when new trace is null', () => {
    replayEngine.executionTraces.set('evt-null', {
      stages: { cascade: { classification: 'OK', confidence: 0.8, success: true } },
    });
    const result = replayEngine.compareWithStoredTrace('evt-null', null);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('NULL_OUTPUT');
  });

  it('flags NULL_BASELINE drift when stored trace has no stages', () => {
    replayEngine.executionTraces.set('evt-no-stages', { stages: null });
    const newTrace = { stages: { cascade: { classification: 'OK', confidence: 0.9, success: true } } };
    const result = replayEngine.compareWithStoredTrace('evt-no-stages', newTrace);
    expect(result.detected).toBe(true);
    expect(result.type).toBe('NULL_BASELINE');
  });

  it('surfaces confidence difference as MEDIUM impact', () => {
    const base = {
      stages: {
        cascade: { classification: 'NOMINAL', confidence: 0.9, success: true },
        kilo: { hypotheses_count: 0, success: true },
      },
    };
    replayEngine.executionTraces.set('evt-conf', base);

    const changed = {
      stages: {
        cascade: { classification: 'NOMINAL', confidence: 0.5, success: true },
        kilo: { hypotheses_count: 0, success: true },
      },
    };
    const result = replayEngine.compareWithStoredTrace('evt-conf', changed);
    const confDiff = result.differences && result.differences.find((d) => d.field === 'confidence');
    expect(confDiff).toBeDefined();
    expect(confDiff.impact).toBe('MEDIUM');
  });
});

// ── getStats() / getDriftReport() ─────────────────────────────────────────────

describe('getStats()', () => {
  it('returns zeroed stats on a fresh (reset) engine', () => {
    const stats = replayEngine.getStats();
    expect(stats.totalReplays).toBe(0);
    expect(stats.successfulReplays).toBe(0);
    expect(stats.driftDetected).toBe(0);
    expect(stats.determinism_rate).toBe('100%');
    expect(stats.drift_rate).toBe('0%');
  });
});

describe('getDriftReport()', () => {
  it('returns empty report when no drift events exist', () => {
    const report = replayEngine.getDriftReport();
    expect(report.total_drift_events).toBe(0);
    expect(report.drift_rate).toBe('0%');
    expect(report.recent_drift).toHaveLength(0);
  });
});

// ── getInfo() ─────────────────────────────────────────────────────────────────

describe('getInfo()', () => {
  it('returns the correct engine type', () => {
    expect(replayEngine.getInfo().type).toBe('REPLAY_ENGINE_V2');
  });

  it('lists determinism rules', () => {
    const { rules } = replayEngine.getInfo();
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.some((r) => /same input/i.test(r))).toBe(true);
  });

  it('includes current config', () => {
    const { config } = replayEngine.getInfo();
    expect(typeof config.driftThreshold).toBe('number');
    expect(config.driftThreshold).toBeLessThan(1);
  });
});

// ── clearHistory() ────────────────────────────────────────────────────────────

describe('clearHistory()', () => {
  it('resets replayHistory and driftEvents', () => {
    replayEngine.replayHistory.push({ event_id: 'x' });
    replayEngine.driftEvents.push({ type: 'MINOR_DRIFT' });
    replayEngine.clearHistory();
    expect(replayEngine.replayHistory).toHaveLength(0);
    expect(replayEngine.driftEvents).toHaveLength(0);
  });
});

// ── replayEvent() ─────────────────────────────────────────────────────────────

describe('replayEvent()', () => {
  it('passes an event through all pipeline stages and stores a trace', async () => {
    rawEventLedgerV2.getById.mockReturnValue(makeLedgerRecord('evt-100'));
    cascadeClassifierV2.processEvent.mockResolvedValue(makeCascadeResult('NOMINAL', 0.95));
    kiloAnalyzerV2.analyzeEvent.mockResolvedValue(makeKiloResult());
    protoforgePolicyV2.processAnalysis.mockResolvedValue({ action_approved: true, priority: 'LOW' });

    const result = await replayEngine.replayEvent('evt-100');

    expect(result.event_id).toBe('evt-100');
    expect(result.failed).toBeUndefined();
    expect(result.trace.stages.cascade.classification).toBe('NOMINAL');
    expect(result.trace.stages.cascade.success).toBe(true);
    expect(result.trace.stages.kilo).toBeDefined();
    expect(result.trace.stages.kilo.success).toBe(true);
    expect(typeof result.replay_duration_ms).toBe('number');
  });

  it('increments totalReplays and successfulReplays stats', async () => {
    rawEventLedgerV2.getById.mockReturnValue(makeLedgerRecord('evt-stat'));
    cascadeClassifierV2.processEvent.mockResolvedValue(makeCascadeResult());
    kiloAnalyzerV2.analyzeEvent.mockResolvedValue(makeKiloResult());
    protoforgePolicyV2.processAnalysis.mockResolvedValue({ priority: 'LOW' });

    await replayEngine.replayEvent('evt-stat');

    expect(replayEngine.stats.totalReplays).toBe(1);
    expect(replayEngine.stats.successfulReplays).toBe(1);
  });

  it('throws when event is not found in the ledger', async () => {
    rawEventLedgerV2.getById.mockReturnValue(null);
    await expect(replayEngine.replayEvent('evt-missing')).rejects.toThrow(
      'Event not found in ledger: evt-missing'
    );
  });

  it('stores the trace in executionTraces map', async () => {
    rawEventLedgerV2.getById.mockReturnValue(makeLedgerRecord('evt-store'));
    cascadeClassifierV2.processEvent.mockResolvedValue(makeCascadeResult());
    kiloAnalyzerV2.analyzeEvent.mockResolvedValue(makeKiloResult());
    protoforgePolicyV2.processAnalysis.mockResolvedValue({ priority: 'LOW' });

    await replayEngine.replayEvent('evt-store', true);

    expect(replayEngine.executionTraces.has('evt-store')).toBe(true);
  });
});

// ── Determinism invariant ─────────────────────────────────────────────────────

describe('Determinism invariant — same input must produce same output', () => {
  it('replaying the same event twice with identical pipeline output produces no drift', async () => {
    const ledgerRecord = makeLedgerRecord('evt-det');
    rawEventLedgerV2.getById.mockReturnValue(ledgerRecord);
    cascadeClassifierV2.processEvent.mockResolvedValue(makeCascadeResult('STABLE', 0.8));
    kiloAnalyzerV2.analyzeEvent.mockResolvedValue(makeKiloResult(['System stable']));
    protoforgePolicyV2.processAnalysis.mockResolvedValue({ priority: 'LOW' });

    // First replay — establishes baseline trace
    const first = await replayEngine.replayEvent('evt-det');
    replayEngine.executionTraces.set('evt-det', first.trace);

    // Second replay — same mocked pipeline output
    const second = await replayEngine.replayEvent('evt-det');

    expect(second.drift_detected.detected).toBe(false);
  });

  it('detects drift when classification changes between replays', async () => {
    rawEventLedgerV2.getById.mockReturnValue(makeLedgerRecord('evt-change'));

    // First run: NOMINAL
    cascadeClassifierV2.processEvent.mockResolvedValueOnce(makeCascadeResult('NOMINAL', 0.9));
    kiloAnalyzerV2.analyzeEvent.mockResolvedValue(makeKiloResult());
    protoforgePolicyV2.processAnalysis.mockResolvedValue({ priority: 'LOW' });

    const first = await replayEngine.replayEvent('evt-change');
    replayEngine.executionTraces.set('evt-change', first.trace);

    // Second run: ALERT — pipeline diverged
    cascadeClassifierV2.processEvent.mockResolvedValueOnce(makeCascadeResult('ALERT', 0.9));

    const second = await replayEngine.replayEvent('evt-change');
    expect(second.drift_detected.detected).toBe(true);
    expect(second.drift_detected.type).toBe('SIGNIFICANT_DRIFT');
  });
});
