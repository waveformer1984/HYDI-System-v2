'use strict';

/**
 * Payment signal bridge — the governed path from "someone saw money" to
 * either durable attribution or an exact Human Action.
 *
 *   recordSignal   — persist + classify a claim; creates a
 *                    VERIFY_EXTERNAL_PAYMENT Human Action whenever the
 *                    remaining boundary needs a human.
 *   reconcileSignal — re-run the internal checks for one stored signal
 *                    (called when new evidence may exist: a webhook just
 *                    landed, a disposition added ids). Terminal
 *                    attributions resolve the signal; the linked action
 *                    then verifies on its next sweep.
 *   reconcileOpenSignals — the sweep for ticks and post-webhook hooks.
 *   recordDisposition — the governed human write: external_not_found /
 *                    external_confirmed / belongs_to_other. Never creates
 *                    revenue — it only closes the verification loop.
 *
 * Human Action completion is never "clicked done": the action's verifier
 * (payment-signal-resolved) independently reads the signal record — and,
 * when the credential can reach it, re-fetches the provider object.
 */

const { upsertSignal, getSignal, listSignals, updateSignal } = require('./payment-signal-store');
const { getStripeMode } = require('./stripe-mode');

let _Reconciler = null;
let _loadError = null;

async function ensureReconciler() {
  if (_Reconciler) return _Reconciler;
  if (_loadError) throw _loadError;
  try {
    // Dynamic import handles webpack/tsx ESM boundaries — same convention
    // as JobWebhookBridge loading JobManager.ts.
    const mod = await import('./PaymentSignalReconciler.ts');
    _Reconciler = mod.PaymentSignalReconciler;
    return _Reconciler;
  } catch (e) {
    _loadError = e;
    throw new Error(`payment-signal-bridge cannot load PaymentSignalReconciler: ${e instanceof Error ? e.message : e}`);
  }
}

/** Build a Stripe client honoring the live-key opt-in guard. */
function buildStripeClient() {
  const mode = getStripeMode();
  if (mode.mode !== 'test' && mode.mode !== 'live') return null;
  try {
    const Stripe = require('stripe');
    return new Stripe(process.env.STRIPE_SECRET_KEY);
  } catch {
    return null;
  }
}

async function buildReconcilerDeps(overrides = {}) {
  let db = overrides.db;
  if (db === undefined) {
    try {
      const { getRevenueDatabase } = await import('./RevenueDatabase.ts');
      db = getRevenueDatabase();
    } catch { db = null; }
  }
  let catalog = overrides.catalog;
  if (catalog === undefined) {
    try {
      const { getOfferCatalog } = require('./OfferCatalog');
      catalog = getOfferCatalog();
    } catch { catalog = null; }
  }
  const stripeMode = overrides.stripeMode || getStripeMode();
  const stripe = overrides.stripe !== undefined ? overrides.stripe : buildStripeClient();
  let providerAccount = overrides.providerAccount;
  if (providerAccount === undefined && stripe && stripe.accounts) {
    providerAccount = await stripe.accounts.retrieve().then((a) => a.id).catch(() => null);
  }
  return { db, stripe, stripeMode, catalog, providerAccount: providerAccount || null };
}

