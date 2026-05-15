/**
 * Replay Engine V2 — Determinism Validator
 *
 * Validates that the same RAW LEDGER input produces the same pipeline output.
 * Divergence == real drift. Identical output == deterministic.
 *
 * Architecture per HEIDI_V2_ARCHITECTURE.md:
 *   RAW LEDGER → CASCADE (classify) → KILO (hypotheses) → ProtoForge (policy)
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';

export interface PipelineOutput {
  classification: string;
  confidence: number;
  matchedRules: string[];
  hypotheses: string[];
  policyDecision: 'approved' | 'rejected';
}

export interface ReplayResult {
  eventId: string;
  driftDetected: boolean;
  driftFields: string[];
  originalOutput: PipelineOutput;
  replayOutput: PipelineOutput;
  replayedAt: string;
}

export interface DeterminismReport {
  totalEvents: number;
  deterministicCount: number;
  driftCount: number;
  deterministicRate: number;
  driftEvents: string[];
  generatedAt: string;
}

const CONFIDENCE_REQUIRED: Record<string, number> = {
  REVENUE_EVENT: 0.8,
  SUBSCRIPTION_EVENT: 0.8,
  CHECKOUT_EVENT: 0.75,
  PAYOUT_EVENT: 0.85,
  INFRA_FAILURE: 0.7,
  SYSTEM_EVENT: 0.5,
};

export class ReplayEngine {
  private supabase: SupabaseClient | null = null;
  private readonly driftThreshold: number;

  constructor(config: { driftThreshold?: number } = {}) {
    this.driftThreshold = config.driftThreshold ?? 0.01;
    const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (url && key) {
      this.supabase = createClient(url, key);
    }
  }

  // ── Public API ────────────────────────────────────────────────────────────

  async replayEvent(eventId: string): Promise<ReplayResult> {
    if (!this.supabase) throw new Error('Supabase not configured');

    const { data: event, error } = await this.supabase
      .from('keymaker_events')
      .select('*')
      .eq('event_id', eventId)
      .single();

    if (error || !event) throw new Error(`Event ${eventId} not found in RAW LEDGER`);

    const originalOutput = this.extractStoredOutput(event);
    const replayOutput = this.runPipeline(event.payload);
    const driftFields = this.detectDriftFields(originalOutput, replayOutput);

    const result: ReplayResult = {
      eventId,
      driftDetected: driftFields.length > 0,
      driftFields,
      originalOutput,
      replayOutput,
      replayedAt: new Date().toISOString(),
    };

    await this.persistResult(result);
    return result;
  }

  async validateDeterminism(sampleSize = 100): Promise<DeterminismReport> {
    if (!this.supabase) throw new Error('Supabase not configured');

    const { data: events } = await this.supabase
      .from('keymaker_events')
      .select('event_id')
      .eq('processed', true)
      .order('occurred_at', { ascending: false })
      .limit(sampleSize);

    if (!events || events.length === 0) {
      return {
        totalEvents: 0,
        deterministicCount: 0,
        driftCount: 0,
        deterministicRate: 1.0,
        driftEvents: [],
        generatedAt: new Date().toISOString(),
      };
    }

    const driftEvents: string[] = [];
    let deterministicCount = 0;

    for (const { event_id } of events) {
      try {
        const result = await this.replayEvent(event_id as string);
        if (result.driftDetected) {
          driftEvents.push(event_id as string);
        } else {
          deterministicCount++;
        }
      } catch {
        driftEvents.push(event_id as string);
      }
    }

    return {
      totalEvents: events.length,
      deterministicCount,
      driftCount: driftEvents.length,
      deterministicRate: deterministicCount / events.length,
      driftEvents,
      generatedAt: new Date().toISOString(),
    };
  }

  // ── Pipeline layers (read-only, no side effects) ─────────────────────────

  private runPipeline(payload: unknown): PipelineOutput {
    // Layer 3: CASCADE — classification only
    const { classification, confidence, matchedRules } = this.cascade(payload);
    // Layer 4: KILO — hypotheses only
    const hypotheses = this.kilo(classification, payload);
    // Layer 5: ProtoForge — policy decision
    const policyDecision = this.protoforge(classification, confidence);
    return { classification, confidence, matchedRules, hypotheses, policyDecision };
  }

  private cascade(
    payload: unknown
  ): { classification: string; confidence: number; matchedRules: string[] } {
    if (!payload || typeof payload !== 'object') {
      return { classification: 'UNCLASSIFIED', confidence: 0, matchedRules: [] };
    }
    const p = payload as Record<string, unknown>;
    const type = (p.type as string) || '';
    const rules: string[] = [];
    let classification = 'SYSTEM_EVENT';
    let confidence = 0.85;

    if (/^(payment_intent|charge|invoice)/.test(type)) {
      classification = 'REVENUE_EVENT';
      rules.push('stripe_payment_pattern');
      confidence = 0.95;
    } else if (/^customer\.subscription/.test(type)) {
      classification = 'SUBSCRIPTION_EVENT';
      rules.push('stripe_subscription_pattern');
      confidence = 0.95;
    } else if (/^checkout\.session/.test(type)) {
      classification = 'CHECKOUT_EVENT';
      rules.push('stripe_checkout_pattern');
      confidence = 0.9;
    } else if (/^payout/.test(type)) {
      classification = 'PAYOUT_EVENT';
      rules.push('stripe_payout_pattern');
      confidence = 0.93;
    } else if (/error|fail/.test(type)) {
      classification = 'INFRA_FAILURE';
      rules.push('error_pattern');
      confidence = 0.88;
    }
    return { classification, confidence, matchedRules: rules };
  }

  private kilo(classification: string, _payload: unknown): string[] {
    const map: Record<string, string[]> = {
      REVENUE_EVENT: ['Payment processed', 'Fee calculation applied'],
      SUBSCRIPTION_EVENT: ['Tier access updated', 'Service provisioning triggered'],
      CHECKOUT_EVENT: ['Checkout completed', 'Lead record created'],
      PAYOUT_EVENT: ['Funds transferred', 'Ledger entries updated'],
      INFRA_FAILURE: ['Service not running', 'Resource exhaustion possible'],
      SYSTEM_EVENT: ['Internal system event'],
    };
    return map[classification] || ['Unknown event pattern'];
  }

  private protoforge(
    classification: string,
    confidence: number
  ): 'approved' | 'rejected' {
    const required = CONFIDENCE_REQUIRED[classification] ?? 0.75;
    return confidence >= required ? 'approved' : 'rejected';
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  private extractStoredOutput(event: Record<string, unknown>): PipelineOutput {
    const meta = (event.payload as Record<string, unknown>)?.metadata as
      | Record<string, unknown>
      | undefined;
    return {
      classification: (meta?.classification as string) || (event.type as string) || 'UNCLASSIFIED',
      confidence: (meta?.confidence as number) ?? 1.0,
      matchedRules: (meta?.matchedRules as string[]) || [],
      hypotheses: (meta?.hypotheses as string[]) || [],
      policyDecision: (meta?.policyDecision as 'approved' | 'rejected') ?? 'approved',
    };
  }

  private detectDriftFields(
    original: PipelineOutput,
    replay: PipelineOutput
  ): string[] {
    const drifts: string[] = [];
    if (original.classification !== replay.classification) {
      drifts.push(`classification: ${original.classification} → ${replay.classification}`);
    }
    if (Math.abs(original.confidence - replay.confidence) > this.driftThreshold) {
      drifts.push(`confidence: ${original.confidence} → ${replay.confidence}`);
    }
    if (original.policyDecision !== replay.policyDecision) {
      drifts.push(`policyDecision: ${original.policyDecision} → ${replay.policyDecision}`);
    }
    return drifts;
  }

  private async persistResult(result: ReplayResult): Promise<void> {
    if (!this.supabase) return;
    try {
      await this.supabase.from('replay_history').insert({
        event_id: result.eventId,
        drift_detected: result.driftDetected,
        drift_fields: result.driftFields,
        original_output: result.originalOutput,
        replay_output: result.replayOutput,
        replayed_at: result.replayedAt,
      });
    } catch {
      // Non-fatal — replay_history table may not exist yet
    }
  }
}

export default ReplayEngine;
