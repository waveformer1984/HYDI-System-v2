/**
 * CLAUDE HEALING SERVICE (Ursula)
 * Queries the HYDI Traces API on task failure, feeds context to Claude,
 * and returns a corrected execution strategy.
 */


export interface TraceEvent {
  event_id?: string;
  id?: string;
  determinism_score?: number;
  score?: number;
  drift_fields?: string[];
}

export interface HealingContext {
  taskId: string;
  taskType?: string;
  error: string;
  resultStatus?: string;
  traceId?: string;
}

export interface CorrectedTask {
  type: string;
  strategy: 'local' | 'external' | 'hybrid';
  instruction: string;
  priority: 'normal' | 'high' | 'critical';
  should_retry?: boolean;
}

export interface HealingResult {
  root_cause: string;
  corrected_task: CorrectedTask;
  reasoning: string;
}

async function fetchRecentTraces(limit = 5): Promise<TraceEvent[]> {
  const tracesUrl = process.env.HYDI_TRACES_URL || 'http://localhost:3000/api/traces';
  try {
    const res = await fetch(`${tracesUrl}?sample=${limit}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return (data.traces ?? data ?? []) as TraceEvent[];
  } catch {
    return [];
  }
}

async function callClaude(systemPrompt: string, userContent: string): Promise<string | null> {
  // Route through Ursula inference stack: Ollama → OpenVINO → Claude
  // highStakes=true uses Claude Opus when available (best for structured healing JSON)
  const { infer } = await import('@/lib/inference-router');
  const result = await infer(userContent, { system: systemPrompt, highStakes: true });

  if (!result.success) {
    console.warn(`[HEALING] All inference providers failed: ${result.error}`);
    return null;
  }

  console.log(`[HEALING] Inference via ${result.provider} in ${result.duration_ms}ms`);
  return result.response;
}

export class ClaudeHealingService {
  async diagnoseAndCorrect(ctx: HealingContext): Promise<HealingResult | null> {
    const traces = await fetchRecentTraces(5);
    const driftingTraces = traces.filter(t => (t.determinism_score ?? t.score ?? 1) < 0.95);

    const userContent = JSON.stringify({
      failed_task: {
        task_id: ctx.taskId,
        type: ctx.taskType,
        error: ctx.error,
        result_status: ctx.resultStatus,
        trace_id: ctx.traceId,
      },
      recent_drift_events: driftingTraces.slice(0, 3).map(t => ({
        event_id: t.event_id ?? t.id,
        determinism_score: t.determinism_score ?? t.score,
        drift_fields: t.drift_fields,
      })),
    }, null, 2);

    const rawText = await callClaude(
      `You are the self-healing engine for Ursula, the execution engine of the HYDI/ProtoForge platform.
A task execution failed. Analyze the failure and produce a corrected task specification.
Respond ONLY with valid JSON matching exactly:
{
  "root_cause": "one sentence describing the failure root cause",
  "corrected_task": {
    "type": "...",
    "strategy": "local | external | hybrid",
    "instruction": "concrete corrective instruction for re-execution",
    "priority": "normal | high | critical",
    "should_retry": true | false
  },
  "reasoning": "one paragraph explaining the correction"
}`,
      userContent
    );

    if (!rawText) return null;

    try {
      const match = rawText.match(/\{[\s\S]*\}/);
      if (!match) return null;
      const parsed = JSON.parse(match[0]) as HealingResult;
      console.log(`[HEALING] Correction for ${ctx.taskId}: ${parsed.root_cause}`);
      return parsed;
    } catch (e) {
      console.error('[HEALING] Parse error:', e instanceof Error ? e.message : String(e));
      return null;
    }
  }
}

let _instance: ClaudeHealingService | null = null;

export function getHealingService(): ClaudeHealingService {
  if (!_instance) _instance = new ClaudeHealingService();
  return _instance;
}
