/**
 * GET /api/billing/admin/audit?tenant_id=&limit= — append-only billing audit trail.
 * Auth: operator, permission billing:finance:view.
 */
import { getBillingService, sendError, allowMethods, requireBillingAdmin } from '../../../../lib/billing/http';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;
  const actor = await requireBillingAdmin(req, res, { permission: 'billing:finance:view', routeName: 'admin-audit' });
  if (!actor) return;
  try {
    const tenantId = req.query.tenant_id ? String(req.query.tenant_id) : undefined;
    res.status(200).json({ events: await getBillingService().listAudit({ tenantId, limit: Number(req.query.limit) || 100 }) });
  } catch (err) {
    sendError(res, err);
  }
}
