/**
 * POST /api/billing/admin/walkie-bindings — bind or revoke Walkie → tenant (operator, audited).
 * Body bind:  { op: 'bind', device_id, tenant_id, reason, confirm: true }
 * Body revoke: { op: 'revoke', device_id, tenant_id?, reason, confirm: true }
 */
import { getBillingService, sendError, allowMethods, requireBillingAdmin, body } from '../../../../lib/billing/http';
import { bindWalkieOwner, revokeWalkieBinding } from '../../../../lib/billing/identity-service';
import { BillingError } from '../../../../lib/billing/errors';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  const actor = await requireBillingAdmin(req, res, { permission: 'billing:tenants:manage', routeName: 'walkie-bindings' });
  if (!actor) return;
  try {
    const b = body(req);
    if (b.confirm !== true) throw new BillingError('confirmation_required', 'confirm: true required', 400);
    const op = typeof b.op === 'string' ? b.op.trim() : 'bind';
    const deviceId = typeof b.device_id === 'string' ? b.device_id.trim() : '';
    const tenantId = typeof b.tenant_id === 'string' ? b.tenant_id.trim() : '';
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (!deviceId) throw new BillingError('invalid_request', 'device_id required', 400);
    if (reason.length < 5) throw new BillingError('reason_required', 'reason required (min 5 chars)', 400);
    const store = getBillingService().store;
    if (op === 'revoke') {
      const out = await revokeWalkieBinding(store, { deviceId, tenantId: tenantId || undefined, actor, reason });
      return res.status(200).json({ ok: true, ...out });
    }
    if (op !== 'bind') throw new BillingError('invalid_request', "op must be 'bind' or 'revoke'", 400);
    if (!tenantId) throw new BillingError('invalid_request', 'tenant_id required for bind', 400);
    const row = await bindWalkieOwner(store, { deviceId, tenantId, actor, reason });
    res.status(200).json({ ok: true, binding: row });
  } catch (err) {
    sendError(res, err);
  }
}
