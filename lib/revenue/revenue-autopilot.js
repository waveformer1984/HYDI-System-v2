'use strict';

/**
 * RevenueAutopilotMission — the thin spine over existing machinery.
 *
 * One durable objective: "find the highest-confidence path to legitimate
 * revenue, take every authorized action, stop only at genuine human
 * boundaries, verify them, resume automatically."
 *
 * It is deliberately NOT a parallel orchestrator:
 *   - durable state lives on a normal heidi_goals mission row
 *     (context.autopilot) — the same GoalSystem everything else uses
 *   - human boundaries park via lib/human-actions/mission-link — the
 *     existing WAITING_ON_HUMAN + resume sweep
 *   - verifiers live in the closed lib/human-actions registry
 *   - money movement stays behind LiveTransactionAuthorization — the
 *     autopilot never gains authority the rest of the system lacks
 *
 * Stage machine (idempotent, evidence-appended):
 *   select    — pick the best opportunity (approved & highest confidence
 *               first; a pending one parks on the approval boundary)
 *   evaluate  — record the durable evidence for the choice
 *   offer     — map the opportunity onto the OfferCatalog and validate
 *               the economics (price > 0, offer active)
 *   gate      — attach every outstanding human prerequisite to the goal:
 *               approval, stripe env, live-transaction authorization
 *   payable   — all prerequisites proven → a legitimately payable offer.
 *               V1 stops here: creating the checkout session is itself
 *               an R2+ action consumed by the issued authorization, not
 *               something the autopilot performs silently.
 */

const crypto = require('crypto');

const { HumanActionService } = require('../human-actions/service');
const { attachBlockerToGoal, resumeSatisfiedGoals } = require('../human-actions/mission-link');

const OBJECTIVE_TITLE = 'REVENUE AUTOPILOT — next legitimate revenue';
const MIN_CONFIDENCE = 35;

function now() { return new Date().toISOString(); }

// ─── Opportunity → offer mapping ────────────────────────────────────────
// Keyword → catalog category. Conservative: a scanned opportunity only
// ever maps onto offers we can actually fulfill today.
const CATEGORY_HINTS = [
  [/3d|print|parts|replacement|cad|stl|manufactur|fabric/i, 'protoforge'],
  [/music|song|audio|stem|remix|rezone/i, 'rezonate'],
  [/website|chatbot|landing|web presence/i, 'website_deployment'],
  [/lead|prospect|appointment|outreach/i, 'lead_generation'],
];

function offerForOpportunity(opp, catalog) {
  const text = `${opp.title || ''} ${opp.summary || ''}`;
  for (const [re, category] of CATEGORY_HINTS) {
    if (re.test(text)) {
      const offers = catalog.getByCategory(category);
      if (offers.length) {
        const setup = offers.find((o) => o.setupPrice > 0) || offers[0];
        return { offer: setup, matchedCategory: category, reason: `opportunity signals '${category}'` };
      }
    }
  }
  const { recommended, reason } = catalog.recommendOffer([]);
  return { offer: catalog.get(recommended), matchedCategory: null, reason: `no category signal — catalog default: ${reason}` };
}

// ─── Prerequisite specs ─────────────────────────────────────────────────

function approvalSpec(opp) {
  return {
    blockerKey: `opportunity:${opp.id}:approval`,
    type: 'authorization',
    title: `Approve revenue opportunity — ${String(opp.title).slice(0, 90)}`,
    description: `Revenue autopilot selected this opportunity (confidence ${opp.confidence}). It is parked until a human approves it via the existing approval endpoint — the verifier only reads that recorded decision.`,
    priority: 'high',
    instructions: [
      `Review opportunity ${opp.id} — GET /api/missions/protoforge-opportunities`,
      `If it is worth pursuing: POST /api/missions/protoforge-opportunities {action:"approve", id:"${opp.id}", approvedBy:"<you>"} (service token required)`,
      'Tell Heidi "check again" — the verifier reads approval_status; if it says approved, the mission resumes automatically',
    ],
    verifier: { name: 'opportunity-approved', spec: { opportunityId: opp.id } },
    resumePolicy: 'auto',
    context: { mission: 'revenue-autopilot', blocker: 'OPPORTUNITY_NOT_APPROVED' },
  };
}

