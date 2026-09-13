/**
 * Stripe Mode Detection Utility
 *
 * Provides a single, authoritative way to determine whether the system
 * is operating in test mode, live mode, or disabled.
 *
 * Live mode requires:
 *   1. A live Stripe key (sk_live_ or rk_live_)
 *   2. ALLOW_LIVE_STRIPE=true in the environment
 *
 * This utility never exposes the secret key itself.
 */

export type StripeMode = 'disabled' | 'test' | 'live';

export interface StripeModeInfo {
  mode: StripeMode;
  keyPrefix: string;     // e.g. 'sk_test_', 'sk_live_', 'none'
  liveAllowed: boolean;  // whether ALLOW_LIVE_STRIPE=true
  configured: boolean;   // whether STRIPE_SECRET_KEY is set
  webhookConfigured: boolean;
}

export function getStripeMode(): StripeModeInfo {
  const key = process.env.STRIPE_SECRET_KEY;
  const liveAllowed = process.env.ALLOW_LIVE_STRIPE === 'true';
  const webhookConfigured = !!(process.env.STRIPE_WEBHOOK_SECRET_01 || process.env.STRIPE_WEBHOOK_SECRET);

  if (!key) {
    return {
      mode: 'disabled',
      keyPrefix: 'none',
      liveAllowed,
      configured: false,
      webhookConfigured,
    };
  }

  const isLiveKey = key.startsWith('sk_live_') || key.startsWith('rk_live_');
  const isTestKey = key.startsWith('sk_test_') || key.startsWith('rk_test_');

  if (isLiveKey && !liveAllowed) {
    // Live key present but not authorized — system refuses to use it
    return {
      mode: 'disabled',
      keyPrefix: key.slice(0, 8),
      liveAllowed: false,
      configured: true,
      webhookConfigured,
    };
  }

  return {
    mode: isLiveKey ? 'live' : isTestKey ? 'test' : 'live',
    keyPrefix: key.slice(0, 8),
    liveAllowed,
    configured: true,
    webhookConfigured,
  };
}

/**
 * Returns true if the system is authorized to process live Stripe transactions.
 * This is a hard gate — no live transaction may proceed without this returning true.
 */
export function isLiveModeAuthorized(): boolean {
  const info = getStripeMode();
  return info.mode === 'live' && info.liveAllowed;
}

// ---------------------------------------------------------------------------
// Per-record mode detection
//
// The system-level mode (above) tells you what key is configured. But each
// individual record also carries a permanent test/live marker in its IDs:
//
//   - Checkout session IDs:  cs_test_*  (test)  vs  cs_live_*  (live)
//   - Payment intent IDs:    pi_*       (both modes — check the checkout session)
//   - Stripe event IDs:      evt_test_* is a synthetic test event;
//                            evt_<real Stripe ID> is a real Stripe event.
//                            Real Stripe events generated against a test key
//                            (sk_test_) are test-mode events. The only way to
//                            know that from the event ID alone is that real
//                            Stripe event IDs have a distinctive base64-like
//                            suffix (e.g. evt_3U8YLcITaXOHazrh1XQMmQ0I) while
//                            synthetic test events use evt_test_ prefix.
//
// For operational detectors (RevenueReconciliation, FailedWebhook), the key
// question is: "was this record created by a test/qualification run, or by a
// real customer transaction?" The per-record checks below answer that.
// ---------------------------------------------------------------------------

/**
 * Returns true if a Stripe checkout session ID is a test-mode session.
 * Stripe checkout session IDs start with `cs_test_` (test) or `cs_live_` (live).
 * A null/empty ID is treated as test-mode (defensive — real live transactions
 * always have a cs_live_ ID).
 */
export function isTestCheckoutSession(checkoutSessionId: string | null | undefined): boolean {
  if (!checkoutSessionId) return true; // defensive: no checkout = not a real live transaction
  return checkoutSessionId.startsWith('cs_test_');
}

/**
 * Returns true if a Stripe event ID is a synthetic test event.
 * Synthetic test events created by qualification scripts use the `evt_test_`
 * prefix. Real Stripe events use `evt_` followed by a base64-like ID.
 *
 * Note: real Stripe events generated against a sk_test_ key are also test-mode
 * events, but they cannot be distinguished from live events by event ID alone.
 * The caller should additionally check the checkout session ID or the system
 * mode if it matters to distinguish "real Stripe test-mode event" from
 * "real Stripe live-mode event". For operational detector purposes, the
 * evt_test_ prefix is sufficient — real Stripe test-mode events would only
 * appear in this database if a qualification script triggered them, which
 * means they're test data regardless.
 */
export function isSyntheticTestEvent(eventId: string | null | undefined): boolean {
  if (!eventId) return true; // defensive
  return eventId.startsWith('evt_test_');
}

/**
 * Returns true if a record is test-mode based on its checkout session ID
 * OR its event ID. This is the combined check for operational detectors.
 *
 * If the checkout session ID is available and starts with cs_test_, the
 * record is test-mode. If the event ID starts with evt_test_, the record
 * is test-mode. If neither is available, the record is treated as test-mode
 * (defensive — real live records always have identifiable live IDs).
 */
export function isTestRecord(options: {
  checkoutSessionId?: string | null;
  eventId?: string | null;
}): boolean {
  if (options.checkoutSessionId !== undefined) {
    return isTestCheckoutSession(options.checkoutSessionId);
  }
  if (options.eventId !== undefined) {
    return isSyntheticTestEvent(options.eventId);
  }
  return true; // defensive: no identifiers = treat as test
}
