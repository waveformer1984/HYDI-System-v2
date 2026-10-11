/**
 * POST /api/billing/webhook — billing provider webhook endpoint.
 *
 * 1. Verify the signature against the exact raw bytes (bodyParser disabled).
 * 2. Store the event durably (unique provider event id → duplicates are no-ops).
 * 3. Process it inline. A processing failure still returns 200: the event is
 *    stored and the retry worker (scripts/billing-worker.js) owns retries,
 *    backoff and dead-lettering. Only a storage failure returns 5xx, so the
 *    provider retries delivery.
 */
import { getBillingService, sendError, allowMethods } from '../../../lib/billing/http';
import { getRawBody } from '../../../lib/get-raw-body';

export const config = { api: { bodyParser: false } };

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  const service = getBillingService();
  let stored;
  try {
    const raw = await getRawBody(req);
    stored = await service.receiveWebhook(raw, req.headers);
  } catch (err) {
    return sendError(res, err);
  }
  if (stored.duplicate) return res.status(200).json({ received: true, duplicate: true });
  let outcome = 'deferred';
  try {
    outcome = (await service.processWebhookEvent(stored.eventRowId)).outcome;
  } catch (_) {
    // Stored durably; the retry worker will pick it up.
  }
  return res.status(200).json({ received: true, duplicate: false, outcome });
}
