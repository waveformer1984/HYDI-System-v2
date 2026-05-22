/**
 * SELF-HEALING SERVICE
 * When a loop or task fails, queries the Traces API for context,
 * builds a structured correction prompt, and calls Claude to
 * generate an actionable corrective strategy.
 */

async function callClaude(systemPrompt, userContent) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    console.warn('[SELF-HEAL] ANTHROPIC_API_KEY not set — returning no-op correction');
    return null;
  }

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-opus-4-7',
      max_tokens: 1024,
      system: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
    }),
  });

  if (!res.ok) {
    console.error(`[SELF-HEAL] Claude API error: ${res.status}`);
    return null;
  }

  const data = await res.json();
  const textBlock = data.content?.find(b => b.type === 'text');
  return textBlock?.text ?? null;
}

async function fetchRecentTraces(limit = 5) {
  const tracesBase = process.env.HYDI_TRACES_URL || 'http://localhost:3000/api/traces';
  try {
    const res = await fetch(`${tracesBase}?sample=${limit}`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return [];
    const data = await res.json();
    return data.traces ?? data ?? [];
  } catch {
    return [];
  }
}

class SelfHealingService {
  /**
   * Called when a loop completes but measurement.success === false.
   * Returns a corrective instruction object or null if nothing actionable.
   *
   * @param {object} loopResult - full result from executeHeidiLoop()
   * @returns {Promise<{correctedTask: object, reasoning: string}|null>}
   */
  async diagnoseAndCorrect(loopResult) {
    const { task, action, measurement, decision, reflection, loopId } = loopResult;

    const recentTraces = await fetchRecentTraces(5);
    const driftingTraces = recentTraces.filter(t => {
      const score = t.determinism_score ?? t.score ?? 1;
      return score < 0.95;
    });

    const userContent = JSON.stringify({
      failed_task: {
        type: task,
        loopId,
        decision_strategy: decision?.strategy,
        decision_model: decision?.model,
        action_status: action?.status,
        action_error: action?.error,
      },
      measurement: {
        success: measurement?.success,
        error: measurement?.error,
        quality: measurement?.quality,
        latency_ms: measurement?.latency,
      },
      reflection_lessons: reflection?.lessonsLearned ?? [],
      recent_drift_events: driftingTraces.slice(0, 3).map(t => ({
        event_id: t.event_id ?? t.id,
        determinism_score: t.determinism_score ?? t.score,
        drift_fields: t.drift_fields,
      })),
    }, null, 2);

    const rawText = await callClaude(
      `You are the self-healing engine for the HYDI/Heidi autonomous system.
A task loop just failed. Your job is to:
1. Identify the root cause from the failure context and recent trace drift data.
2. Produce a corrected task specification that avoids the failure mode.
3. Suggest a strategy change (model, approach, or parameters).

Respond ONLY with valid JSON in this exact shape:
{
  "root_cause": "one sentence",
  "corrected_task": {
    "type": "...",
    "strategy": "local | external | hybrid",
    "model": "...",
    "instruction": "...",
    "priority": "normal | high | critical"
  },
  "reasoning": "one paragraph"
}`,
      userContent
    );

    if (!rawText) return null;

    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      if (!jsonMatch) return null;
      const parsed = JSON.parse(jsonMatch[0]);
      console.log(`[SELF-HEAL] Correction for ${loopId}: ${parsed.root_cause}`);
      return parsed;
    } catch (e) {
      console.error('[SELF-HEAL] Failed to parse Claude response:', e.message);
      return null;
    }
  }

  /**
   * Called from the catch block of executeLoop() for hard failures.
   * Returns a retry-ready task object or null.
   */
  async healFromCrash(task, errorMessage, loopId) {
    const recentTraces = await fetchRecentTraces(3);

    const userContent = JSON.stringify({
      crashed_task: { type: task.type, loopId },
      error: errorMessage,
      recent_traces: recentTraces.slice(0, 3),
    }, null, 2);

    const rawText = await callClaude(
      `You are the HYDI crash recovery engine. A task loop crashed with an unhandled exception.
Respond ONLY with valid JSON:
{
  "should_retry": true | false,
  "corrected_task": { "type": "...", "strategy": "...", "instruction": "...", "priority": "..." },
  "reasoning": "one sentence"
}`,
      userContent
    );

    if (!rawText) return null;
    try {
      const jsonMatch = rawText.match(/\{[\s\S]*\}/);
      return jsonMatch ? JSON.parse(jsonMatch[0]) : null;
    } catch {
      return null;
    }
  }

  destroy() {
    this._destroyed = true;
  }
}

module.exports = new SelfHealingService();