function stripeEnvSpec() {
  return {
    blockerKey: 'stripe:webhook-secret',
    type: 'credential',
    title: 'Configure Stripe webhook secret for payment verification',
    description: 'The payable offer can be created, but payment CONFIRMATION requires the webhook secret so paid events are verified, not assumed. Revenue is only recorded from verified payment evidence.',
    priority: 'high',
    instructions: [
      'In .env.local set STRIPE_WEBHOOK_SECRET=whsec_... (from `stripe listen` in test mode, or the Dashboard webhook signing secret)',
      'Tell Heidi "check again" — the verifier checks the name only, never the value',
    ],
    verifier: { name: 'env-vars', spec: { envNames: ['STRIPE_WEBHOOK_SECRET'] } },
    resumePolicy: 'auto',
    context: { mission: 'revenue-autopilot', blocker: 'PAYMENT_VERIFICATION_CREDENTIAL' },
  };
}

function liveAuthSpec(offer) {
  return {
    blockerKey: 'stripe:live-transaction-authorization',
    type: 'authorization',
    title: `Issue live-transaction authorization — ${offer.name}`,
    description: 'Creating a real checkout session is an R2+ external commitment. It requires a fresh, single-use LiveTransactionAuthorization issued by a human. The autopilot cannot grant itself this — the verifier proves one exists, unexpired, issued through the existing endpoint.',
    priority: 'high',
    instructions: [
      `Issue a scoped authorization for the checkout (≤ ${offer.setupPrice} cents): POST /api/operations/authorize-transaction (or the established authorize-live path)`,
      'The authorization is single-use and time-bounded — issue it when ready to create the session',
      'Tell Heidi "check again" — the verifier reads .hydi-operational/live-transaction-authorization.json for an unexpired PENDING/RESERVED authorization',
    ],
    verifier: { name: 'live-auth-issued', spec: {} },
    resumePolicy: 'auto',
    context: { mission: 'revenue-autopilot', blocker: 'R2_TRANSACTION_AUTHORIZATION' },
  };
}

// ─── The autopilot ──────────────────────────────────────────────────────

/**
 * Advance the durable objective one pass: complete every autonomous
 * stage in order, then park on human prerequisites if any remain.
 * Idempotent — completed stages are never re-executed, parked goals are
 * never re-linked, and nothing external happens without the existing
 * authorization gates.
 *
 * deps: { service?, goals, opportunityStore?, catalog?, envNamePresent?,
 *         actor? }
 */
