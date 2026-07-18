/**
 * REPLAY ENGINE — pipeline layer [7], truth validator (see
 * HEIDI_V2_ARCHITECTURE.md)
 *
 * Re-runs a stored raw-ledger event through CASCADE -> KILO -> ProtoForge
 * and diffs the result against a previously stored execution trace. Same
 * input must produce same output; any divergence is real drift.
 *
 * This is the real replacement for modules/replay-engine-v2.js's in-memory
 * prototype (kept, not yet archived, only for its own sake as prior art —
 * see archive/heidi-v2-dormant-pipeline/README.md). The normalize() /
 * compareWithStoredTrace() / stats logic below is a direct, dependency-free
 * port of that module's core determinism logic; replayEvent() is new,
 * built against real dependencies instead of the four in-memory mocks the
 * old module required.
 *
 * Honesty note: createReplayEngine()'s `classify` stage has no real CASCADE
 * classifier to call (none is wired into this path yet — same gap
 * documented in action-gate.ts), so it treats the ledger event's own
 * `event_type` field as the classification. That's a deterministic
 * passthrough, not real classification logic; replacing it with a genuine
 * CASCADE classifier is follow-up work, not something this module fakes.
 */

export interface StageTrace {
  classification?: string;
  confidence?: number;
  hypotheses_count?: number;
  success: boolean;
}

export interface ExecutionTrace {
  fingerprint: string;
  replay_timestamp: string;
  original_timestamp?: string;
  stages: {
    cascade?: StageTrace;
    kilo?: StageTrace;
    protoforge?: StageTrace;
  };
  duration_ms?: number;
}

export type DriftType = 'NO_BASELINE' | 'NULL_OUTPUT' | 'NULL_BASELINE' | 'NONE' | 'MINOR_DRIFT' | 'SIGNIFICANT_DRIFT';

export interface DriftDifference {
  stage: string;
  field: string;
  stored: unknown;
  new: unknown;
  impact: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface DriftResult {
  detected: boolean;
  type: DriftType;
  message: string;
  differences?: DriftDifference[];
}

export interface ReplayResult {
  event_id: string;
  trace: ExecutionTrace;
  drift_detected: DriftResult;
  replay_duration_ms: number;
  timestamp: string;
}

interface NormalizedStage {
  type: string;
  confidence: string;
  count: number;
  success: boolean;
}

const DRIFT_THRESHOLD = 0.01;

export interface LedgerEvent {
  fingerprint: string;
  event_type: string;
  payload: Record<string, unknown>;
  created_at?: string;
}

export interface CascadeResult {
  classification: string;
  confidence: number;
}

export interface KiloResult {
  hypotheses: string[];
}

export interface ProtoForgeResult {
  decision: string;
}

export interface ReplayDeps {
  getEvent: (_fingerprint: string) => Promise<LedgerEvent | null>;
  classify: (_event: LedgerEvent) => Promise<CascadeResult | null>;
  generateHypotheses: (_event: LedgerEvent, _cascadeResult: CascadeResult) => Promise<KiloResult | null>;
  decide: (_event: LedgerEvent, _cascadeResult: CascadeResult, _kiloResult: KiloResult) => Promise<ProtoForgeResult | null>;
}

export class ReplayEngine {
  executionTraces = new Map<string, ExecutionTrace>();
  replayHistory: ReplayResult[] = [];
  driftEvents: DriftResult[] = [];
  stats = { totalReplays: 0, successfulReplays: 0, driftDetected: 0, averageReplayTime: 0, tracesStored: 0 };

  // eslint-disable-next-line no-unused-vars -- TS parameter property; assigned to this.deps and used throughout this class (base eslint no-unused-vars doesn't recognize parameter-property assignment as a use)
  constructor(private deps: ReplayDeps) {}

