'use strict';

/**
 * Returns the exact raw bytes of a request body, as a Buffer.
 *
 * Needed anywhere a Stripe webhook signature is verified
 * (stripe.webhooks.constructEvent requires the precise bytes Stripe signed,
 * not a re-serialized JSON object). Next.js API routes that disable the
 * built-in bodyParser (config.api.bodyParser = false) do NOT auto-populate
 * req.body -- the handler receives the raw, unconsumed request stream and
 * must read it itself. Some callers (e.g. an Express server using
 * express.raw(), or a test harness) already hand in req.body as a
 * Buffer/string; in that case we use it as-is instead of trying to
 * re-consume a stream that was never attached.
 */
async function getRawBody(req) {
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === 'string') return Buffer.from(req.body);

  const chunks = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks);
}

module.exports = { getRawBody };
