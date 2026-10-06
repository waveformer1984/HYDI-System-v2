'use strict';

/**
 * Payment signal store — the durable record of observed external payment
 * claims (notifications, manual reports, unmatched provider objects).
 *
 * A signal is NOT revenue. It is a claim awaiting reconciliation. Revenue
 * enters only through a verified webhook → RevenueLedger; this store can
 * never mint it. Signals persist across restarts so a half-investigated
 * payment claim is never silently lost.
 *
 * Durable file: .hydi-operational/payment-signals.json
 *   { signals: { id: record }, order: [ids newest-first] }
 *
 * record shape:
 *   { id, signal, verdict, status: 'open'|'resolved',
 *     disposition: null | { type, actor, at, providerObjectId?,
 *                           customerReference?, note? },
 *     humanActionId, observedAt, updatedAt, history: [] }
 *
 * Env override for tests: HYDI_PAYMENT_SIGNALS_PATH.
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function signalsPath() {
  return process.env.HYDI_PAYMENT_SIGNALS_PATH
    || path.join(process.cwd(), '.hydi-operational', 'payment-signals.json');
}

function readStore(p = signalsPath()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      signals: parsed.signals && typeof parsed.signals === 'object' ? parsed.signals : {},
      order: Array.isArray(parsed.order) ? parsed.order : [],
    };
  } catch {
    return { signals: {}, order: [] };
  }
}

function writeStore(store, p = signalsPath()) {
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store, null, 2) + '\n');
}

/**
 * Insert or refresh a signal record. Dedupe identity:
 *   1. same providerObjectId, else
 *   2. same eventId, else
 *   3. same amount+currency+source within a 24h observation window
 * An existing OPEN record is returned updated, never duplicated.
 */
function upsertSignal({ signal, verdict }, p = signalsPath()) {
  const store = readStore(p);
  const t = new Date().toISOString();
  const existing = Object.values(store.signals).find((s) => {
    if (s.status !== 'open') return false;
    if (signal.providerObjectId && s.signal.providerObjectId === signal.providerObjectId) return true;
    if (signal.eventId && s.signal.eventId === signal.eventId) return true;
    return s.signal.amountCents === signal.amountCents
      && String(s.signal.currency).toLowerCase() === String(signal.currency).toLowerCase()
      && s.signal.source === signal.source
      && Math.abs(Date.parse(s.signal.observedAt) - Date.parse(signal.observedAt)) < 24 * 3600 * 1000;
  });
  if (existing) {
    existing.verdict = verdict;
    existing.updatedAt = t;
    existing.history.push({ at: t, type: 'RECLASSIFIED', classification: verdict.classification });
    writeStore(store, p);
    return { record: existing, created: false };
  }
  const record = {
    id: 'psig_' + crypto.randomBytes(8).toString('hex'),
    signal,
    verdict,
    status: 'open',
    disposition: null,
    humanActionId: null,
    observedAt: signal.observedAt,
    updatedAt: t,
    history: [{ at: t, type: 'OBSERVED', classification: verdict.classification }],
  };
  store.signals[record.id] = record;
  store.order.unshift(record.id);
  writeStore(store, p);
  return { record, created: true };
}

function getSignal(id, p = signalsPath()) {
  return readStore(p).signals[id] || null;
}

function listSignals({ status, includeTerminal } = {}, p = signalsPath()) {
  const store = readStore(p);
  return store.order
    .map((id) => store.signals[id])
    .filter(Boolean)
    .filter((s) => (status ? s.status === status : includeTerminal ? true : s.status === 'open'));
}

function updateSignal(id, mutate, p = signalsPath()) {
  const store = readStore(p);
  const rec = store.signals[id];
  if (!rec) throw new Error(`payment signal ${id} not found`);
  mutate(rec);
  rec.updatedAt = new Date().toISOString();
  writeStore(store, p);
  return rec;
}

module.exports = { signalsPath, readStore, upsertSignal, getSignal, listSignals, updateSignal };
