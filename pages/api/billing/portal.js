/**
 * POST /api/billing/portal — provider-hosted billing portal session
 * (payment methods, invoices, plan changes). Auth: customer bearer token.
 * 200: { url }
 */
import { getBillingService, sendError, allowMethods, requireCustomer } from '../../../lib/billing/http';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  const tenantId = requireCustomer(req, res, { routeName: 'portal', rateMax: 20 });
  if (!tenantId) return;
  try {
    res.status(200).json(await getBillingService().createPortalSession(tenantId));
  } catch (err) {
    sendError(res, err);
  }
}
