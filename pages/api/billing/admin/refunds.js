/**
 * POST /api/billing/admin/refunds — request a refund at the provider.
 * Auth: operator, permission billing:refund:request (owner only).
 * Body: { payment_id, amount_minor?, reason (5-500 chars), confirm: true }
 * The refund's effect (payment status, access policy) is applied when the
 * provider's charge.refunded webhook arrives — not by this call.
 * AI agents may draft refund suggestions; only this authenticated, confirmed
 * operator call executes one.
 */
import { getBillingService, sendError, allowMethods, requireBillingAdmin, body } from '../../../../lib/billing/http';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  const actor = await requireBillingAdmin(req, res, { permission: 'billing:refund:request', routeName: 'admin-refunds', rateMax: 10 });
  if (!actor) return;
  try {
    const b = body(req);
    res.status(200).json(await getBillingService().requestRefund({
      paymentId: b.payment_id, amountMinor: b.amount_minor, reason: b.reason, confirm: b.confirm,
    }, actor));
  } catch (err) {
    sendError(res, err);
  }
}
