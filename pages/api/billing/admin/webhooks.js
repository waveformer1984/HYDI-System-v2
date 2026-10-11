/**
 * Webhook inbox operations.
 *
 * GET  ?status=dead_letter|failed|...&limit=  → events (payload omitted)      [billing:finance:view]
 * POST { op: 'replay', event_row_id, confirm: true, reason }                  [billing:webhook:replay — owner]
 * POST { op: 'process_due' } → run the retry pass now                         [billing:webhook:replay — owner]
 */
import { getBillingService, sendError, allowMethods, requireBillingAdmin, body } from '../../../../lib/billing/http';
import { BillingError } from '../../../../lib/billing/errors';

const STATUSES = ['received', 'processing', 'processed', 'ignored', 'failed', 'dead_letter'];

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET', 'POST'])) return;
  const service = getBillingService();
  if (req.method === 'GET') {
    const actor = await requireBillingAdmin(req, res, { permission: 'billing:finance:view', routeName: 'admin-webhooks' });
    if (!actor) return;
    try {
      const status = req.query.status ? String(req.query.status) : undefined;
      if (status && !STATUSES.includes(status)) throw new BillingError('invalid_request', 'unknown status', 400);
      return res.status(200).json({ events: await service.listWebhookEvents({ status, limit: Number(req.query.limit) || 50 }) });
    } catch (err) {
      return sendError(res, err);
    }
  }
  const actor = await requireBillingAdmin(req, res, { permission: 'billing:webhook:replay', routeName: 'admin-webhooks-replay', rateMax: 10 });
  if (!actor) return;
  try {
    const b = body(req);
    if (b.op === 'replay') return res.status(200).json(await service.replayWebhookEvent(b.event_row_id, { reason: b.reason, confirm: b.confirm }, actor));
    if (b.op === 'process_due') return res.status(200).json({ results: await service.processDueWebhookEvents({ limit: 100 }) });
    throw new BillingError('invalid_request', "op must be 'replay' or 'process_due'", 400);
  } catch (err) {
    return sendError(res, err);
  }
}
