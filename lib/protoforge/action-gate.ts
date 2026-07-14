/**
 * ACTION GATE — wires the live orchestrator through KILO -> ProtoForge
 *
 * Every proposed action is turned into a KILO hypothesis and run through
 * lib/protoforge/auto-gate.js's autoGate(), which records a real decision
 * to the `decisions` table via lib/protoforge/policy-engine.js.
 *
 * Two things stop this from being a full CASCADE -> KILO -> ProtoForge
 * pipeline yet, both worth being honest about rather than papering over:
 *
 * 1. There is no real CASCADE classifier feeding a ground-truth state
 *    snapshot into KILO's truth-filter gate here, so
 *    kilo/modules/truth-filter-gate.js's verifyCascadeEvent() will always
 *    report `verified: false, confidence: 0` for these fingerprints — it
 *    checks the fingerprint against a CASCADE state snapshot that's empty.
 *    Building that snapshot is future work.
 * 2. ProtoForge's policy engine is fail-closed (default decision =
 *    'reject'), and the only seeded policy in `policies`
 *    (supabase/migrations/20260528000002_policies_table.sql) is
 *    deliberately inactive ("promote explicitly; never auto-activate seed
 *    data"). Enforcing gate decisions today would silently reject every
 *    action Heidi currently executes.
 *
 * So this runs in **observe-only mode by default**: every action still
 * gets a genuine KILO hypothesis and a genuine ProtoForge decision
 * recorded to `decisions`, but nothing is blocked. Set
 * PROTOFORGE_ENFORCE_ACTIONS=true once a real policy has been promoted and
 * you've reviewed what it would actually approve/reject/escalate.
 */

import * as crypto from 'crypto';

export interface GatedAction {
  type: string;
  payload: Record<string, unknown>;
}

export interface ActionGateVerdict {
  action: GatedAction;
  decision: 'approve' | 'reject' | 'escalate' | 'skipped';
  confidence: number;
  hypotheses: string[];
  reasoning?: string;
}

export function isEnforcing(): boolean {
  return process.env.PROTOFORGE_ENFORCE_ACTIONS === 'true';
}

/**
 * Run every action through KILO (hypothesis generation) then ProtoForge
 * (policy decision, recorded to `decisions`). Never throws — a gating
 * failure (missing Supabase env, policy engine error, etc.) degrades to
 * 'skipped' verdicts so it can never take down chat processing.
 */
export async function gateActions(actions: GatedAction[], sessionId: string): Promise<ActionGateVerdict[]> {
  if (actions.length === 0) return [];

  try {
    // kilo/index.js and auto-gate.js are CommonJS; dynamic import mirrors
    // the existing pattern in lib/protoforge/dispatcher.ts.
    const kiloModule = (await import('../../kilo/index.js')) as unknown as {
      createKiloEngine: (opts?: Record<string, unknown>) => {
        generateHypotheses: (payload: Record<string, unknown>) => {
          hypotheses: string[];
          confidence: number;
          gate_result: { verified: boolean };
        };
      };
    };
    const autoGateModule = (await import('./auto-gate.js')) as unknown as {
      autoGate: (
        hypotheses: Array<Record<string, unknown>>,
        stream: string | null,
      ) => Promise<{ decisions: Array<Record<string, unknown>> }>;
    };

    const kilo = kiloModule.createKiloEngine();
    const kiloResults = new Map<string, { hypotheses: string[]; confidence: number; gate_result: { verified: boolean } }>();

    const hypotheses = actions.map((action, i) => {
      const fingerprint = crypto
        .createHash('sha256')
        .update(`${sessionId}:${i}:${action.type}:${JSON.stringify(action.payload)}`)
        .digest('hex');

      const kiloResult = kilo.generateHypotheses({
        fingerprint,
        classification: action.type,
        session_id: sessionId,
        ...action.payload,
      });
      kiloResults.set(fingerprint, kiloResult);

      return {
        id: fingerprint,
        confidence: kiloResult.confidence,
        risk: kiloResult.gate_result.verified ? Math.max(0, 1 - kiloResult.confidence) : 1,
        revenue_impact: 0,
        stream: null,
      };
    });

    const gateResult = await autoGateModule.autoGate(hypotheses, null);
    const decisionByHypId = new Map<string, Record<string, unknown>>();
    for (const d of gateResult.decisions) decisionByHypId.set(d.hypothesisId as string, d);

    return actions.map((action, i) => {
      const hyp = hypotheses[i];
      const decision = decisionByHypId.get(hyp.id);
      const kiloResult = kiloResults.get(hyp.id);
      return {
        action,
        decision: (decision?.decision as ActionGateVerdict['decision']) ?? 'skipped',
        confidence: hyp.confidence,
        hypotheses: kiloResult?.hypotheses ?? [],
        reasoning: decision?.reasoning as string | undefined,
      };
    });
  } catch (error) {
    console.error('[ActionGate] KILO/ProtoForge gating unavailable, skipping:', error instanceof Error ? error.message : 'Unknown error');
    return actions.map((action) => ({ action, decision: 'skipped' as const, confidence: 0, hypotheses: [] }));
  }
}
