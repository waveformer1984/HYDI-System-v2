/**
 * POST /api/billing/ai/complete — a billable AI completion (feature
 * `ai_completions`, 1 unit per request), run through the metering wrapper:
 * entitlement + quota reservation → local model call → commit usage and
 * record provider cost; release the reservation if the model call fails.
 *
 * Auth: customer bearer token.
 * Body: { prompt: string(1-4000), idempotency_key: string(8-200) }
 * 200: { usage_id, text } | { usage_id, duplicate: true }  (retries are never
 *      charged twice; the original text is not cached and is not re-sent)
 * 402 not_entitled · 429 quota_exceeded / spending_cap_reached ·
 * 409 operation_in_progress · 503 model_unavailable
 */
import { getBillingService, sendError, allowMethods, requireCustomer, body } from '../../../../lib/billing/http';
import { BillingError } from '../../../../lib/billing/errors';
import { LocalModelClient } from '../../../../api/local-model';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  const tenantId = requireCustomer(req, res, { routeName: 'ai-complete', rateMax: 30 });
  if (!tenantId) return;
  try {
    const b = body(req);
    if (typeof b.prompt !== 'string' || !b.prompt.trim() || b.prompt.length > 4000) {
      throw new BillingError('invalid_request', 'prompt must be 1-4000 characters', 400);
    }
    const client = new LocalModelClient();
    const out = await getBillingService().runMetered({
      tenantId,
      featureKey: 'ai_completions',
      units: 1,
      idempotencyKey: b.idempotency_key,
      jobRef: `ai-complete:${b.idempotency_key}`,
      operation: async () => {
        let r;
        try {
          r = await client.generate(b.prompt, { max_tokens: 800 });
        } catch (e) {
          throw new BillingError('model_unavailable', 'the AI model is unavailable; you were not charged', 503);
        }
        return {
          result: { text: r.text },
          costs: [{ provider: client.provider, model: r.model || client.model, inputUnits: r.prompt_eval_count, outputUnits: r.eval_count }],
        };
      },
    });
    if (out.duplicate) return res.status(200).json({ usage_id: out.usage_id, duplicate: true });
    return res.status(200).json({ usage_id: out.usage_id, text: out.result.text });
  } catch (err) {
    return sendError(res, err);
  }
}
