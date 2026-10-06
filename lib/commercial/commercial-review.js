'use strict';

/**
 * Commercial review — turns "technically ready, needs a price" into a
 * decision-ready Commercial Action.
 *
 * Governed chain (no silent pricing):
 *
 *   manifest.commercial  — the app's declared commercial intent
 *          ↓
 *   buildProposal()      — proposal enriched with VERIFIED capability state
 *          ↓
 *   Human Action         — approve / reject / modify, evidence attached
 *          ↓
 *   recordDecision()     — POST /api/commercial/decisions (human authority)
 *          ↓
 *   materializeApprovedOffer() — approved → CommercialOffer persisted to
 *          the OfferCatalog overlay; downstream becomes autonomous
 *
 * The realization revenue stage calls materializeApprovedOffer() before
 * deciding to park — an approval made while parked resolves itself on the
 * next pass, and `offer-exists` remains the only truth the stage trusts.
 */

const { getDecision } = require('./decision-store');

/** The proposal a human is asked to decide on — evidence, not vibes. */
function buildProposal(app) {
  const c = app.manifest.commercial || {};
  const r = app.manifest.realization || {};
  return {
    service: app.appId,
    name: app.manifest.name || app.appId,
    version: app.manifest.version || null,
    offerId: r.offerId || c.offerId || null,
    offerName: c.offerName || `${app.manifest.name || app.appId} — initial offer`,
    customerProblem: c.customerProblem || 'not declared in manifest.commercial',
    deliverable: c.deliverable || 'not declared in manifest.commercial',
    targetCustomer: c.targetCustomer || 'not declared in manifest.commercial',
    verifiedCapabilities: app.manifest.capabilities || [],
    currentCapability: {
      hostedBy: r.hosted || null,
      servicePort: r.servicePort || null,
      engineProbes: [r.engineHealthUrl, r.engineProbe?.url].filter(Boolean),
      note: 'capability state is only what realization stages verified — see goal evidence',
    },
    fulfillment: c.fulfillment || null,
    unitEconomics: c.unitEconomics || 'not estimated — fulfillment effort unmeasured',
    marketEvidence: c.marketEvidence || 'none recorded',
    recommendedPriceCents: Number.isInteger(c.recommendedPriceCents) ? c.recommendedPriceCents : null,
    priceBasis: c.priceBasis || 'no basis declared',
    confidencePct: Number.isInteger(c.confidencePct) ? c.confidencePct : null,
    revenuePath: c.revenuePath || 'offer → checkout → payment → job → fulfillment → delivery → reconcile',
  };
}

/**
 * The Human Action spec that carries the proposal. Verifier stays
 * `offer-exists` — the durable truth is the offer in the catalog, however
 * it got there. The action's job is to carry the decision to the human.
 */
function buildReviewActionSpec(app) {
  const r = app.manifest.realization || {};
  const p = buildProposal(app);
  const price = p.recommendedPriceCents != null ? `$${(p.recommendedPriceCents / 100).toFixed(2)}` : 'no recommendation — needs your number';
  const lines = [
    `SERVICE: ${p.name} (${p.service})`,
    `CUSTOMER PROBLEM: ${p.customerProblem}`,
    `DELIVERABLE: ${p.deliverable}`,
    `TARGET CUSTOMER: ${p.targetCustomer}`,
    `UNIT ECONOMICS: ${p.unitEconomics}`,
    `MARKET EVIDENCE: ${p.marketEvidence}`,
    `RECOMMENDED PRICE: ${price} (${p.recommendedPriceCents ?? '?'}¢)`,
    `PRICE BASIS: ${p.priceBasis}`,
    `CONFIDENCE: ${p.confidencePct != null ? p.confidencePct + '%' : 'unrated'}`,
    `REVENUE PATH: ${p.revenuePath}`,
  ];
  return {
    blockerKey: `app:${app.appId}:commercial`,
    supersedes: [`app:${app.appId}:offer`],
    type: 'authorization',
    title: `Approve commercial offer — ${p.offerName} (${price})`,
    description: `Commercial review for ${p.name}.\n\n${lines.join('\n')}\n\nDECISION: approve / reject / modify.`,
    priority: 'high',
    instructions: [
      ...lines,
      `To APPROVE at the recommended price: POST /api/commercial/decisions {offerId:"${p.offerId}", decision:"approved", approvedBy:"<you>"}`,
      `To APPROVE at a different price: include "priceCents":<your number> — your number wins.`,
      `To REJECT: POST /api/commercial/decisions {offerId:"${p.offerId}", decision:"rejected", approvedBy:"<you>", notes:"<reason>"}`,
      'On approval the offer materializes into the OfferCatalog overlay automatically — the realization mission then verifies offer-exists and completes on its own.',
    ],
    // The durable truth being proven is the offer in the catalog — the
    // recorded human approval is what materializes it on the next pass.
    verifier: { name: 'offer-exists', spec: { offerId: p.offerId } },
    resumePolicy: 'auto',
    context: { mission: 'app-realization', blocker: 'COMMERCIAL_APPROVAL', proposal: p },
  };
}

/**
 * If a recorded human approval exists for the app's declared offer,
 * persist the offer into the catalog overlay and return it — else null.
 * Called by the realization revenue stage before parking.
 */
async function materializeApprovedOffer(app, deps = {}) {
  const r = app.manifest.realization || {};
  const c = app.manifest.commercial || {};
  const offerId = r.offerId || c.offerId;
  if (!offerId) return null;
  const decision = deps.getDecision ? await deps.getDecision(offerId) : getDecision(offerId);
  if (!decision || decision.decision !== 'approved') return null;

  const catalog = deps.catalog || require('../revenue/OfferCatalog').getOfferCatalog();
  if (catalog.get(offerId)) return catalog.get(offerId); // already materialized

  const priceCents = Number.isInteger(decision.priceCents)
    ? decision.priceCents
    : (Number.isInteger(c.recommendedPriceCents) ? c.recommendedPriceCents : null);
  if (priceCents == null || priceCents <= 0) {
    throw new Error(`approved decision for '${offerId}' carries no price — record a decision with priceCents`);
  }

  const offer = {
    offerId,
    name: c.offerName || `${app.manifest.name || app.appId} — initial offer`,
    description: c.deliverable || `${app.manifest.name || app.appId} deliverable`,
    category: c.category || 'ursula_service',
    setupPrice: priceCents,
    recurringPrice: 0,
    billingInterval: 'one_time',
    includedCapabilities: app.manifest.capabilities || [],
    usageLimits: {},
    implementationRequirements: c.implementationRequirements || [],
    marginTarget: typeof c.marginTarget === 'number' ? c.marginTarget : 0.7,
    upgradePath: null,
    cancellationBehavior: c.cancellationBehavior || 'Full refund if the deliverable cannot be produced.',
    active: true,
    // Provenance — every overlay offer traces to a recorded decision.
    approvedBy: decision.approvedBy,
    decidedAt: decision.decidedAt,
    commercialSource: `app:${app.appId}:commercial`,
  };
  if (typeof catalog.registerApproved !== 'function') {
    throw new Error('catalog has no registerApproved — overlay support missing');
  }
  catalog.registerApproved(offer);
  return offer;
}

module.exports = { buildProposal, buildReviewActionSpec, materializeApprovedOffer };
