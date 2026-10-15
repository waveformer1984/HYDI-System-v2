/**
 * POST /api/billing/admin/offboarding
 * op: 'preview' | 'execute' | 'recovery'
 * Body: { op, confirm?, reason?, correlation_id?, scope: { ... } }
 */
import { getBillingService, sendError, allowMethods, requireBillingAdmin, body } from '../../../../lib/billing/http';
import { BillingError } from '../../../../lib/billing/errors';
import {
  previewOffboarding,
  executeOffboarding,
  executeRecovery,
  loadTask,
  taskDir,
} from '../../../../lib/billing/offboarding-workflow';

const defaultRoot = () => process.env.HYDI_REPO_ROOT || process.cwd();

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  const actor = await requireBillingAdmin(req, res, { permission: 'billing:tenants:manage', routeName: 'offboarding', rateMax: 10 });
  if (!actor) return;
  try {
    const b = body(req);
    const op = typeof b.op === 'string' ? b.op.trim() : '';
    const scope = b.scope && typeof b.scope === 'object' ? b.scope : {};
    const store = getBillingService().store;
    const root = defaultRoot();

    if (op === 'preview') {
      const preview = await previewOffboarding(store, normalizeScope(scope));
      return res.status(200).json({ ok: true, preview });
    }
    if (op === 'execute') {
      if (b.confirm !== true) throw new BillingError('confirmation_required', 'confirm: true required', 400);
      const task = await executeOffboarding(store, {
        actor,
        reason: typeof b.reason === 'string' ? b.reason.trim() : '',
        scope: normalizeScope(scope),
        correlation_id: typeof b.correlation_id === 'string' ? b.correlation_id.trim() : undefined,
        root,
        verify: b.verify !== false,
      });
      const ok = task.disposition === 'success';
      return res.status(ok ? 200 : 207).json({ ok, task: sanitizeTask(task) });
    }
    if (op === 'recovery') {
      if (b.confirm !== true) throw new BillingError('confirmation_required', 'confirm: true required', 400);
      const out = await executeRecovery(store, {
        actor,
        reason: typeof b.reason === 'string' ? b.reason.trim() : '',
        scope: normalizeScope(scope),
        root,
      });
      return res.status(200).json({ ok: out.disposition === 'success', recovery: out });
    }
    if (op === 'status') {
      const id = typeof b.correlation_id === 'string' ? b.correlation_id.trim() : '';
      if (!id) throw new BillingError('invalid_request', 'correlation_id required', 400);
      const task = loadTask(root, id);
      if (!task) throw new BillingError('not_found', 'offboarding task not found', 404);
      return res.status(200).json({ ok: true, task: sanitizeTask(task) });
    }
    throw new BillingError('invalid_request', "op must be preview, execute, recovery, or status", 400);
  } catch (err) {
    sendError(res, err);
  }
}

function normalizeScope(scope) {
  return {
    tenant_id: typeof scope.tenant_id === 'string' ? scope.tenant_id.trim() : undefined,
    auth_user_id: typeof scope.auth_user_id === 'string' ? scope.auth_user_id.trim() : undefined,
    device_id: typeof scope.device_id === 'string' ? scope.device_id.trim() : undefined,
    legacy_bearer_preview: typeof scope.legacy_bearer_preview === 'string' ? scope.legacy_bearer_preview.trim() : undefined,
    revoke_membership: scope.revoke_membership === true,
    revoke_walkie_binding: scope.revoke_walkie_binding === true,
    revoke_legacy_nonce: scope.revoke_legacy_nonce === true,
    revoke_all_legacy_tokens: scope.revoke_all_legacy_tokens === true,
    invalidate_supabase_sessions: scope.invalidate_supabase_sessions === true,
    reactivate_membership: scope.reactivate_membership === true,
    rebind_walkie: scope.rebind_walkie === true,
  };
}

function sanitizeTask(task) {
  return {
    correlation_id: task.correlation_id,
    status: task.status,
    disposition: task.disposition,
    preview: task.preview,
    results: task.results,
    verification: task.verification,
    updated_at: task.updated_at,
    task_dir: taskDir(defaultRoot()),
  };
}