async function advance(deps) {
  const { goals, actor = 'revenue-autopilot' } = deps;
  const store = deps.opportunityStore || require('../missions/opportunity-store');
  const svc = deps.service || new HumanActionService({ verifierDeps: { opportunityStore: store } });
  const catalog = deps.catalog || require('./OfferCatalog').getOfferCatalog();
  const envPresent = deps.envNamePresent || require('../human-actions/verifiers').envNamePresent;

  // Resume sweep first — a satisfied prerequisite must release the goal
  // before the stage machine re-evaluates, not on some later pass.
  await resumeSatisfiedGoals(svc, goals, { actor }).catch(() => null);
  const goal = await ensureObjectiveGoal(goals, deps);
  const ap = { ...(goal.context?.autopilot || { steps: [] }) };
  const steps = ap.steps || (ap.steps = []);
  const report = { goalId: goal.goalId, goalStatus: goal.status, stage: ap.stage || 'select', waiting: null, steps: [], opportunity: null, offer: null };

  // Every stage transition is durable immediately — a parked mission
  // must carry full context, not just the fact that it is parked.
  const persist = async () => {
    const fresh = await goals.getGoal(goal.goalId);
    const ctx = { ...(fresh?.context || {}), autopilotObjective: true, autopilot: ap };
    await goals.updateGoal(goal.goalId, { context: ctx });
    goal.context = ctx;
  };
  const note = async (stage, detail, extra = {}) => {
    steps.push({ stage, at: now(), detail });
    Object.assign(ap, extra);
    await persist();
    report.steps.push(`${stage}: ${detail}`);
  };

  // If the goal is parked on humans, a resume sweep may already have
  // flipped it; either way the stage machine re-evaluates honestly below.
  if (goal.context?.waitingOnHuman) {
    // Populate durable context so repeat briefs still show WHAT is parked,
    // not just that something is parked.
    if (ap.opportunityId) {
      report.opportunity = { id: ap.opportunityId, title: ap.opportunityTitle, confidence: ap.confidence, approval_status: ap.approvalStatus };
    }
    if (ap.offerId) report.offer = { offerId: ap.offerId, name: ap.offerName, priceCents: ap.priceCents };
    report.steps = (ap.steps || []).slice(-4).map((s) => `${s.stage}: ${s.detail}`);
    const waiting = await waitingReport(svc, goal);
    report.stage = 'WAITING_ON_HUMAN';
    report.waiting = waiting;
    return report;
  }

  // ── select ────────────────────────────────────────────────────────────
  if (!ap.opportunityId) {
    const opportunities = await store.listOpportunities({ limit: 100 });
    const candidates = (opportunities || [])
      .filter((o) => o.approval_status !== 'rejected' && o.confidence >= MIN_CONFIDENCE)
      .sort((a, b) => (b.approval_status === 'approved') - (a.approval_status === 'approved') || b.confidence - a.confidence);
    const chosen = candidates[0] || null;
    if (!chosen) {
      await goals.updateGoal(goal.goalId, { status: 'pending', context: { ...goal.context, autopilot: { ...ap, stage: 'awaiting_opportunity' } } });
      report.stage = 'awaiting_opportunity';
      report.steps.push('no opportunity above the confidence floor — run the opportunity scan');
      return report;
    }
    await note('select', `${chosen.title} (confidence ${chosen.confidence}, approval ${chosen.approval_status})`, {
      stage: 'select', opportunityId: chosen.id, opportunityTitle: chosen.title,
      confidence: chosen.confidence, approvalStatus: chosen.approval_status,
    });
  }

  const opp = await store.getOpportunity(ap.opportunityId);
  report.opportunity = opp ? { id: opp.id, title: opp.title, confidence: opp.confidence, approval_status: opp.approval_status } : { id: ap.opportunityId, missing: true };

  // ── evaluate ──────────────────────────────────────────────────────────
  if (!ap.evaluatedAt) {
    if (!opp) {
      await goals.updateGoal(goal.goalId, { status: 'pending', context: { ...goal.context, autopilot: { ...ap, stage: 'awaiting_opportunity', opportunityId: null } } });
      report.stage = 'awaiting_opportunity';
      report.steps.push('selected opportunity no longer exists — will re-select next pass');
      return report;
    }
    await note('evaluate', `evidence: confidence=${opp.confidence}, approval=${opp.approval_status}, source=${opp.source_url || 'n/a'}`, {
      stage: 'evaluate', evaluatedAt: now(),
    });
  }

  // ── offer ─────────────────────────────────────────────────────────────
  if (!ap.offerId) {
    const { offer, matchedCategory, reason } = offerForOpportunity(opp, catalog);
    if (!offer || !(offer.setupPrice > 0)) {
      report.stage = 'offer_failed';
      report.steps.push('no economically valid offer could be mapped — economics unproven');
      return report;
    }
    ap.offerId = offer.offerId;
    ap.offerName = offer.name;
    ap.priceCents = offer.setupPrice;
    ap.currency = 'usd';
    report.offer = { offerId: offer.offerId, name: offer.name, priceCents: offer.setupPrice };
    await note('offer', `${offer.name} @ ${offer.setupPrice} cents — ${reason}`, {
      stage: 'offer', offerId: offer.offerId, offerName: offer.name, priceCents: offer.setupPrice, offerReason: reason, matchedCategory,
    });
  } else {
    report.offer = { offerId: ap.offerId, name: ap.offerName, priceCents: ap.priceCents };
  }

  // ── gate — attach every outstanding human prerequisite ────────────────
  const catalog_offer = catalog.get(ap.offerId);
  const boundarySpecs = [];
  if (opp && opp.approval_status !== 'approved') boundarySpecs.push(approvalSpec(opp));
  if (!envPresent('STRIPE_WEBHOOK_SECRET')) boundarySpecs.push(stripeEnvSpec());
  boundarySpecs.push(liveAuthSpec({ name: ap.offerName || 'checkout', setupPrice: ap.priceCents || 0 }));

  const fresh = await goals.getGoal(goal.goalId);
  if (!fresh.context?.waitingOnHuman) {
    const parked = [];
    for (const spec of boundarySpecs) {
      // Only attach prerequisites that are genuinely unmet — the verifier
      // decides, not the spec author. Cheap pre-check avoids needless
      // parking: approval + env are locally knowable; live-auth is checked
      // via the verifier before attaching.
      if (spec.verifier.name === 'live-auth-issued') {
        const { runVerifier } = require('../human-actions/verifiers');
        const probe = await runVerifier('live-auth-issued', spec.verifier.spec);
        if (probe.passed) continue; // authorization already issued
      }
      const r = await attachBlockerToGoal(svc, goals, {
        goalId: goal.goalId, blockerKey: spec.blockerKey, spec, actor,
      });
      if (r.action) parked.push({ actionId: r.action.id, blockerKey: spec.blockerKey });
    }
    if (parked.length) {
      await note('gate', `parked on ${parked.length} human prerequisite(s)`, { stage: 'gate' });
      const parkedGoal = await goals.getGoal(goal.goalId);
      report.goalStatus = parkedGoal?.status || 'escalated';
      report.stage = 'WAITING_ON_HUMAN';
      report.waiting = await waitingReport(svc, parkedGoal);
      return report;
    }
  }

  // ── payable ───────────────────────────────────────────────────────────
  await note('payable', `offer legitimately payable — ${ap.offerName} @ ${ap.priceCents} cents; next external step (checkout session) is consumed by the issued single-use authorization`, {
    stage: 'payable', payableReadyAt: now(), payableReady: true,
  });
  await goals.updateGoal(goal.goalId, {
    status: 'pending',
    context: { ...((await goals.getGoal(goal.goalId)).context || {}), autopilot: { ...ap, stage: 'payable' } },
    evidence: [{ at: now(), runner: 'revenue-autopilot', type: 'PAYABLE_OFFER_READY', offerId: ap.offerId, priceCents: ap.priceCents, opportunityId: ap.opportunityId }],
  });
  report.stage = 'payable_ready';
  return report;
}

