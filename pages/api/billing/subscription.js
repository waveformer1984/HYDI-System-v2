/**
 * POST /api/billing/subscription — cancel or reactivate the caller's subscription.
 * Auth: customer bearer token.
 * Body: { action: 'cancel' | 'reactivate', subscription_id: uuid, reason?: string }
 * Cancel follows BILLING_CANCEL_POLICY (default: at period end).
 * 200: account overview (same shape as GET /api/billing/account).
 */
import { getBillingService, sendError, allowMethods, requireCustomer, body } from '../../../lib/billing/http';
import { BillingError } from '../../../lib/billing/errors';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  const tenantId = requireCustomer(req, res, { routeName: 'subscription', rateMax: 10 });
  if (!tenantId) return;
  try {
    const b = body(req);
    const service = getBillingService();
    if (b.action === 'cancel') {
      return res.status(200).json(await service.cancelSubscription(tenantId, { subscriptionId: b.subscription_id, reason: b.reason }));
    }
    if (b.action === 'reactivate') {
      return res.status(200).json(await service.reactivateSubscription(tenantId, { subscriptionId: b.subscription_id }));
    }
    throw new BillingError('invalid_request', "action must be 'cancel' or 'reactivate'", 400);
  } catch (err) {
    return sendError(res, err);
  }
}
