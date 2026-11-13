'use strict';

/**
 * Action advisor + triple gate (Phase 2 spine).
 *
 * The contract-layer evaluation for a PROPOSED action:
 *
 *   1. Record the proposal in heidi_events (event_type 'action_proposal',
 *      payload.event 'proposed') — the proposal exists as evidence before
 *      any verdict is computed.
 *   2. Evaluate three gates, logged separately per action:
 *        env     — HEIDI_ALLOW_EXEC (the operator master switch)
 *        advisor — local qwen2.5:3b verdict + confidence (never a paid API,
 *                  never the 1b model)
 *        bounds  — heidi_decision_bounds row + action-registry bounds check
 *                  + sensitive-division / high-risk / denied lists
 *   3. Outcome:
 *        - every non-env gate passes and HEIDI_ALLOW_EXEC=true
 *            -> 'authorized'   (caller may execute; THIS MODULE NEVER DOES)
 *        - every non-env gate passes and exec disabled
 *            -> 'would have executed'
 *        - anything else       -> 'blocked'
 *
 * Fail-closed contract: advisor timeout, malformed model output, missing
 * bounds row, or a database error can only produce REVIEW/BLOCK downstream
 * — never AUTO-APPROVE, never an exception escaping toward an executor.
 */

const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const {
  isRegisteredAction,
  getAction,
  checkActionBounds,
  registeredActionTypes,
} = require('./action-registry');

const CONFIDENCE_FLOOR = 0.85;
const DEFAULT_SENSITIVE_DIVISIONS = Object.freeze(['financial', 'crypto', 'vendor']);
const MAX_GATE_LOG = 50;

function isTruthy(v) {
  return v === true || v === 'true' || v === '1' || v === 1;
}

function advisorModel() {
  return process.env.HEIDI_ADVISOR_MODEL || 'qwen2.5:3b';
}

function advisorTimeoutMs() {
  const n = parseInt(process.env.HEIDI_ADVISOR_TIMEOUT_MS || '25000', 10);
  return Number.isFinite(n) && n > 0 ? n : 25000;
}

function gateLogPath() {
  return process.env.HEIDI_GATE_LOG_PATH || path.join(process.cwd(), '.runtime', 'heidi-gate-log.json');
}

// ─── Advisor model call ──────────────────────────────────────────────────

function buildAdvisorPrompt(proposal, bounds) {
  const safeBounds = bounds
    ? {
        auto_approve_threshold: bounds.auto_approve_threshold ?? null,
        max_auto_approve_amount: bounds.max_auto_approve_amount ?? null,
        unattended_enabled: bounds.unattended_enabled ?? null,
      }
    : null;
  return [
    'You are the Heidi action advisor — a cautious governance reviewer on a local workstation.',
    'Decide whether the proposed action may proceed WITHOUT a human, given the decision bounds.',
    'Reply with ONLY a JSON object, no prose: {"verdict":"AUTO-APPROVE"|"REVIEW"|"BLOCK","confidence":<0..1>,"reason":"<short>"}',
    'The reason value MUST be a quoted string. No markdown, no commentary.',
    'Rules: AUTO-APPROVE only for low-risk, reversible, in-bounds actions you fully understand.',
    'Anything uncertain, irreversible, external, financial, or outside bounds is REVIEW or BLOCK.',
    '',
    `PROPOSAL: ${JSON.stringify(proposal)}`,
    `DECISION_BOUNDS: ${JSON.stringify(safeBounds)}`,
  ].join('\n');
}

/**
 * Default advisor: local Ollama only. Injectable for tests/drills.
 * Returns raw model text; throws on transport failure or timeout.
 */