/** Find (or create) the single durable objective goal. */
async function ensureObjectiveGoal(goals, deps) {
  const existing = await goals.listGoals({ limit: 200 }).catch(() => []);
  let goal = existing.find((g) => g.context?.autopilotObjective === true);
  if (!goal) goal = existing.find((g) => g.title === OBJECTIVE_TITLE);
  if (!goal) {
    goal = await goals.createGoal({
      goalType: 'mission',
      title: OBJECTIVE_TITLE,
      description: 'Find the highest-confidence path to legitimate revenue; execute every authorized step; park only at genuine human boundaries; resume after verification.',
      priority: 9,
      context: { autopilotObjective: true, autopilot: { steps: [], stage: 'select' } },
    });
  }
  return goal;
}

async function waitingReport(svc, goal) {
  const ids = goal.context?.humanActions || [];
  const out = { waitingOnHuman: true, prerequisites: [] };
  for (const id of ids) {
    const a = svc.get(id);
    if (!a) continue;
    out.prerequisites.push({
      actionId: a.id, title: a.title, status: a.status, priority: a.priority,
      missing: a.verification?.failureReason || null,
      instructions: a.instructions || [],
    });
  }
  const open = out.prerequisites.filter((p) => !['RESOLVED', 'CANCELLED', 'REJECTED'].includes(p.status));
  out.satisfied = out.prerequisites.length - open.length;
  out.total = out.prerequisites.length;
  return out;
}

/**
 * NEXT BEST ACTION briefing — the text Heidi shows.
 * Deterministic from durable state; no LLM invention.
 */
async function brief(deps) {
  const report = await advance(deps);
  const lines = [];
  lines.push('NEXT BEST ACTION');
  if (report.opportunity?.title) {
    lines.push(`  Opportunity: ${report.opportunity.title}`);
    lines.push(`  Confidence: ${report.opportunity.confidence ?? 'n/a'}${report.opportunity.approval_status ? ` · approval: ${report.opportunity.approval_status}` : ''}`);
  }
  if (report.offer?.name) {
    lines.push(`  Offer: ${report.offer.name} — ${report.offer.priceCents} cents ${report.stage === 'payable_ready' ? '(LEGITIMATELY PAYABLE)' : ''}`);
  }
  for (const s of report.steps) lines.push(`  ${s}`);
  if (report.waiting) {
    const w = report.waiting;
    lines.push(`  STATUS: WAITING ON HUMAN — ${w.satisfied}/${w.total} prerequisites satisfied`);
    for (const p of w.prerequisites) {
      if (['RESOLVED', 'CANCELLED', 'REJECTED'].includes(p.status)) continue;
      lines.push(`  • [${p.status}] ${p.title}`);
      if (p.missing) lines.push(`    still missing: ${p.missing}`);
      for (const i of p.instructions) lines.push(`    → ${i}`);
    }
  } else if (report.stage === 'payable_ready') {
    lines.push('  STATUS: PAYABLE OFFER READY — checkout creation proceeds under the issued authorization on the next governed step.');
  } else if (report.stage === 'awaiting_opportunity') {
    lines.push('  STATUS: no qualified opportunity in the queue — run protoforge.daily_opportunity_scan to feed the pipeline.');
  }
  return { report, text: lines.join('\n') };
}

module.exports = { advance, brief, OBJECTIVE_TITLE, offerForOpportunity };
