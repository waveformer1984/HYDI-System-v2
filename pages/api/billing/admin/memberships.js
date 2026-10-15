/**
 * POST /api/billing/admin/memberships — revoke or reactivate tenant membership (operator, audited).
 * Body: { op: 'revoke'|'reactivate', tenant_id, auth_user_id, reason, confirm: true }
 */
import { getBillingService, sendError, allowMethods, requireBillingAdmin, body } from '../../../../lib/billing/http';
import { setMembershipStatus } from '../../../../lib/billing/identity-service';
import { BillingError } from '../../../../lib/billing/errors';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  const actor = await requireBillingAdmin(req, res, { permission: 'billing:tenants:manage', routeName: 'memberships' });
  if (!actor) return;
  try {
    const b = body(req);
    if (b.confirm !== true) throw new BillingError('confirmation_required', 'confirm: true required', 400);
    const op = typeof b.op === 'string' ? b.op.trim() : '';
    const tenantId = typeof b.tenant_id === 'string' ? b.tenant_id.trim() : '';
    const authUserId = typeof b.auth_user_id === 'string' ? b.auth_user_id.trim() : '';
    const reason = typeof b.reason === 'string' ? b.reason.trim() : '';
    if (!tenantId || !authUserId) throw new BillingError('invalid_request', 'tenant_id and auth_user_id required', 400);
    if (reason.length < 5) throw new BillingError('reason_required', 'reason required (min 5 chars)', 400);
    if (op !== 'revoke' && op !== 'reactivate') {
      throw new BillingError('invalid_request', "op must be 'revoke' or 'reactivate'", 400);
    }
    const status = op === 'revoke' ? 'revoked' : 'active';
    const row = await setMembershipStatus(getBillingService().store, {
      tenantId,
      authUserId,
      status,
      actor,
      reason,
    });
    res.status(200).json({ ok: true, membership: row });
  } catch (err) {
    sendError(res, err);
  }
}