  /** Stabilizes a stage's output for deterministic comparison. */
  normalize(stage: StageTrace | null | undefined): NormalizedStage {
    if (!stage || typeof stage !== 'object') {
      return { type: 'NONE', confidence: '0.00', count: 0, success: false };
    }
    return {
      type: stage.classification || 'NONE',
      confidence: Number(stage.confidence || 0).toFixed(2),
      count: Number(stage.hypotheses_count || 0),
      success: Boolean(stage.success),
    };
  }

  compareWithStoredTrace(fingerprint: string, newTrace: ExecutionTrace | null): DriftResult {
    const storedTrace = this.executionTraces.get(fingerprint);

    if (!storedTrace) {
      return { detected: false, type: 'NO_BASELINE', message: 'No stored trace to compare' };
    }
    if (!newTrace || !newTrace.stages) {
      return { detected: true, type: 'NULL_OUTPUT', message: 'DETERMINISM_BREAK: NULL_OUTPUT - new trace is null/undefined' };
    }
    if (!storedTrace.stages) {
      return { detected: true, type: 'NULL_BASELINE', message: 'DETERMINISM_BREAK: NULL_BASELINE - stored trace has no stages' };
    }

    const differences: DriftDifference[] = [];

    const storedCascade = this.normalize(storedTrace.stages.cascade);
    const newCascade = this.normalize(newTrace.stages.cascade);
    if (storedCascade.type !== newCascade.type) {
      differences.push({ stage: 'cascade', field: 'classification', stored: storedCascade.type, new: newCascade.type, impact: 'HIGH' });
    }
    if (storedCascade.confidence !== newCascade.confidence) {
      differences.push({ stage: 'cascade', field: 'confidence', stored: storedCascade.confidence, new: newCascade.confidence, impact: 'MEDIUM' });
    }

    const storedKilo = this.normalize(storedTrace.stages.kilo);
    const newKilo = this.normalize(newTrace.stages.kilo);
    if (storedKilo.count !== newKilo.count) {
      differences.push({ stage: 'kilo', field: 'hypotheses_count', stored: storedKilo.count, new: newKilo.count, impact: 'LOW' });
    }

    if (differences.length === 0) {
      return { detected: false, type: 'NONE', message: 'No differences detected' };
    }

    const hasHighImpact = differences.some((d) => d.impact === 'HIGH');
    const hasManyDifferences = differences.length > 2;

    return {
      detected: hasHighImpact || hasManyDifferences,
      type: hasHighImpact ? 'SIGNIFICANT_DRIFT' : 'MINOR_DRIFT',
      differences,
      message: `${differences.length} differences detected`,
    };
  }

  async replayEvent(fingerprint: string, storeTrace = true): Promise<ReplayResult> {
    const startTime = Date.now();

    const ledgerRecord = await this.deps.getEvent(fingerprint);
    if (!ledgerRecord) {
      throw new Error(`Event not found in ledger: ${fingerprint}`);
    }

    const trace: ExecutionTrace = {
      fingerprint,
      replay_timestamp: new Date().toISOString(),
      original_timestamp: ledgerRecord.created_at,
      stages: {},
    };

    const cascadeResult = await this.deps.classify(ledgerRecord);
    trace.stages.cascade = {
      classification: cascadeResult?.classification,
      confidence: cascadeResult?.confidence,
      success: !!cascadeResult,
    };

    if (cascadeResult) {
      const kiloResult = await this.deps.generateHypotheses(ledgerRecord, cascadeResult);
      trace.stages.kilo = {
        hypotheses_count: kiloResult?.hypotheses?.length || 0,
        success: !!kiloResult,
      };

      if (trace.stages.kilo.success && kiloResult) {
        const decision = await this.deps.decide(ledgerRecord, cascadeResult, kiloResult);
        trace.stages.protoforge = {
          classification: decision?.decision,
          success: !!decision,
        };
      }
    }

    trace.duration_ms = Date.now() - startTime;

    // Compare against the stored baseline before overwriting it, otherwise
    // we'd diff the new trace against itself and never see drift.
    const drift = this.compareWithStoredTrace(fingerprint, trace);

    if (storeTrace) {
      this.executionTraces.set(fingerprint, trace);
      this.stats.tracesStored++;
    }

    const result: ReplayResult = {
      event_id: fingerprint,
      trace,
      drift_detected: drift,
      replay_duration_ms: trace.duration_ms,
      timestamp: new Date().toISOString(),
    };

    this.updateStats(result);
    this.replayHistory.push(result);
    if (this.replayHistory.length > 1000) this.replayHistory = this.replayHistory.slice(-1000);
    if (drift.detected) this.driftEvents.push(drift);

    return result;
  }