function instructionsFor(verdict, signal) {
  const amt = `${(signal.amountCents / 100).toFixed(2)} ${String(signal.currency).toUpperCase()}`;
  if (verdict.classification === 'UNMATCHED_EXTERNAL_PAYMENT') {
    return [
      `The provider confirms a payment of ${amt} exists (${signal.providerObjectId}) but NO ProtoForge record matches it.`,
      'Determine what this payment was for in the Stripe Dashboard (customer, description, order reference).',
      'If it belongs to ProtoForge or another known stream: submit a disposition via POST /api/revenue/payment-signals with { signalId, disposition: "external_confirmed", providerObjectId, customerReference }.',
      'If it is foreign/spurious: submit { signalId, disposition: "belongs_to_other", note } so the record closes honestly.',
      'HYDI re-reconciles automatically after the disposition — no manual revenue steps exist or are permitted.',
    ];
  }
  return [
    `A payment notification for ${amt} was observed but cannot be verified: no internal record and no provider object is inspectable with the configured (${getStripeMode().mode}) credential.`,
    'Open the Stripe Dashboard → Payments and switch to LIVE mode.',
    `Search for a payment of ${amt}${signal.providerObjectId ? ` (${signal.providerObjectId})` : ''} around ${signal.observedAt}.`,
    'If found: capture the payment intent / charge id and customer reference, then submit via POST /api/revenue/payment-signals { signalId, disposition: "external_confirmed", providerObjectId, customerReference }.',
    'If no such payment exists: submit { signalId, disposition: "external_not_found" } — the notification was not a real transaction.',
    'HYDI independently re-checks the provider object (when reachable) and internal records after your submission.',
  ];
}

function needsHumanAction(classification) {
  return classification === 'UNMATCHED_EXTERNAL_PAYMENT'
    || classification === 'UNVERIFIED_NOTIFICATION'
    || classification === 'EXTERNAL_VERIFICATION_REQUIRED';
}

/**
 * Persist + classify a payment signal. deps:
 *   { service?, reconcilerDeps? } — service: HumanActionService.
 */
async function recordSignal(input, deps = {}) {
  if (!input || typeof input.amountCents !== 'number' || !input.currency) {
    throw new Error('signal requires amountCents (integer cents) and currency');
  }
  if (input.amountCents <= 0 && !input.providerObjectId) {
    throw new Error('signal requires a positive amountCents — or 0 with a providerObjectId (provider truth supplies the amount)');
  }
  const signal = {
    provider: input.provider || 'stripe',
    providerAccount: input.providerAccount || null,
    mode: input.mode || 'unknown',
    amountCents: input.amountCents,
    currency: String(input.currency).toLowerCase(),
    providerObjectId: input.providerObjectId || null,
    eventId: input.eventId || null,
    observedAt: input.observedAt || new Date().toISOString(),
    source: input.source || 'manual_report',
    reference: input.reference || null,
  };

  const Reconciler = await ensureReconciler();
  const rDeps = await buildReconcilerDeps(deps.reconcilerDeps || {});
  const verdict = await new Reconciler(rDeps).classify(signal);

  const { record, created } = upsertSignal({ signal, verdict });

  // A signal that needs a human gets one durable, deduped action.
  if (needsHumanAction(verdict.classification) && !record.humanActionId) {
    const svc = deps.service || new (require('../human-actions/service').HumanActionService)({});
    const amt = `${(signal.amountCents / 100).toFixed(2)} ${signal.currency.toUpperCase()}`;
    const { action } = svc.request({
      blockerKey: `payment-signal:${record.id}`,
      type: 'VERIFY_EXTERNAL_PAYMENT',
      title: `Verify external payment — ${amt} (${verdict.classification})`,
      description: verdict.summary,
      instructions: instructionsFor(verdict, signal),
      verifier: { name: 'payment-signal-resolved', spec: { signalId: record.id } },
      source: 'payment-reconciler',
      priority: verdict.classification === 'UNMATCHED_EXTERNAL_PAYMENT' ? 'high' : 'normal',
      context: {
        signalId: record.id,
        classification: verdict.classification,
        amountCents: signal.amountCents,
        currency: signal.currency,
        providerObjectId: signal.providerObjectId,
        providerMode: signal.mode,
        protoforgeAttribution: verdict.protoforgeAttribution,
      },
    });
    updateSignal(record.id, (rec) => {
      rec.humanActionId = action.id;
      rec.history.push({ at: new Date().toISOString(), type: 'HUMAN_ACTION_CREATED', actionId: action.id });
    });
    record.humanActionId = action.id;
  }

  return { record: getSignal(record.id), created, verdict };
}

