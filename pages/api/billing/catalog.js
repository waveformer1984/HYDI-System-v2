/**
 * GET /api/billing/catalog — public list of purchasable plans.
 * Only published products/plans/price versions appear. No auth: this is the
 * pricing page's data. Amounts are integer minor units.
 */
import { getBillingService, sendError, allowMethods } from '../../../lib/billing/http';
import { rateLimit } from '../../../lib/rate-limit';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;
  if (!rateLimit(req, res, { name: 'billing:catalog', windowMs: 60000, max: 120 })) return;
  try {
    const products = await getBillingService().listPublishedCatalog();
    res.setHeader('Cache-Control', 'public, max-age=60');
    res.status(200).json({ products });
  } catch (err) {
    sendError(res, err);
  }
}
