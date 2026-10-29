'use strict';

/**
 * Pipeline → Heidi task link.
 *
 * When ProtoForge escalates an event (pipeline outcome `escalate`), a
 * person has to look at it. This turns that emission into a Heidi task
 * (heidi-core `POST /missions`) carrying the same trace_id, so one id
 * follows the event from the RAW LEDGER fingerprint through CASCADE, KILO,
 * the ProtoForge decision, and into the task and its history.
 *
 * - Subscribes to the emission layer only; it never changes a pipeline
 *   result, and a failure here is logged and counted, never thrown.
 * - The task is informational (no action): KILO's hypotheses are not
 *   executable actions, so nothing can run from it. A person reviews it
 *   and closes it with `task done <id>` or `task cancel <id>`.
 * - Idempotent: heidi-core returns the existing task for a trace_id it
 *   has already seen, so a retried POST never makes a second task.
 * - Off with HEIDI_TRACE_LINK=false. Which outcomes link:
 *   HEIDI_TRACE_LINK_OUTCOMES (comma list, default "escalate").
 */

const DEFAULT_URL = 'http://127.0.0.1:3459';

function goalFor(ev) {
  const what = ev.classification || ev.event_type || 'event';
  const from = ev.source ? ` from ${ev.source}` : '';
  return `Review ProtoForge ${ev.outcome}: ${what}${from} (trace ${String(ev.trace_id).slice(0, 8)})`;
}

/**
 * @param {object} [opts]
 * @param {object}   [opts.env]        default process.env
 * @param {Function} [opts.fetchImpl]  default global fetch
 * @param {Function} [opts.log]        default console.warn
 * @param {number}   [opts.timeoutMs]  default 4000
 * @returns {{ handle(traceEvent): Promise<object>, status(): object, enabled: boolean }}
 */
function createHeidiTaskLinker(opts = {}) {
  const env = opts.env || process.env;
  const fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
  const log = opts.log || ((m) => console.warn(m));
  const timeoutMs = opts.timeoutMs || 4000;
  const enabled = env.HEIDI_TRACE_LINK !== 'false';
  const outcomes = new Set(String(env.HEIDI_TRACE_LINK_OUTCOMES || 'escalate').split(',').map((s) => s.trim()).filter(Boolean));
  const base = String(env.HEIDI_CORE_URL || DEFAULT_URL).replace(/\/+$/, '');
  const stats = { linked: 0, existing: 0, failed: 0, skipped: 0, last: null };

  async function handle(ev) {
    if (!enabled || !ev || !ev.trace_id || !outcomes.has(ev.outcome)) {
      stats.skipped += 1;
      return { linked: false, reason: enabled ? 'outcome not linked' : 'disabled' };
    }
    const body = {
      goal: goalFor(ev),
      priority: ev.outcome === 'escalate' ? 2 : 1,
      trace_id: ev.trace_id,
      source: 'protoforge-pipeline',
      trace: {
        trace_id: ev.trace_id,
        fingerprint: ev.fingerprint || null,
        outcome: ev.outcome,
        event_type: ev.event_type || null,
        source: ev.source || null,
        classification: ev.classification || null,
        confidence: typeof ev.confidence === 'number' ? ev.confidence : null,
        decision: ev.decision || null,
        decision_id: ev.decision_id || null,
        matched_rule_id: ev.matched_rule_id || null,
        stream: ev.stream || null,
      },
    };
    const headers = { 'Content-Type': 'application/json' };
    if (env.HEIDI_SECRET) headers['x-heidi-secret'] = env.HEIDI_SECRET;
    try {
      const res = await fetchImpl(`${base}/missions`, {
        method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
      if (json.existing) stats.existing += 1; else stats.linked += 1;
      stats.last = { at: new Date().toISOString(), trace_id: ev.trace_id, task_id: json.mission && json.mission.id, ok: true };
      return { linked: true, existing: Boolean(json.existing), task_id: json.mission && json.mission.id };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      stats.failed += 1;
      stats.last = { at: new Date().toISOString(), trace_id: ev.trace_id, ok: false, error: message };
      log(`[HEIDI LINK] could not open a Heidi task for trace ${ev.trace_id}: ${message}`);
      return { linked: false, reason: message };
    }
  }

  return { handle, status: () => ({ enabled, outcomes: [...outcomes], target: base, ...stats }), enabled };
}

module.exports = { createHeidiTaskLinker, goalFor };