  private updateStats(result: ReplayResult): void {
    this.stats.totalReplays++;
    this.stats.successfulReplays++;
    const totalTime = this.stats.averageReplayTime * (this.stats.successfulReplays - 1) + result.replay_duration_ms;
    this.stats.averageReplayTime = totalTime / this.stats.successfulReplays;
    if (result.drift_detected.detected) this.stats.driftDetected++;
  }

  getStats() {
    return {
      ...this.stats,
      drift_rate: this.stats.totalReplays > 0 ? ((this.stats.driftDetected / this.stats.totalReplays) * 100).toFixed(2) + '%' : '0%',
      determinism_rate:
        this.stats.totalReplays > 0
          ? (((this.stats.totalReplays - this.stats.driftDetected) / this.stats.totalReplays) * 100).toFixed(2) + '%'
          : '100%',
    };
  }

  getDriftReport(limit = 50) {
    return {
      total_drift_events: this.driftEvents.length,
      drift_rate: this.stats.totalReplays > 0 ? ((this.stats.driftDetected / this.stats.totalReplays) * 100).toFixed(2) + '%' : '0%',
      recent_drift: this.driftEvents.slice(0, limit),
    };
  }

  getInfo() {
    return {
      type: 'REPLAY_ENGINE',
      description: 'Truth Validator - Ensures kilo/ + lib/protoforge/ pipeline determinism',
      rules: ['Same input must produce same output', 'Detects system drift', 'Stores execution traces'],
      config: { driftThreshold: DRIFT_THRESHOLD },
      stats: this.getStats(),
    };
  }

  clearHistory(): void {
    this.replayHistory = [];
    this.driftEvents = [];
  }
}

/**
 * Wire a ReplayEngine against the real raw-ledger table and the real
 * kilo/ + lib/protoforge/ pipeline. See the module-level honesty note
 * above re: the `classify` stage.
 */
export function createReplayEngine(supabase: import('@supabase/supabase-js').SupabaseClient): ReplayEngine {
  return new ReplayEngine({
    getEvent: async (fingerprint) => {
      const { getEventByFingerprint } = await import('./raw-ledger');
      return getEventByFingerprint(supabase, fingerprint);
    },
    classify: async (event) => ({ classification: event.event_type, confidence: 1.0 }),
    generateHypotheses: async (event, cascadeResult) => {
      const kiloModule = (await import('../../kilo/index.js')) as unknown as {
        createKiloEngine: () => { generateHypotheses: (_payload: Record<string, unknown>) => { hypotheses: string[] } };
      };
      const kilo = kiloModule.createKiloEngine();
      return kilo.generateHypotheses({
        fingerprint: event.fingerprint,
        classification: cascadeResult.classification,
        ...event.payload,
      });
    },
    decide: async (event, cascadeResult, _kiloResult) => {
      const autoGateModule = (await import('./auto-gate.js')) as unknown as {
        autoGate: (_hyps: Array<Record<string, unknown>>, _stream: string | null) => Promise<{ decisions: Array<Record<string, unknown>> }>;
      };
      const result = await autoGateModule.autoGate(
        [
          {
            id: event.fingerprint,
            confidence: cascadeResult.confidence,
            risk: 1 - cascadeResult.confidence,
            revenue_impact: 0,
            stream: null,
          },
        ],
        null,
      );
      const decision = result.decisions[0];
      return decision ? { decision: decision.decision as string } : null;
    },
  });
}
