/**
 * POST /api/billing/admin/reconcile — re-read non-terminal subscriptions and
 * stale open checkouts from the provider and correct local state.
 * Auth: operator, permission billing:reconcile. Read-only at the provider.
 */
import { getBillingService, sendError, allowMethods, requireBillingAdmin } from '../../../../lib/billing/http';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  const actor = await requireBillingAdmin(req, res, { permission: 'billing:reconcile', routeName: 'admin-reconcile', rateMax: 5 });
  if (!actor) return;
  try {
    const report = await getBillingService().reconcile();
    await getBillingService().audit(actor, 'reconcile.run', { type: 'system', id: 'reconcile' }, { after: report });
    res.status(200).json(report);
  } catch (err) {
    sendError(res, err);
  }
}
