/**
 * GET /api/billing/admin/revenue?from=ISO&to=ISO — revenue dashboard data.
 * Auth: operator, permission billing:finance:view.
 * Window defaults to the current UTC calendar month. Every metric ships with
 * its definition (formula, source, window, currency, statuses, limitations).
 */
import { getBillingService, sendError, allowMethods, requireBillingAdmin } from '../../../../lib/billing/http';
import { buildRevenueReport } from '../../../../lib/billing/reporting';
import { BillingError } from '../../../../lib/billing/errors';

function parseDate(v, fallback) {
  if (v === undefined) return fallback;
  const d = new Date(String(v));
  if (Number.isNaN(d.getTime())) throw new BillingError('invalid_request', 'from/to must be ISO-8601 dates', 400);
  return d;
}

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;
  const actor = await requireBillingAdmin(req, res, { permission: 'billing:finance:view', routeName: 'admin-revenue' });
  if (!actor) return;
  try {
    const now = new Date();
    const from = parseDate(req.query.from, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)));
    const to = parseDate(req.query.to, new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));
    if (to.getTime() <= from.getTime()) throw new BillingError('invalid_request', 'to must be after from', 400);
    res.setHeader('Cache-Control', 'no-store');
    res.status(200).json(await buildRevenueReport(getBillingService(), { from, to }));
  } catch (err) {
    sendError(res, err);
  }
}
