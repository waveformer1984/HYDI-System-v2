/**
 * GET /api/billing/account — the caller's billing overview: plan, status,
 * access window, usage vs limits, renewal/cancel dates, payments with
 * invoice links, pending checkouts.
 * Auth: customer bearer token.
 */
import { getBillingService, sendError, allowMethods, requireCustomer } from '../../../lib/billing/http';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;
  const tenantId = requireCustomer(req, res, { routeName: 'account', rateMax: 120 });
  if (!tenantId) return;
  try {
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(await getBillingService().getAccountOverview(tenantId));
  } catch (err) {
    sendError(res, err);
  }
}