async function callOllamaAdvisor({ prompt, model, timeoutMs, fetchImpl }) {
  const fetcher = fetchImpl || globalThis.fetch;
  if (typeof fetcher !== 'function') throw new Error('no fetch implementation available');
  const ollamaUrl = process.env.OLLAMA_URL || process.env.LOCAL_MODEL_URL || 'http://localhost:11434';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(`${ollamaUrl}/api/generate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        prompt,
        stream: false,
        options: { num_predict: 160, temperature: 0.2 },
      }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`ollama HTTP ${res.status}`);
    const data = await res.json();
    return String(data.response || '');
  } finally {
    clearTimeout(timer);
  }
}

const VERDICTS = Object.freeze({ AUTO_APPROVE: 'AUTO-APPROVE', REVIEW: 'REVIEW', BLOCK: 'BLOCK' });

/**
 * Parse advisor output. Strict: the response must contain a JSON object with
 * a legal verdict and a numeric confidence in [0,1]. Anything else -> null
 * (caller treats null as advisor failure -> REVIEW, never approve).
 */
function parseAdvisorVerdict(text) {
  if (typeof text !== 'string' || !text.trim()) return null;
  const match = text.match(/\{[\s\S]*\}/);
  if (!match) return null;

  let verdict = null;
  let confidence = null;
  let reason = '';

  try {
    const obj = JSON.parse(match[0]);
    verdict = String(obj.verdict || '').toUpperCase();
    confidence = typeof obj.confidence === 'number' ? obj.confidence : parseFloat(obj.confidence);
    reason = typeof obj.reason === 'string' ? obj.reason : '';
  } catch {
    // Small models sometimes emit "reason":<unquoted text> — invalid JSON but
    // the verdict/confidence fields are still recoverable. Extract them
    // independently; anything missing or invalid still fails closed below.
    const vMatch = match[0].match(/"verdict"\s*:\s*"([A-Za-z-]+)"/);
    const cMatch = match[0].match(/"confidence"\s*:\s*(-?\d+(?:\.\d+)?)/);
    const rMatch = match[0].match(/"reason"\s*:\s*"([\s\S]*?)"\s*[,}]/);
    if (vMatch) verdict = vMatch[1].toUpperCase();
    if (cMatch) confidence = parseFloat(cMatch[1]);
    if (rMatch) reason = rMatch[1];
  }

  if (!verdict || !Object.values(VERDICTS).includes(verdict)) return null;
  if (!Number.isFinite(confidence) || confidence < 0 || confidence > 1) return null;
  return { verdict, confidence, reason: reason.slice(0, 300) };
}

// ─── Bounds gate ─────────────────────────────────────────────────────────

/**
 * The decision-bounds gate: bounds row usable + action registered +
 * registry bounds check + sensitive/high-risk/division checks.
 * Every sub-check is recorded so the log shows WHICH bound refused.
 */
function evaluateBoundsGate({ proposal, bounds, sensitiveDivisions }) {
  const type = proposal && proposal.type;
  const payload = (proposal && proposal.payload) || {};
  const sensitive = sensitiveDivisions || DEFAULT_SENSITIVE_DIVISIONS;
  const checks = [];

  const boundsUsable =
    bounds && typeof bounds === 'object' && typeof bounds.auto_approve_threshold === 'number';
  checks.push({
    check: 'bounds_row',
    pass: boundsUsable,
    detail: boundsUsable ? 'heidi_decision_bounds row loaded' : 'heidi_decision_bounds row missing or unusable',
  });
  if (!boundsUsable) {
    return { pass: false, checks, within: false, reason: 'bounds row missing or unusable' };
  }

  const registered = isRegisteredAction(type) && registeredActionTypes().has(type);
  checks.push({
    check: 'action_registered',
    pass: registered,
    detail: registered ? `'${type}' is a registered action type` : `'${type || '(none)'}' is not a registered action type`,
  });
  if (!registered) {
    return { pass: false, checks, within: false, reason: 'unregistered action type' };
  }

  const registryBounds = checkActionBounds(type, payload, bounds);
  checks.push({ check: 'registry_bounds', pass: registryBounds.within, detail: registryBounds.reason });

  const action = getAction(type);
  const highRisk = !!(action && action.risk === 'high');
  checks.push({
    check: 'high_risk',
    pass: !highRisk,
    detail: highRisk ? `'${type}' is high-risk — human approval required` : `'${type}' is not high-risk`,
  });

  const division = proposal && proposal.division;
  const sensitiveHit = sensitive.includes(division);
  checks.push({
    check: 'sensitive_division',
    pass: !sensitiveHit,
    detail: sensitiveHit ? `division '${division}' is sensitive — human approval required` : 'division not sensitive',
  });

  // Denied lists: only apply when the proposal names a resolver/capability.
  const resolverId = proposal && proposal.resolverId;
  const capability = (payload && payload.capabilityId) || (proposal && proposal.capabilityId);
  const deniedResolvers = Array.isArray(bounds.denied_resolvers) ? bounds.denied_resolvers : bounds.deniedResolvers || [];
  const deniedCaps = Array.isArray(bounds.denied_capabilities) ? bounds.denied_capabilities : bounds.deniedCapabilities || [];
  const resolverDenied = resolverId && deniedResolvers.includes(resolverId);
  checks.push({
    check: 'resolver_denied',
    pass: !resolverDenied,
    detail: resolverDenied ? `resolver '${resolverId}' is denied in bounds` : 'resolver not denied',
  });
  const capDenied = capability && deniedCaps.includes(capability);
  checks.push({
    check: 'capability_denied',
    pass: !capDenied,
    detail: capDenied ? `capability '${capability}' is denied in bounds` : 'capability not denied',
  });

  const pass =
    registryBounds.within && !highRisk && !sensitiveHit && !resolverDenied && !capDenied;
  return {
    pass,
    within: registryBounds.within,
    checks,
    reason: pass ? 'within decision bounds' : checks.filter((c) => !c.pass).map((c) => c.detail).join('; '),
  };
}

// ─── Evidence + gate log ─────────────────────────────────────────────────

function defaultRecordEvent(supabase) {
  return async (row) => {
    if (!supabase || typeof supabase.from !== 'function') {
      throw new Error('no supabase client for heidi_events write');
    }
    const { error } = await supabase.from('heidi_events').insert(row);
    if (error) throw new Error(`heidi_events insert failed: ${error.message}`);
  };
}

function appendGateLog(entry, logPath) {
  const p = logPath || gateLogPath();
  let entries = [];
  try {
    const raw = fs.readFileSync(p, 'utf8');
    const parsed = JSON.parse(raw);
    entries = Array.isArray(parsed) ? parsed : parsed.entries || [];
  } catch {
    entries = [];
  }
  entries.push(entry);
  if (entries.length > MAX_GATE_LOG) entries = entries.slice(entries.length - MAX_GATE_LOG);
  try {
    fs.mkdirSync(path.dirname(p), { recursive: true });
    const tmp = `${p}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify({ updatedAt: new Date().toISOString(), entries }, null, 2));
    fs.renameSync(tmp, p);
  } catch {
    // Gate log is evidence, not a gate — a write failure must not change a verdict.
  }
}

