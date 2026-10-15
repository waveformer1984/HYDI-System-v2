/**
 * POST /api/billing/admin/walkie-bindings — bind an approved Walkie device to a tenant (owner workflow).
 * Body: { device_id, tenant_id, reason, confirm: true }
 */
import { getBillingService, sendError, allowMethods, requireBillingAdmin, body } from '../../../../lib/billing/http';
import { bindWalkieOwner } from '../../../../lib/billing/identity-service';
import { BillingError } from '../../../../lib/billing/errors';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  const actor = await requireBillingAdmin(req, res, { permission: 'billing:tenants:manage', routeName: 'walkie-bindings' });
  if (!actor) return;
  try {
    const b = body(req);
    if (b.confirm !== true) throw new BillingError('confirmation_required', 'confirm: true required', 400);
    const deviceId = typeof b.device_id === 'string' ? b.device_id.trim() : '';
    const tenantId = typeof b.tenant_id === 'string' ? b.tenant_id.trim() : '';
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (!deviceId || !tenantId) throw new BillingError('invalid_request', 'device_id and tenant_id required', 400);
    if (reason.length < 5) throw new BillingError('reason_required', 'reason required (min 5 chars)', 400);
    const row = await bindWalkieOwner(getBillingService().store, {
      deviceId,
      tenantId,
      actor,
      reason,
    });
    res.status(200).json({ ok: true, binding: row });
  } catch (err) {
    sendError(res, err);
  }
}
