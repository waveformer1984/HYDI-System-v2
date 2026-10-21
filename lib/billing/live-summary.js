'use strict';

/**
 * Livemode-only revenue summary from verified, processed billing webhooks.
 * Read-only: one findMany, no writes, no provider calls. Test-mode rows are
 * dropped twice (query filter and row check) so a store that ignores the
 * where clause still cannot leak test money into the total.
 */

const EVENT_LIMIT = 5000;

function amountFor(event) {
  const obj = event && event.data && event.data.object ? event.data.object : {};
  const type = event && event.type;
  if (type === 'invoice.paid' && Number.isInteger(obj.amount_paid)) {
    return { kind: 'paid', cents: obj.amount_paid, currency: obj.currency };
  }
  if (type === 'checkout.session.completed' && obj.payment_status === 'paid' && obj.mode !== 'subscription' && Number.isInteger(obj.amount_total)) {
    return { kind: 'paid', cents: obj.amount_total, currency: obj.currency };
  }
  if (type === 'charge.refunded' && Number.isInteger(obj.amount_refunded)) {
    return { kind: 'refunded', cents: obj.amount_refunded, currency: obj.currency };
  }
  return null;
}

async function liveRevenueSummary(store, { now = () => new Date() } = {}) {
  const rows = await store.findMany(
    'billing_webhook_events',
    { livemode: true, status: 'processed' },
    { orderBy: ['received_at', 'desc'], limit: EVENT_LIMIT },
  );
  const totals = {};
  let counted = 0;
  let lastAt = null;
  for (const row of rows) {
    if (!row || row.livemode !== true || row.status !== 'processed') continue;
    const amount = amountFor(row.payload);
    if (!amount) continue;
    const currency = String(amount.currency || 'unknown').toLowerCase();
    const bucket = totals[currency] || (totals[currency] = { paid_cents: 0, refunded_cents: 0, net_cents: 0, events: 0 });
    if (amount.kind === 'paid') bucket.paid_cents += amount.cents;
    else bucket.refunded_cents += amount.cents;
    bucket.net_cents = bucket.paid_cents - bucket.refunded_cents;
    bucket.events += 1;
    counted += 1;
    const at = row.received_at ? new Date(row.received_at).toISOString() : null;
    if (at && (!lastAt || at > lastAt)) lastAt = at;
  }
  return {
    livemode_only: true,
    source: 'billing_webhook_events (livemode=true, status=processed)',
    events_counted: counted,
    truncated: rows.length >= EVENT_LIMIT,
    totals,
    last_live_event_at: lastAt,
    generated_at: now().toISOString(),
  };
}

function formatLiveSummary(summary) {
  const currencies = Object.keys(summary.totals || {});
  if (!currencies.length) {
    return `Live revenue: no livemode payments recorded (source: ${summary.source}, read ${summary.generated_at}).`;
  }
  const lines = currencies.map((c) => {
    const t = summary.totals[c];
    const money = (cents) => (cents / 100).toFixed(2);
    return `  ${c.toUpperCase()}: paid ${money(t.paid_cents)}, refunded ${money(t.refunded_cents)}, net ${money(t.net_cents)} (${t.events} events)`;
  });
  return [
    `Live revenue (livemode only, ${summary.events_counted} events${summary.truncated ? ', truncated' : ''}):`,
    ...lines,
    `Last live event: ${summary.last_live_event_at || 'none'}. Read ${summary.generated_at}.`,
  ].join('\n');
}

module.exports = { liveRevenueSummary, formatLiveSummary, amountFor };
