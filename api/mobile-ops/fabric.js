// HYDI Execution Fabric — unified capability gateway for mobile ops.
// GET  → capabilities, readiness, task status, history
// POST → submit capability (lifecycle + idempotency), cancel job-backed task
//
// Distinct from raw /api/mobile-ops/run: every execution gets a durable task
// record with explicit states and verification evidence.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth/requireAuth.js';
import { getExecutionGateway } from '../../lib/execution-fabric/gateway.js';
import { assessExecutionFabricReadiness } from '../../lib/execution-fabric/readiness.js';
import { computeSubsystemHealth, computeOverallHealth } from '../../lib/realtime/healthScore.js';
import { trackedSubsystems } from '../../lib/realtime/subsystems.js';

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

const TASK_ID_RE = /^[a-f0-9]{24}$/;

function normalizeRequestAction(body) {
  if (!body || typeof body !== 'object') return null;

  if (body.approve === true) return 'approve';
  if (body.retry === true) return 'retry';
  if (body.cancel === true) return 'cancel';

  if (typeof body.objective_id === 'string' && body.objective_id.length > 0) return 'objective';
  if (typeof body.objective === 'string' && body.objective.length > 0) return 'objective';

  if (typeof body.capability_id === 'string' && body.capability_id.length > 0) return 'capability';
  if (typeof body.capability === 'string' && body.capability.length > 0) return 'capability';
  if (typeof body.action === 'string' && body.action.length > 0) return 'capability';

  return null;
}

