'use strict';

/**
 * Commercial decision store — the durable record of human pricing/offer
 * authority.
 *
 * Heidi proposes commercial terms (a commercial review Human Action);
 * the human decides via POST /api/commercial/decisions; the decision is
 * appended here; only then does an approved offer materialize into the
 * OfferCatalog overlay. Pricing never goes silent — every offer in the
 * catalog overlay traces to a recorded decision in this file.
 *
 * Durable file: .hydi-operational/commercial-decisions.json
 *   { decisions: { offerId: latest }, history: [ every decision, appended ] }
 *
 * Env override for tests: HYDI_COMMERCIAL_DECISIONS_PATH.
 */

const fs = require('fs');
const path = require('path');

function decisionPath() {
  return process.env.HYDI_COMMERCIAL_DECISIONS_PATH
    || path.join(process.cwd(), '.hydi-operational', 'commercial-decisions.json');
}

function readStore(p = decisionPath()) {
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      decisions: parsed.decisions && typeof parsed.decisions === 'object' ? parsed.decisions : {},
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return { decisions: {}, history: [] };
  }
}

/**
 * Record a human commercial decision. Append-only history; `decisions`
 * holds the latest per offerId. decision: 'approved' | 'rejected'.
 * priceCents, when present on an approval, overrides the proposal's
 * recommendation — the human's approved number is authoritative.
 */
function recordDecision({ offerId, decision, approvedBy, priceCents = null, notes = null }) {
  if (!offerId) throw new Error('offerId required');
  if (!['approved', 'rejected'].includes(decision)) throw new Error(`invalid decision: ${decision}`);
  const p = decisionPath();
  const store = readStore(p);
  const entry = {
    offerId,
    decision,
    approvedBy: approvedBy || 'operator',
    priceCents: Number.isInteger(priceCents) ? priceCents : null,
    notes,
    decidedAt: new Date().toISOString(),
  };
  store.decisions[offerId] = entry;
  store.history.push(entry);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(store, null, 2) + '\n');
  return entry;
}

/** Latest recorded decision for an offerId, or null. */
function getDecision(offerId, p = decisionPath()) {
  return readStore(p).decisions[offerId] || null;
}

module.exports = { decisionPath, recordDecision, getDecision, readStore };
