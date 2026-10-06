'use strict';

/**
 * Deterministic payment answers — "did we get paid", "what's this
 * payment", "unreconciled payments" are answered from durable evidence,
 * never from an LLM.
 *
 * "what's this $X payment" goes further: the question itself is an
 * observed signal — it is recorded durably, classified against Stripe +
 * internal records, and gets a Human Action when the boundary needs one.
 * The answer reports the verdict. It never manufactures revenue.
 */

const { getStripeMode } = require('./stripe-mode');

const PAID_PATTERNS = [
  /\bdid (?:we|i) get paid\b/i,
  /\bhave (?:we|i) (?:been )?paid\b/i,
  /\bany (?:payments?|revenue) (?:come|came|received|land)/i,
  /\bwhat (?:revenue|payments?) (?:did we|have we)\b/i,
  /\bhow much (?:revenue|money) (?:did|have)\b/i,
];

const SIGNAL_PATTERNS = [
  /\bunreconciled payments?\b/i,
  /\bunmatched payments?\b/i,
  /\bpayment signals?\b/i,
  /\bpayments? (?:that )?(?:need|awaiting|pending) (?:verification|reconciliation)\b/i,
  /\bwhat payments? (?:are )?(?:blocking|pending)\b/i,
  /\bis (?:this|that|it) (?:payment|charge|purchase|revenue|transaction) (?:ours|real|legit|from us)\b/i,
];

