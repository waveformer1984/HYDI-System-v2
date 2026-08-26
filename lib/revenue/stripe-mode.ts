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