async function loadServiceStatusSnapshot() {
  const [statusResult, eventsResult, workersResult] = await Promise.all([
    supabase.from('hydi_subsystem_status').select('*'),
    supabase.from('hydi_status_events').select('*').order('created_at', { ascending: false }).limit(20),
    supabase.from('worker_status').select('*'),
  ]);
  if (statusResult.error) throw new Error(statusResult.error.message);

  const byName = {};
  for (const row of statusResult.data || []) byName[row.subsystem] = row;

  const subsystems = {};
  for (const name of trackedSubsystems()) {
    subsystems[name] = computeSubsystemHealth(byName[name]);
    subsystems[name].last_heartbeat = byName[name] ? byName[name].last_heartbeat : null;
  }

  const overallHealth = computeOverallHealth(subsystems);
  return {
    health_score: overallHealth,
    overall_status: overallHealth >= 90 ? 'healthy' : overallHealth >= 60 ? 'degraded' : overallHealth >= 20 ? 'critical' : 'offline',
    subsystems,
    workers: (workersResult.data || []).map((w) => ({
      worker_id: w.worker_id,
      worker_type: w.worker_type,
      status: w.status,
      last_heartbeat: w.last_heartbeat,
    })),
    recent_events: (eventsResult.data || []).slice(0, 10),
    ts: new Date().toISOString(),
  };
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.MOBILE_CHAT_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token, x-idempotency-key');
  res.setHeader('Cache-Control', 'no-store');
  if (req.method === 'OPTIONS') return res.status(204).end();

  const gateway = getExecutionGateway();
  const requestAction = normalizeRequestAction(req.body);

  if (req.method === 'GET') {
    const auth = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'mobile-ops-fabric-read' });
    if (!auth.ok) return;

    if (req.query?.readiness === '1' || req.query?.readiness === 'true') {
      return res.status(200).json(
        assessExecutionFabricReadiness({
          store: gateway.store,
          supabaseConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
        }),
      );
    }

    if (req.query?.recovery === '1' || req.query?.recovery === 'true') {
      const status = await gateway.recoveryStatus();
      return res.status(200).json(status);
    }

    const taskId = typeof req.query?.task_id === 'string' ? req.query.task_id : null;
    if (taskId) {
      if (!TASK_ID_RE.test(taskId)) return res.status(400).json({ error: 'invalid_task_id' });
      const out = await gateway.getTask(taskId, auth.role);
      if (!out.ok) return res.status(out.error === 'not_found' ? 404 : 403).json(out);
      return res.status(200).json(out);
    }

    if (req.query?.history === '1' || req.query?.history === 'true') {
      const listed = await gateway.listTasks({ limit: Number(req.query.limit || 20) });
      return res.status(200).json(listed);
    }

    return res.status(200).json({ capabilities: gateway.listCapabilities(auth.role) });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body && typeof req.body === 'object' ? req.body : {};
  const idempotencyKey =
    typeof req.headers['x-idempotency-key'] === 'string' ? req.headers['x-idempotency-key'].slice(0, 128) : body.idempotency_key || null;

  switch (requestAction) {
    case 'approve': {
      const auth = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'mobile-ops-fabric-approve' });
      if (!auth.ok) return;
      if (typeof body.task_id !== 'string' || !TASK_ID_RE.test(body.task_id)) {
        return res.status(400).json({ error: 'invalid_task_id' });
      }
      const out = await gateway.approveTask(body.task_id, auth.role, body.confirm === true, {
        loadServiceStatus: loadServiceStatusSnapshot,
      });
      const code = out.error === 'not_found' ? 404 : out.error === 'forbidden' ? 403 : out.ok || out.awaiting_approval ? 200 : 400;
      return res.status(code).json(out);
    }

    case 'retry': {
      const auth = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'mobile-ops-fabric-retry' });
      if (!auth.ok) return;
      if (typeof body.task_id !== 'string' || !TASK_ID_RE.test(body.task_id)) {
        return res.status(400).json({ error: 'invalid_task_id' });
      }
      const out = await gateway.orchestrator.retryObjective(body.task_id, auth.role, {
        loadServiceStatus: loadServiceStatusSnapshot,
      });
      const code = out.error === 'not_found' ? 404 : out.ok ? 200 : 400;
      return res.status(code).json(out);
    }

    case 'cancel': {
      const auth = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'mobile-ops-fabric-cancel' });
      if (!auth.ok) return;
      if (typeof body.task_id !== 'string' || !TASK_ID_RE.test(body.task_id)) {
        return res.status(400).json({ error: 'invalid_task_id' });
      }
      const out = await gateway.cancel(body.task_id, auth.role);
      await supabase
        .from('auth_audit_log')
        .insert({
          event_type: out.ok ? 'execution_fabric_cancel' : 'execution_fabric_cancel_failed',
          device_id: auth.deviceId || null,
          role: auth.role,
          reason: body.task_id,
          metadata: { task_id: body.task_id },
        })
        .then(undefined, () => {});
      const code = out.error === 'not_found' ? 404 : out.error === 'forbidden' ? 403 : out.ok ? 200 : 400;
      return res.status(code).json(out);
    }

    case 'objective': {
      const auth = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'mobile-ops-fabric-objective' });
      if (!auth.ok) return;
      const objectiveId = body.objective_id || body.objective;
      const out = await gateway.orchestrator.submitObjective({
        objectiveId,
        role: auth.role,
        actor: auth.deviceId || auth.role,
        idempotencyKey,
        confirm: body.confirm === true,
        ctx: { loadServiceStatus: loadServiceStatusSnapshot },
      });
      if (out.error === 'unknown_objective' || out.error === 'forbidden') {
        return res.status(out.error === 'forbidden' ? 403 : 400).json(out);
      }
      if (out.awaiting_approval) return res.status(202).json(out);
      const http = out.ok ? 200 : 502;
      return res.status(http).json(out);
    }

    default: {
      const capabilityId = body.capability || body.capability_id || body.action;
      const auth = await requireAuth(req, res, supabase, { permission: 'status:view', routeName: 'mobile-ops-fabric-run' });
      if (!auth.ok) return;

      let loadServiceStatus;
      try {
        loadServiceStatus = loadServiceStatusSnapshot;
      } catch (_) {
        loadServiceStatus = async () => ({ error: 'supabase_unconfigured' });
      }

      const outcome = await gateway.submit({
        capabilityId,
        args: body.args && typeof body.args === 'object' ? body.args : {},
        confirm: body.confirm === true,
        role: auth.role,
        actor: auth.deviceId || auth.role,
        objective: typeof body.objective === 'string' ? body.objective.slice(0, 500) : null,
        idempotencyKey,
        ctx: { loadServiceStatus },
      });

      await supabase
        .from('auth_audit_log')
        .insert({
          event_type: outcome.ok || outcome.awaiting_approval ? 'execution_fabric_submit' : 'execution_fabric_rejected',
          device_id: auth.deviceId || null,
          role: auth.role,
          reason: typeof capabilityId === 'string' ? capabilityId.slice(0, 64) : null,
          metadata: {
            task_id: outcome.task?.id || null,
            state: outcome.task?.state || null,
            duplicate: outcome.duplicate === true,
          },
        })
        .then(undefined, () => {});

      if (outcome.error === 'unknown_capability' || outcome.error === 'forbidden') {
        return res.status(outcome.error === 'forbidden' ? 403 : 400).json(outcome);
      }
      if (outcome.awaiting_approval) return res.status(202).json(outcome);
      if (outcome.accepted) return res.status(202).json(outcome);
      const http = outcome.ok ? 200 : 502;
      return res.status(http).json(outcome);
    }
  }
}