/**
 * Re-run the internal checks for a stored signal. Called when new
 * evidence may exist — a webhook landed, a disposition added ids.
 * Terminal attributions resolve the signal durably.
 */
async function reconcileSignal(id, deps = {}) {
  const rec = getSignal(id);
  if (!rec) throw new Error(`payment signal ${id} not found`);
  if (rec.status === 'resolved') return { record: rec, resolved: true, unchanged: true };

  const Reconciler = await ensureReconciler();
  const rDeps = await buildReconcilerDeps(deps.reconcilerDeps || {});
  const verdict = await new Reconciler(rDeps).classify(rec.signal);

  const updated = updateSignal(id, (r) => {
    r.verdict = verdict;
    r.history.push({ at: new Date().toISOString(), type: 'RECONCILED', classification: verdict.classification });
    if (Reconciler.terminalAttribution(verdict.classification)) {
      r.status = 'resolved';
      r.disposition = r.disposition || { type: 'auto_reconciled', actor: 'system', at: new Date().toISOString() };
      r.history.push({ at: new Date().toISOString(), type: 'RESOLVED', via: 'auto_reconcile' });
    }
  });
  return { record: updated, resolved: updated.status === 'resolved', verdict };
}

/** Sweep all open signals — for the tick and post-webhook hooks. */
async function reconcileOpenSignals(deps = {}) {
  const open = listSignals({ status: 'open' });
  const results = [];
  for (const s of open) {
    try {
      results.push(await reconcileSignal(s.id, deps));
    } catch (e) {
      results.push({ record: s, resolved: false, error: e instanceof Error ? e.message : 'error' });
    }
  }
  return { checked: open.length, resolved: results.filter((r) => r.resolved).length, results };
}

/**
 * The governed human write. disposition:
 *   'external_not_found'  — human checked the provider; no such payment
 *   'external_confirmed'  — payment exists; human captured ids
 *   'belongs_to_other'    — real payment, not ProtoForge's
 * Captured ids enrich the signal, then re-classification runs — a webhook
 * that arrived in the meantime can auto-attribute it.
 */
async function recordDisposition(id, input, deps = {}) {
  const valid = ['external_not_found', 'external_confirmed', 'belongs_to_other'];
  if (!valid.includes(input?.disposition)) {
    throw new Error(`disposition must be one of: ${valid.join(', ')}`);
  }
  updateSignal(id, (rec) => {
    rec.disposition = {
      type: input.disposition,
      actor: input.actor || 'operator',
      at: new Date().toISOString(),
      providerObjectId: input.providerObjectId || null,
      customerReference: input.customerReference || null,
      note: input.note || null,
    };
    if (input.providerObjectId) rec.signal.providerObjectId = input.providerObjectId;
    rec.history.push({ at: new Date().toISOString(), type: 'DISPOSITION', disposition: input.disposition, actor: input.actor || 'operator' });
    if (input.disposition === 'external_not_found' || input.disposition === 'belongs_to_other') {
      rec.status = 'resolved';
      rec.history.push({ at: new Date().toISOString(), type: 'RESOLVED', via: input.disposition });
    }
  });
  // external_confirmed may now be attributable — re-run the checks.
  if (input.disposition === 'external_confirmed') {
    const r = await reconcileSignal(id, deps);
    // Still unmatched after re-check: the signal stays open as durable
    // evidence of unattributed external money; the Human Action verifier
    // sees the recorded disposition and can close the verification loop.
    if (!r.resolved) {
      updateSignal(id, (rec) => {
        rec.status = 'resolved';
        rec.history.push({ at: new Date().toISOString(), type: 'RESOLVED', via: 'external_confirmed_unmatched' });
      });
    }
    return r;
  }
  return { record: getSignal(id), resolved: true };
}

module.exports = {
  recordSignal,
  reconcileSignal,
  reconcileOpenSignals,
  recordDisposition,
  getSignal,
  listSignals,
  buildStripeClient,
};
