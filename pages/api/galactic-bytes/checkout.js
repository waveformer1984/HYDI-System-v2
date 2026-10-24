import {
  allowMethods,
  body,
  getGalacticBytesCommerce,
  sendError,
} from '../../../lib/billing/http';
import { rateLimit } from '../../../lib/rate-limit';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  if (!rateLimit(req, res, { name: 'galactic-bytes:checkout', windowMs: 60000, max: 10 })) return;
  try {
    const input = body(req);
    const idempotencyKey = req.headers['idempotency-key'] || input.idempotency_key;
    const result = await getGalacticBytesCommerce().startCheckout({
      email: input.email,
      idempotencyKey,
    });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json(result);
  } catch (error) {
    return sendError(res, error);
  }
}
