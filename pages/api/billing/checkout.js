/**
 * POST /api/billing/checkout — start hosted checkout for the caller's tenant.
 * Auth: customer bearer token (tenant comes from the token only).
 * Body: { price_version_id: uuid, idempotency_key: string(8-200) }
 * 200: { intent_id, url, reused }. Redirect the browser to `url`.
 * Returning from checkout grants nothing; access follows the verified webhook.
 */
import { getBillingService, sendError, allowMethods, requireCustomer, body } from '../../../lib/billing/http';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  const tenantId = requireCustomer(req, res, { routeName: 'checkout', rateMax: 20 });
  if (!tenantId) return;
  try {
    const b = body(req);
    const out = await getBillingService().startCheckout(tenantId, {
      priceVersionId: b.price_version_id,
      idempotencyKey: b.idempotency_key,
    });
    res.status(200).json(out);
  } catch (err) {
    sendError(res, err);
  }
}