// "what's this payment", "what is this $9.99 charge", "did we get $49"
const LOOKUP_PATTERN = /\b(?:what'?s|what is|explain|about|did we get)\s+(?:this|that|the)?\s*(?:new\s+)?\$?(\d+(?:\.\d{1,2})?)?\s*(?:payment|charge|purchase|transaction|stripe (?:payment|notification|charge))\b/i;
const PROVIDER_ID_PATTERN = /\b((?:pi|ch|cs|evt)_(?:test|live)_?[A-Za-z0-9]{8,})\b/;

function looksLikePaymentQuestion(message) {
  return PAID_PATTERNS.some((p) => p.test(message))
    || SIGNAL_PATTERNS.some((p) => p.test(message))
    || LOOKUP_PATTERN.test(message);
}

function money(cents, currency) {
  return `$${(cents / 100).toFixed(2)} ${String(currency || 'usd').toUpperCase()}`;
}

function fmtEvidence(v) {
  const im = v.internalMatch || {};
  const lines = [
    `ProtoForge attribution: ${v.protoforgeAttribution}`,
    `Internal job: ${im.job ? `MATCHED (${im.job})` : 'NONE'}`,
    `Webhook event: ${im.webhookEvent ? `MATCHED (${im.webhookEvent})` : 'NONE'}`,
    `Ledger entry: ${im.ledgerEntry ? `MATCHED (${im.ledgerEntry})` : 'NONE'}`,
    `Provider object: ${v.providerObjectId || 'none supplied'} — mode ${v.mode}`,
    `Offer match: ${v.offerMatch.length ? `${v.offerMatch.join(', ')} (price coincidence only — NOT attribution)` : 'NONE'}`,
    `Classification: ${v.classification} (confidence ${Math.round(v.confidence * 100)}%)`,
  ];
  return lines.join('\n');
}

function signalLine(s) {
  const v = s.verdict;
  return `• ${money(s.signal.amountCents, s.signal.currency)} — ${v.classification} (confidence ${Math.round(v.confidence * 100)}%)` +
    `\n  signal ${s.id} · status ${s.status}${s.humanActionId ? ` · action ${s.humanActionId}` : ''}` +
    `\n  ${v.summary}`;
}

/**
 * Returns { text } for payment questions, else null.
 * opts: { service?, reconcilerDeps?, listSignals?, ledger? }
 */
async function tryPaymentAnswer(message, opts = {}) {
  const m = message || '';
  const isPaidQ = PAID_PATTERNS.some((p) => p.test(m));
  const isSignalQ = SIGNAL_PATTERNS.some((p) => p.test(m));
  const isLookupQ = LOOKUP_PATTERN.test(m);
  if (!isPaidQ && !isSignalQ && !isLookupQ) return null;

  const bridge = opts.bridge || require('./payment-signal-bridge');
  const mode = getStripeMode();

  // --- "did we get paid" — verified ledger summary, mode-separated -----
  if (isPaidQ && !isLookupQ) {
    const open = bridge.listSignals({ status: 'open' });
    let entries = [];
    try {
      const ledger = opts.ledger || new (await import('./RevenueLedger.ts')).RevenueLedger();
      entries = await ledger.getVerifiedRevenue(10);
    } catch (e) {
      return { text: `Could not read the revenue ledger (${e instanceof Error ? e.message : 'error'}) — no revenue claim can be made either way.` };
    }
    const stripeMode = mode.mode;
    const lines = [`Verified revenue entries (from the durable ledger — provider-verified events only):`];
    if (!entries.length) {
      lines.push('  NONE — no verified revenue events are recorded.');
    } else {
      for (const e of entries) {
        lines.push(`  ${money(e.amountGross, e.currency)} — ${e.eventType} · ${e.offerId || 'no offer'} · event ${e.stripeEventId} · ${String(e.recordedAt).slice(0, 10)}`);
      }
      lines.push(`  (configured Stripe mode: ${stripeMode} — entries recorded under this key are ${stripeMode}-mode revenue)`);
    }
    if (open.length) {
      lines.push(``, `⚠ ${open.length} unreconciled payment signal(s) still need verification:`);
      for (const s of open) lines.push(`  ${signalLine(s)}`);
    }
    return { text: lines.join('\n') };
  }

  // --- "unreconciled payments / is this ours" — open signal report -----
  if (isSignalQ) {
    const open = bridge.listSignals({ status: 'open' });
    if (!open.length) {
      return { text: 'No unreconciled payment signals. Every observed payment claim is either attributed or never existed as a signal.' };
    }
    const lines = [`${open.length} unreconciled payment signal(s):`, ''];
    for (const s of open) lines.push(signalLine(s), '');
    lines.push('No revenue is recognized from any of these until reconciliation completes.');
    return { text: lines.join('\n') };
  }

  // --- "what's this $X payment" — observe → classify → answer ----------
  const amountMatch = m.match(/\$\s*(\d+(?:\.\d{1,2})?)/) || m.match(/\b(\d+\.\d{2})\b/);
  const idMatch = m.match(PROVIDER_ID_PATTERN);
  if (!amountMatch && !idMatch) {
    return { text: 'To check a payment I need an amount ($9.99) or a Stripe object id (pi_…, ch_…, cs_…, evt_…).' };
  }

  const { record, verdict } = await bridge.recordSignal({
    amountCents: amountMatch ? Math.round(parseFloat(amountMatch[1]) * 100) : 0,
    currency: (m.match(/\b(usd|eur|gbp|cad|aud)\b/i) || [])[1] || 'usd',
    providerObjectId: idMatch ? idMatch[1] : null,
    observedAt: new Date().toISOString(),
    source: 'chat_report',
    mode: 'unknown',
  }, opts).catch((e) => ({ record: null, verdict: null, error: e }));

  if (!verdict) {
    return { text: 'Payment signal could not be evaluated — store error. Nothing was recorded.' };
  }

  const lines = [
    `Payment signal: ${money(verdict.amount, verdict.currency)}`,
    '',
    fmtEvidence(verdict),
    '',
    `Status: ${verdict.summary}`,
    '',
    'No revenue was recognized from this signal.',
  ];
  if (record.humanActionId) {
    lines.push(`Human Action: ${record.humanActionId} — verification instructions included; HYDI re-checks automatically after completion.`);
  }
  return { text: lines.join('\n') };
}

module.exports = { tryPaymentAnswer, looksLikePaymentQuestion };
