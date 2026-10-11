/**
 * Catalog management. Auth: operator, permission billing:catalog:manage.
 *
 * GET  → { products, plans, prices } (all statuses)
 * POST { op: 'create_product', product_key, name, description?, revenue_stream }
 *      { op: 'create_plan', product_id, plan_key, name, description?, features[], limits{}, sort_order? }
 *      { op: 'create_price', plan_id, currency, unit_amount_minor, billing_interval, interval_count?, trial_days?, provider_price_id? }
 *      { op: 'publish_price', price_version_id, create_in_provider?, confirm: true, reason }
 *      { op: 'set_status', kind: 'product'|'plan'|'price', id, status: 'published'|'archived', reason }
 * Published price versions are immutable: change a price by creating a new
 * version. Existing subscribers keep the version they agreed to.
 */
import { getBillingService, sendError, allowMethods, requireBillingAdmin, body } from '../../../../lib/billing/http';
import { BillingError } from '../../../../lib/billing/errors';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  const actor = await requireBillingAdmin(req, res, { permission: 'billing:catalog:manage', routeName: 'admin-catalog' });
  if (!actor) return;
  const service = getBillingService();
  try {
    if (req.method === 'GET') return res.status(200).json(await service.listCatalogAdmin());
    const b = body(req);
    switch (b.op) {
      case 'create_product': return res.status(201).json(await service.createProduct(b, actor));
      case 'create_plan': return res.status(201).json(await service.createPlan(b, actor));
      case 'create_price': return res.status(201).json(await service.createPriceVersion(b, actor));
      case 'publish_price':
        return res.status(200).json(await service.publishPriceVersion(b.price_version_id, {
          createInProvider: b.create_in_provider === true, confirm: b.confirm, reason: b.reason,
        }, actor));
      case 'set_status': return res.status(200).json(await service.setCatalogStatus(b.kind, b.id, b.status, { reason: b.reason }, actor));
      default: throw new BillingError('invalid_request', 'unknown op', 400);
    }
  } catch (err) {
    return sendError(res, err);
  }
}
