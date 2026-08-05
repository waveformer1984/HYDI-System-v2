'use strict';

/**
 * Claim/settle lifecycle for Stripe webhook replay protection.
 *
 * Every Stripe webhook consumer in this repo guards against Stripe's retries
 * by calling the `claim_webhook_event(p_event_id, p_type)` RPC, which inserts
 * a row into `webhook_events` with `ON CONFLICT (event_id) DO NOTHING` and
 * returns the new row id -- or NULL when the event was already claimed.
 *
 * A claim is a *lease*, not a receipt. Taking one and never settling it turns
 * the replay guard into a data-loss mechanism:
 *
 *   1. Stripe delivers payment_intent.succeeded, the handler claims it.
 *   2. Processing throws (Supabase blip, missing Connect account, bad row).
 *   3. The handler returns 5xx, so Stripe schedules a retry -- correct.
 *   4. The retry re-claims, gets NULL because the row from step 1 is still
 *      there, and is answered `200 duplicate`.
 *   5. Stripe stops retrying. The payment never reached `financial_ledger`,
 *      and every dashboard says the webhook succeeded.
 *
 * The fix is to settle the lease before responding:
 *
 *   - success  -> completeWebhookEvent(): mark the row terminal so it keeps
 *                 suppressing genuine duplicate deliveries forever.
 *   - failure  -> releaseWebhookEvent(): drop the row so Stripe's next retry
 *                 gets a fresh claim and actually reprocesses the event.
 *
 * Releasing means a genuinely poisonous event will be retried on Stripe's
 * backoff schedule until it exhausts (~3 days) and surfaces in the Stripe
 * dashboard as a failing endpoint. That is the intended outcome: a visible,
 * alertable failure is strictly better than a silently dropped payment.
 *
 * These helpers take the Supabase client as an argument rather than
 * constructing one, so each call site keeps using the client it already
 * configured (different routes read different env var fallbacks) and so unit
 * tests can drive them with a stub.
 */

/** Status written by `claim_webhook_event` when a lease is taken. */
const STATUS_PROCESSING = 'processing';

/** Terminal status: the event was fully handled and must never run again. */
const STATUS_COMPLETED = 'completed';

/**
 * Attempt to claim a webhook event for processing.
 *
 * Distinguishes the three outcomes that callers must treat differently -- in
 * particular a transport/RPC *error* is not a duplicate. Reading a failed RPC
 * as "already processed" (which happens whenever the `error` field is dropped
 * on the floor and only `data` is checked) silently discards live events
 * during any Supabase hiccup, because the handler answers Stripe `200`.
 *
 * @param {object} supabase        Supabase client with `.rpc()`.
 * @param {object} args
 * @param {string} args.eventId    Stripe event id (`evt_...`), the dedupe key.
 * @param {string} args.type       Label stored alongside the claim. Callers
 *                                 handling more than one Stripe endpoint
 *                                 prefix it (e.g. `connect:`) so the two
 *                                 endpoints stay distinguishable in the table.
 * @returns {Promise<{claimed: boolean, duplicate: boolean, claimId: string|null}>}
 * @throws {Error} If the RPC itself fails. Callers should surface this as a
 *                 5xx so Stripe retries the delivery.
 */
async function claimWebhookEvent(supabase, { eventId, type }) {
  const { data, error } = await supabase.rpc('claim_webhook_event', {
    p_event_id: eventId,
    p_type: type,
  });

  if (error) {
    const message = error.message || String(error);
    throw new Error(`claim_webhook_event failed for ${eventId}: ${message}`);
  }

  if (!data) {
    return { claimed: false, duplicate: true, claimId: null };
  }

  return { claimed: true, duplicate: false, claimId: data };
}

/**
 * Mark a claim terminal after the event was handled successfully.
 *
 * Best-effort: a failure here leaves the row at `processing`, which still
 * suppresses duplicates, so it must never turn a successful delivery into a
 * 5xx. It is logged because a persistently failing update means claims are
 * accumulating in a non-terminal state.
 *
 * @param {object} supabase   Supabase client with `.from()`.
 * @param {string} claimId    Row id returned by {@link claimWebhookEvent}.
 * @param {object} [patch]    Extra columns to write alongside the status.
 * @returns {Promise<boolean>} Whether the row was updated.
 */
async function completeWebhookEvent(supabase, claimId, patch = {}) {
  if (!claimId) return false;

  try {
    const { error } = await supabase
      .from('webhook_events')
      .update({ status: STATUS_COMPLETED, ...patch })
      .eq('id', claimId);

    if (error) {
      console.error(
        `[webhook-idempotency] Could not mark claim ${claimId} completed: ${error.message}`
      );
      return false;
    }
    return true;
  } catch (err) {
    console.error(
      `[webhook-idempotency] Could not mark claim ${claimId} completed: ${err.message}`
    );
    return false;
  }
}

/**
 * Release a claim so Stripe's retry of the same event reprocesses it.
 *
 * Deletes the row rather than marking it failed: `claim_webhook_event` dedupes
 * on `ON CONFLICT (event_id) DO NOTHING`, so any surviving row -- whatever its
 * status -- keeps answering later retries with "duplicate". Removing the lease
 * is what makes the retry effective. The forensic record of what was processed
 * lives in the domain tables (`financial_ledger`, worker task rows), not in
 * this dedupe ledger.
 *
 * @param {object} supabase   Supabase client with `.from()`.
 * @param {string} claimId    Row id returned by {@link claimWebhookEvent}.
 * @param {string} [reason]   Why processing failed. Logged, not persisted.
 * @returns {Promise<boolean>} Whether the claim was released. `false` means
 *                             the event is now stuck and will be answered as a
 *                             duplicate on retry -- always worth alerting on.
 */
async function releaseWebhookEvent(supabase, claimId, reason = 'processing failed') {
  if (!claimId) return false;

  try {
    const { error } = await supabase.from('webhook_events').delete().eq('id', claimId);

    if (error) {
      console.error(
        `[webhook-idempotency] STUCK CLAIM ${claimId} (${reason}): release failed: ${error.message}. ` +
          'Stripe retries of this event will be answered as duplicates until the row is removed.'
      );
      return false;
    }

    console.warn(
      `[webhook-idempotency] Released claim ${claimId} (${reason}) -- Stripe retry will reprocess.`
    );
    return true;
  } catch (err) {
    console.error(
      `[webhook-idempotency] STUCK CLAIM ${claimId} (${reason}): release threw: ${err.message}. ` +
        'Stripe retries of this event will be answered as duplicates until the row is removed.'
    );
    return false;
  }
}

module.exports = {
  claimWebhookEvent,
  completeWebhookEvent,
  releaseWebhookEvent,
  STATUS_PROCESSING,
  STATUS_COMPLETED,
};
