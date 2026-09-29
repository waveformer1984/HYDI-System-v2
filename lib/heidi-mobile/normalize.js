'use strict';

/**
 * Pure shape-validation for upstream HYDI payloads before they reach the
 * phone. Anything that doesn't match the expected shape is dropped rather
 * than passed through, so a malformed backend response degrades to "no
 * data" with an explicit error instead of crashing the UI or rendering
 * something misleading.
 */

const SUBSYSTEM_STATUSES = new Set(['healthy', 'degraded', 'critical', 'offline', 'unknown']);
const OVERALL_STATUSES = new Set(['healthy', 'degraded', 'critical', 'offline']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDENT_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,63}$/;

function str(v, max = 500) {
  if (typeof v !== 'string') return null;
  return v.length > max ? `${v.slice(0, max)}…` : v;
}

function num(v) {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

function iso(v) {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? new Date(t).toISOString() : null;
}

function isUuid(v) {
  return typeof v === 'string' && UUID_RE.test(v);
}

function isIdent(v) {
  return typeof v === 'string' && IDENT_RE.test(v);
}

/** /api/status/system payload. Returns null if the core shape is missing. */
function normalizeSystemStatus(data) {
  if (!data || typeof data !== 'object') return null;
  const overall = OVERALL_STATUSES.has(data.overall_status) ? data.overall_status : null;
  const score = num(data.health_score);
  if (!overall || score === null || !data.subsystems || typeof data.subsystems !== 'object') return null;

  const subsystems = [];
  for (const [name, s] of Object.entries(data.subsystems)) {
    if (!isIdent(name) || !s || typeof s !== 'object') continue;
    subsystems.push({
      name,
      status: SUBSYSTEM_STATUSES.has(s.status) ? s.status : 'unknown',
      health_score: num(s.health_score) ?? 0,
      last_heartbeat: iso(s.last_heartbeat),
    });
  }

  const workers = Array.isArray(data.workers) ? data.workers.slice(0, 50).filter((w) => w && isIdent(w.worker_type)).map((w) => ({
    worker_id: isIdent(w.worker_id) ? w.worker_id : null,
    worker_type: w.worker_type,
    status: str(w.status, 32) || 'unknown',
    last_heartbeat: iso(w.last_heartbeat),
    processed_count: num(w.processed_count),
    error_count: num(w.error_count),
  })) : [];

  const events = Array.isArray(data.recent_events) ? data.recent_events.slice(0, 20).filter((e) => e && typeof e === 'object').map((e) => ({
    subsystem: str(e.subsystem, 64),
    from_status: str(e.from_status, 32),
    to_status: str(e.to_status, 32),
    at: iso(e.created_at),
  })) : [];

  return {
    overall_status: overall,
    health_score: Math.max(0, Math.min(100, Math.round(score))),
    subsystems,
    workers,
    recent_events: events,
    reported_at: iso(data.ts),
  };
}

/** /api/health payload (public liveness + system_dashboard verdict). */
function normalizeHealth(data) {
  if (!data || typeof data !== 'object' || typeof data.status !== 'string') return null;
  const metrics = data.metrics && typeof data.metrics === 'object' ? data.metrics : {};
  return {
    status: str(data.status, 32),
    hydi_status: str(data.hydi_status, 32),
    trend_status: str(data.trend_status, 32),
    escalation_level: str(data.escalation_level, 32),
    escalation_reason: str(data.escalation_reason, 300),
    last_check: iso(data.last_check),
    source: data.cloud && typeof data.cloud === 'object' ? str(data.cloud.source, 32) : null,
    jobs_queued: num(metrics.jobs_queued),
    jobs_failed: num(metrics.jobs_failed),
  };
}

/**
 * Collapse the two upstream checks into the single truthful state the phone
 * shows. "online" requires an authenticated, well-formed status snapshot
 * whose overall verdict is healthy — reachability alone is not enough.
 */
function deriveConnectionState(healthResult, systemResult, system) {
  const unreachable = (r) => !r.ok && ['network', 'timeout', 'unconfigured'].includes(r.kind);
  if (unreachable(healthResult) && unreachable(systemResult)) {
    return healthResult.kind === 'unconfigured' ? 'unconfigured' : 'offline';
  }
  if (!systemResult.ok && systemResult.kind === 'unauthorized') {
    return systemResult.reason === 'device not approved' ? 'pending_approval' : 'unauthorized';
  }
  if (!systemResult.ok && systemResult.kind === 'forbidden') return 'forbidden';
  if (!systemResult.ok || !system) return 'degraded';
  if (system.overall_status !== 'healthy') return 'degraded';
  if (healthResult.ok && healthResult.data && healthResult.data.status !== 'healthy') return 'degraded';
  return 'online';
}

/** Pending approvals from GET /api/actions. */
function normalizeApprovals(data) {
  if (!data || !Array.isArray(data.actions)) return null;
  return data.actions.filter((a) => a && isUuid(a.id)).slice(0, 50).map((a) => ({
    id: a.id,
    action_type: str(a.action_type, 64) || 'unknown',
    summary: str(a.summary, 300),
    session_id: str(a.session_id, 128),
    created_at: iso(a.created_at),
  }));
}

/** GET /api/work-sessions. */
function normalizeWorkSessions(data) {
  if (!data || !Array.isArray(data.sessions)) return null;
  const sessions = data.sessions.filter((s) => s && typeof s === 'object').slice(0, 25).map((s) => ({
    id: str(String(s.id ?? ''), 64),
    goal: str(s.goal, 300),
    status: str(s.status, 32) || 'unknown',
    current_task: str(s.current_task, 300),
    completed_steps: num(s.completed_steps) ?? 0,
    total_steps: num(s.total_steps) ?? 0,
    created_at: iso(s.created_at),
    completed_at: iso(s.completed_at),
  }));
  return { sessions, queue_depth: num(data.queue_depth) ?? 0 };
}

/** GET /api/agent-manager/control (recent worker commands). */
function normalizeCommands(data) {
  if (!data || !Array.isArray(data.commands)) return null;
  return data.commands.filter((c) => c && typeof c === 'object').slice(0, 20).map((c) => ({
    id: str(String(c.id ?? ''), 64),
    worker_type: str(c.worker_type, 64),
    worker_id: str(c.worker_id, 64),
    command: str(c.command, 32),
    status: str(c.status, 32) || 'unknown',
    error: str(c.error_message, 300),
    requested_by: str(c.requested_by, 64),
    created_at: iso(c.created_at),
    completed_at: iso(c.completed_at),
  }));
}

/** GET /api/notifications. */
function normalizeNotifications(data) {
  if (!data || !Array.isArray(data.notifications)) return null;
  return data.notifications.filter((n) => n && typeof n === 'object').slice(0, 30).map((n) => ({
    id: str(String(n.id ?? ''), 64),
    category: str(n.category, 32),
    severity: str(n.severity, 16),
    title: str(n.title, 200),
    body: str(n.body, 500),
    created_at: iso(n.created_at),
    read: Boolean(n.read_at),
  }));
}

/**
 * Translate one upstream /api/chat SSE `data:` payload into the small event
 * vocabulary the phone understands. Returns null for anything unrecognised.
 */
function normalizeChatEvent(payload) {
  if (!payload || typeof payload !== 'object') return null;
  switch (payload.type) {
    case 'content':
      return typeof payload.content === 'string' ? { type: 'delta', text: payload.content } : null;
    case 'metadata':
      return { type: 'meta', model: str(payload.model_used, 80) };
    case 'tool': {
      // lib/heidi-agent.ts AgentToolEvent: { type, status, result?, error? }.
      // `result` is deliberately not forwarded — it can carry raw tool output.
      const tool = payload.tool && typeof payload.tool === 'object' ? payload.tool : {};
      return { type: 'tool', name: str(tool.type, 80), status: str(tool.status, 32), error: str(tool.error, 300) };
    }
    case 'actions': {
      if (!Array.isArray(payload.actions)) return null;
      return {
        type: 'actions',
        actions: payload.actions.filter((a) => a && typeof a === 'object').slice(0, 10).map((a) => ({
          type: str(a.type, 64),
          status: str(a.status, 32),
          actionId: isUuid(a.actionId) ? a.actionId : null,
          error: str(a.error, 300),
        })),
      };
    }
    case 'error':
      return { type: 'error', message: str(payload.error, 300) || 'HYDI reported an error' };
    default:
      return null;
  }
}

module.exports = {
  isUuid,
  isIdent,
  normalizeSystemStatus,
  normalizeHealth,
  deriveConnectionState,
  normalizeApprovals,
  normalizeWorkSessions,
  normalizeCommands,
  normalizeNotifications,
  normalizeChatEvent,
};