/**
 * Evaluate one proposed action through the triple gate.
 *
 * @param {object} opts
 * @param {object} opts.proposal   { type, division?, payload?, confidence? (ignored — advisor decides), ... }
 * @param {object|null} opts.bounds  heidi_decision_bounds row (snake_case columns OK)
 * @param {boolean|string} [opts.execEnabled]  HEIDI_ALLOW_EXEC value
 * @param {boolean} [opts.paused]
 * @param {object} [opts.supabase]  client with .from('heidi_events').insert
 * @param {(row:object)=>Promise<void>} [opts.recordEvent]  override evidence writer
 * @param {(input:{prompt:string,model:string,timeoutMs:number})=>Promise<string>} [opts.callModel]
 * @param {string} [opts.gateLogPath]
 * @param {string[]} [opts.sensitiveDivisions]
 * @returns {Promise<{proposalId:string, verdict:string, confidence:number|null,
 *   outcome:'authorized'|'would have executed'|'blocked', execEnabled:boolean,
 *   gates:object, advisorError?:string}>}
 */
async function adviseProposal(opts = {}) {
  const proposal = opts.proposal || {};
  const proposalId = proposal.id || randomUUID();
  const type = proposal.type || '(none)';
  const execEnabled = isTruthy(opts.execEnabled !== undefined ? opts.execEnabled : process.env.HEIDI_ALLOW_EXEC);
  const recordEvent = opts.recordEvent || defaultRecordEvent(opts.supabase);
  const callModel = opts.callModel || ((input) => callOllamaAdvisor(input));
  const model = advisorModel();
  const startedAt = Date.now();

  const gates = {
    env: {
      pass: execEnabled,
      detail: execEnabled ? 'HEIDI_ALLOW_EXEC=true' : 'HEIDI_ALLOW_EXEC is not true — execution stays closed',
    },
    advisor: { verdict: null, confidence: null, reason: null, model, status: 'pending' },
    bounds: { pass: false, checks: [], reason: 'not evaluated' },
  };

  // Evidence first: the proposal is recorded before any verdict exists.
  let evidenceOk = true;
  try {
    await recordEvent({
      event_type: 'action_proposal',
      division: proposal.division || 'ops',
      payload: {
        event: 'proposed',
        proposalId,
        type,
        payload: proposal.payload || {},
        proposer: proposal.proposer || 'unknown',
        gateVersion: 'action-advisor/1',
      },
      created_at: new Date().toISOString(),
    });
  } catch (e) {
    // A proposal we cannot record is a proposal we cannot govern — fail closed.
    evidenceOk = false;
    gates.advisor.status = 'skipped';
    gates.advisor.reason = `proposal evidence write failed: ${e.message}`;
  }

  const boundsResult = evidenceOk ? evaluateBoundsGate({
    proposal,
    bounds: opts.bounds || null,
    sensitiveDivisions: opts.sensitiveDivisions,
  }) : { pass: false, checks: [], within: false, reason: 'skipped — evidence write failed' };
  gates.bounds = { pass: boundsResult.pass, within: boundsResult.within, checks: boundsResult.checks, reason: boundsResult.reason };

  // Advisor runs only when the bounds row exists — the model evaluates the
  // proposal AGAINST bounds; with no bounds there is nothing to evaluate.
  let advisor = null;
  let advisorError = null;
  if (evidenceOk && boundsResult.checks.some((c) => c.check === 'bounds_row' && c.pass)) {
    const t0 = Date.now();
    try {
      const text = await callModel({
        prompt: buildAdvisorPrompt(proposal, opts.bounds || null),
        model,
        timeoutMs: advisorTimeoutMs(),
      });
      advisor = parseAdvisorVerdict(text);
      if (!advisor) {
        advisorError = 'malformed advisor output';
        gates.advisor.status = 'malformed';
        gates.advisor.reason = 'advisor output was not a valid verdict JSON';
      } else {
        gates.advisor.status = 'ok';
        gates.advisor.verdict = advisor.verdict;
        gates.advisor.confidence = advisor.confidence;
        gates.advisor.reason = advisor.reason;
        gates.advisor.latencyMs = Date.now() - t0;
      }
    } catch (e) {
      const isTimeout = e && (e.name === 'AbortError' || /abort|timeout/i.test(e.message || ''));
      advisorError = isTimeout ? 'advisor timeout' : `advisor error: ${e.message}`;
      gates.advisor.status = isTimeout ? 'timeout' : 'error';
      gates.advisor.reason = advisorError;
      gates.advisor.latencyMs = Date.now() - t0;
    }
  } else {
    gates.advisor.status = 'skipped';
    gates.advisor.reason = evidenceOk ? 'bounds row unavailable — advisor not consulted' : 'evidence write failed';
  }

  // Verdict + outcome. Advisor failure can only ever be REVIEW-equivalent:
  // it forces 'blocked' here because confidence is unknown (< floor).
  const advisorApprove =
    advisor && advisor.verdict === VERDICTS.AUTO_APPROVE && advisor.confidence >= CONFIDENCE_FLOOR;
  const eligible = advisorApprove && boundsResult.pass && !opts.paused;

  const verdict = advisor
    ? advisorApprove && boundsResult.pass
      ? VERDICTS.AUTO_APPROVE
      : advisor.verdict === VERDICTS.AUTO_APPROVE
        ? VERDICTS.REVIEW // model approved but bounds/policy refused — human decides
        : advisor.verdict
    : VERDICTS.REVIEW; // no usable advisor verdict -> REVIEW, never approve

  const outcome = eligible
    ? (execEnabled ? 'authorized' : 'would have executed')
    : 'blocked';

  const decision = {
    proposalId,
    type,
    verdict,
    confidence: advisor ? advisor.confidence : null,
    outcome,
    execEnabled,
    paused: !!opts.paused,
    gates,
    advisorError: advisorError || undefined,
    latencyMs: Date.now() - startedAt,
    decidedAt: new Date().toISOString(),
  };

  // Second evidence row: the gate decision, per-gate detail included.
  try {
    await recordEvent({
      event_type: 'action_gate_decision',
      division: proposal.division || 'ops',
      payload: {
        event: 'decided',
        proposalId,
        type,
        verdict: decision.verdict,
        confidence: decision.confidence,
        outcome: decision.outcome,
        execEnabled: decision.execEnabled,
        gates: decision.gates,
        advisorError: decision.advisorError || null,
        model,
      },
      created_at: decision.decidedAt,
    });
  } catch {
    // Evidence write for the decision is fail-soft: the verdict stands.
  }

  appendGateLog({
    at: decision.decidedAt,
    proposalId,
    type,
    division: proposal.division || null,
    verdict: decision.verdict,
    confidence: decision.confidence,
    outcome: decision.outcome,
    advisorStatus: gates.advisor.status,
    boundsPass: gates.bounds.pass,
    envPass: gates.env.pass,
    latencyMs: decision.latencyMs,
  }, opts.gateLogPath);

  return decision;
}

module.exports = {
  adviseProposal,
  callOllamaAdvisor,
  parseAdvisorVerdict,
  buildAdvisorPrompt,
  evaluateBoundsGate,
  appendGateLog,
  VERDICTS,
  CONFIDENCE_FLOOR,
};
