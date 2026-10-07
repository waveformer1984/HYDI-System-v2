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
  [/audit|workflow|risk|control|compliance|checkpoint/i, 'service_audit'],
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
      'In .env.local set STRIPE_WEBHOOK_SECRET_01 (or STRIPE_WEBHOOK_SECRET) = whsec_... (from `stripe listen` in test mode, or the Dashboard webhook signing secret)',
      'Tell Heidi "check again" — the verifier checks the name only, never the value',
    ],
    verifier: { name: 'env-vars', spec: { envNames: [], anyOfGroups: [['STRIPE_WEBHOOK_SECRET_01'], ['STRIPE_WEBHOOK_SECRET']] } },
    resumePolicy: 'auto',
    context: { mission: 'revenue-autopilot', blocker: 'PAYMENT_VERIFICATION_CREDENTIAL' },
  };
}

function customerEmailSpec() {
  return {
    blockerKey: 'revenue:qualification-customer',
    type: 'input',
    title: 'Provide a customer identity for the checkout session',
    description: 'A checkout session requires a real customer email — the identity that will complete payment. The autopilot cannot invent a customer.',
    priority: 'high',
    instructions: [
      'In .env.local set LIVE_QUALIFICATION_CUSTOMER_EMAIL to the email that will complete checkout',
      'Tell Heidi "check again" — the verifier checks the name only, never the value',
    ],
    verifier: { name: 'env-vars', spec: { envNames: ['LIVE_QUALIFICATION_CUSTOMER_EMAIL'] } },
    resumePolicy: 'auto',
    context: { mission: 'revenue-autopilot', blocker: 'NO_CUSTOMER_IDENTITY' },
  };
}

function paymentSpec(job, checkoutUrl, mode) {
  const test = mode === 'test';
  return {
    blockerKey: `revenue:payment:${job.jobId}`,
    type: 'payment',
    title: `Complete ${test ? 'test ' : ''}checkout payment — ${job.product} (${job.priceCents}¢)`,
    description: `A real checkout session exists and is awaiting payment. Only a signature-verified Stripe webhook can flip the job to paid — there is no simulated-payment path.${test ? ' Stripe is in TEST mode (sk_test_) — this proves the full pipeline without real money.' : ' Stripe is in LIVE mode — a real card charge will occur.'}`,
    priority: 'high',
    instructions: [
      test
        ? 'Ensure webhook delivery: run `stripe listen --forward-to http://localhost:3000/api/webhooks/stripe`, set the printed whsec_... as STRIPE_WEBHOOK_SECRET_01 in .env.local, restart heidi-web'
        : 'Ensure the live webhook endpoint delivers checkout.session.completed to /api/webhooks/stripe',
      `Open the checkout URL and complete payment${test ? ' with test card 4242 4242 4242 4242, any future expiry, any CVC' : ''}: ${checkoutUrl || '(retrieve via job)'}`,
      'Tell Heidi "check again" — the verifier reads the durable job row; only a verified webhook marks it paid',
    ],
    verifier: { name: 'job-payment-status', spec: { jobId: job.jobId } },
    resumePolicy: 'auto',
    context: { mission: 'revenue-autopilot', blocker: 'PAYMENT_PENDING' },
  };
}

function deliverySpec(job) {
  return {
    blockerKey: `revenue:delivery:${job.jobId}`,
    type: 'approval',
    title: `Review and approve delivery — job ${job.jobId}`,
    description: 'Artifacts were generated and verified, but the independent QA gate did not return an unconditional PASS — delivery requires human approval through the existing endpoint.',
    priority: 'high',
    instructions: [
      `Inspect the job: GET /api/revenue/jobs/${job.jobId}`,
      `If the artifacts are correct: POST /api/revenue/jobs/${job.jobId}/approve`,
      'Tell Heidi "check again" — the verifier reads the durable job delivery status',
    ],
    verifier: { name: 'job-delivered', spec: { jobId: job.jobId } },
    resumePolicy: 'auto',
    context: { mission: 'revenue-autopilot', blocker: 'DELIVERY_NEEDS_HUMAN' },
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
/** Resolve the canonical stripe mode — injectable for tests. */
async function stripeModeName(deps) {
  if (deps.stripeMode !== undefined) return deps.stripeMode;
  try {
    const m = await import('./stripe-mode.ts');
    return m.getStripeMode().mode;
  } catch { return 'disabled'; }
}

/** ESM module loaders — the same dynamic-import seam JobWebhookBridge uses. */
async function loadJobManager(deps) {
  return deps.jobManager || (await import('./JobManager.ts')).getJobManager();
}
async function loadReconciler(deps) {
  return deps.reconciler || new (await import('./RevenueReconciler.ts')).RevenueReconciler();
}
async function loadExecutor(deps) {
  return deps.executeJob || (await import('./JobExecutor.ts')).executeJob;
}

/**
 * The boundary set this run genuinely requires — mode-aware.
 * Live money needs live-auth before a session may be created; test mode
 * needs a real customer identity instead. A session that already exists
 * proves its authorization was consumed correctly — never re-gate on it.
 */
async function requiredBoundarySpecs({ opp, ap, deps, envPresent }) {
  const specs = [];
  if (!envPresent('STRIPE_SECRET_KEY')) {
    specs.push({
      blockerKey: 'stripe:secret-key', type: 'credential',
      title: 'Configure STRIPE_SECRET_KEY',
      description: 'No Stripe key at all — checkout cannot be created.',
      priority: 'high',
      instructions: ['In .env.local set STRIPE_SECRET_KEY (sk_test_ for the pipeline proof, sk_live_ for real revenue)', 'Tell Heidi "check again"'],
      verifier: { name: 'env-vars', spec: { envNames: ['STRIPE_SECRET_KEY'] } },
      resumePolicy: 'auto',
      context: { mission: 'revenue-autopilot', blocker: 'STRIPE_NOT_CONFIGURED' },
    });
  }
  if (!envPresent('STRIPE_WEBHOOK_SECRET_01') && !envPresent('STRIPE_WEBHOOK_SECRET')) specs.push(stripeEnvSpec());
  if (opp && opp.approval_status !== 'approved') specs.push(approvalSpec(opp));
  const mode = await stripeModeName(deps);
  if (mode === 'live' && !ap.checkoutSessionId) {
    const { runVerifier } = require('../human-actions/verifiers');
    const probe = await runVerifier('live-auth-issued', {});
    if (!probe.passed) specs.push(liveAuthSpec({ name: ap.offerName || 'checkout', setupPrice: ap.priceCents || 0 }));
  } else if (mode === 'test' && !ap.jobId) {
    if (!envPresent('LIVE_QUALIFICATION_CUSTOMER_EMAIL') && !ap.customerEmail) specs.push(customerEmailSpec());
  }
  return specs;
}

/**
 * Sync the goal's linked actions against the CURRENT required boundary
 * set: attach missing, drop stale autopilot-owned links (the action
 * stays OPEN globally for the path that needs it), re-verify the rest,
 * and release through the proven sweep when everything is satisfied.
 * Returns the waiting report while still parked, null when cleared.
 */
async function syncBoundaries({ svc, goals, goal, specs, actor }) {
  const neededIds = [];
  for (const spec of specs) {
    const r = await attachBlockerToGoal(svc, goals, {
      goalId: goal.goalId, blockerKey: spec.blockerKey, spec, actor,
    });
    if (r.action) neededIds.push(r.action.id);
  }
  const cur = await goals.getGoal(goal.goalId);
  const ctx = { ...(cur.context || {}) };
  const dropped = [];
  const kept = [];
  for (const id of (ctx.humanActions || [])) {
    if (neededIds.includes(id)) { kept.push(id); continue; }
    const a = svc.get(id);
    if (!a || a.context?.mission !== 'revenue-autopilot') { kept.push(id); continue; }
    // Stale for THIS path — but give the verifier one honest chance:
    // reality may have satisfied it through a different route. Only a
    // still-failing prerequisite gets unlinked from the goal.
    if (!['RESOLVED', 'CANCELLED', 'REJECTED'].includes(a.status)) {
      await svc.verify(id, actor).catch(() => null);
    }
    const a2 = svc.get(id);
    if (a2 && !['RESOLVED', 'CANCELLED', 'REJECTED'].includes(a2.status)) {
      dropped.push({ id, blockerKey: a2.blockerKey });
    } else {
      kept.push(id);
    }
  }
  if (dropped.length) {
    ctx.humanActions = kept;
    ctx.humanBlockerKeys = (ctx.humanBlockerKeys || []).filter((k) => !dropped.some((d) => d.blockerKey === k));
    for (const d of dropped) { if (typeof svc.unlinkGoal === 'function') svc.unlinkGoal(d.id, actor); }
    await goals.updateGoal(goal.goalId, {
      context: ctx,
      evidence: dropped.map((d) => ({ at: now(), runner: 'revenue-autopilot', type: 'PREREQUISITE_NOT_REQUIRED', actionId: d.id, blockerKey: d.blockerKey, detail: 'not required on the selected path — action remains OPEN globally' })),
    });
  }
  // Re-verify every open linked action — a verifier pass is the only
  // thing that may flip RESOLVED.
  const open = [];
  for (const id of kept) {
    const a = svc.get(id);
    if (!a || ['RESOLVED', 'CANCELLED', 'REJECTED'].includes(a.status)) continue;
    await svc.verify(id, actor).catch(() => null);
    const a2 = svc.get(id);
    if (a2 && !['RESOLVED', 'CANCELLED', 'REJECTED'].includes(a2.status)) open.push(a2);
  }
  if (open.length === 0) {
    if (neededIds.length === 0 && kept.length === 0) {
      // No links at all — clear a stale park if one remains.
      const g = await goals.getGoal(goal.goalId);
      if (g?.context?.waitingOnHuman) {
        await goals.updateGoal(goal.goalId, { status: 'pending', context: { ...g.context, waitingOnHuman: false } });
      }
      return null;
    }
    await resumeSatisfiedGoals(svc, goals, { actor });
    const g = await goals.getGoal(goal.goalId);
    if (!g?.context?.waitingOnHuman) return null;
  }
  const parked = await goals.getGoal(goal.goalId);
  const ctx2 = { ...(parked.context || {}), waitingOnHuman: true };
  if (parked.status !== 'escalated' || !parked.context?.waitingOnHuman) {
    await goals.updateGoal(goal.goalId, { status: 'escalated', context: ctx2 });
  }
  return waitingReport(svc, await goals.getGoal(goal.goalId));
}

/**
 * Create the canonical customer job + Stripe checkout session — the same
 * seam POST /api/revenue/jobs uses, including the live-mode
 * LiveTransactionAuthorization guard. Idempotent: an existing ap.jobId
 * is always reused, never duplicated.
 */
async function ensureCheckoutJob({ ap, opp, deps, mode }) {
  const jm = await loadJobManager(deps);
  if (ap.jobId) {
    return { job: await jm.getJob(ap.jobId), jm, created: false };
  }
  const bridge = deps.stripeBridge || new (await import('./StripeBridge.ts')).StripeBridge();
  if (typeof bridge.isConfigured === 'function' && !bridge.isConfigured()) {
    throw new Error('Stripe is not configured — the credential boundary should have parked first');
  }
  let customerEmail = ap.customerEmail || deps.customerEmail || process.env.LIVE_QUALIFICATION_CUSTOMER_EMAIL || null;
  let liveAuth = null;
  if (mode === 'live') {
    const authManager = deps.authManager || (await import('./LiveTransactionAuthorization.ts')).getLiveTransactionAuthorizationManager();
    const pending = authManager.getPending();
    if (!pending) throw new Error('LIVE mode reached checkout with no pending authorization — refused (boundary should have parked)');
    if (ap.priceCents > pending.amountCents) throw new Error(`job price ${ap.priceCents}¢ exceeds authorized ${pending.amountCents}¢ — refused`);
    if (pending.currency && pending.currency !== 'usd') throw new Error('authorized currency mismatch — refused');
    customerEmail = pending.customer; // the authorized customer is the only permitted live identity
    liveAuth = pending;
  }
  if (!customerEmail) return { needsCustomer: true, jm };
  const job = await jm.createJob({
    customerEmail,
    customerName: customerEmail.split('@')[0],
    product: ap.offerId,
    requestText: `ProtoForge opportunity: ${ap.opportunityTitle || opp?.title || 'model preparation'}`,
    requirements: { objectType: 'replacement_part', opportunityId: ap.opportunityId },
    priceCents: ap.priceCents,
    currency: 'usd',
  });
  const base = deps.baseUrl || process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
  const co = await bridge.createSetupCheckoutSession({
    offerId: ap.offerId,
    customerEmail,
    customerName: job.customerName,
    prospectId: null,
    opportunityId: ap.opportunityId,
    successUrl: `${base}/services/model-prep/success?jobId=${job.jobId}&session_id={CHECKOUT_SESSION_ID}`,
    cancelUrl: `${base}/services/model-prep/cancel?jobId=${job.jobId}`,
    authorizationId: liveAuth?.authorizationId,
  });
  if ('error' in co) throw new Error(`checkout session failed: ${co.error}`);
  if (mode === 'live' && liveAuth) {
    const authManager = deps.authManager || (await import('./LiveTransactionAuthorization.ts')).getLiveTransactionAuthorizationManager();
    const r = authManager.reserve(liveAuth.authorizationId, job.jobId, co.sessionId, job.priceCents, customerEmail, 'usd');
    if (!r.success) throw new Error(`authorization reservation failed after session creation: ${r.error}`);
  }
  await jm.linkCheckoutSession(job.jobId, co.sessionId, co.url);
  return { job, jm, created: true, sessionId: co.sessionId, checkoutUrl: co.url };
}

async function advance(deps) {
  const { goals, actor = 'revenue-autopilot' } = deps;
  const store = deps.opportunityStore || require('../missions/opportunity-store');
  const envPresent = deps.envNamePresent || require('../human-actions/verifiers').envNamePresent;
  const svc = deps.service || new HumanActionService({ verifierDeps: { opportunityStore: store, jobManager: deps.jobManager, envNamePresent: envPresent } });
  const catalog = deps.catalog || require('./OfferCatalog').getOfferCatalog();

  // Resume sweep first — a satisfied prerequisite must release the goal
  // before the stage machine re-evaluates, not on some later pass.
  await resumeSatisfiedGoals(svc, goals, { actor }).catch(() => null);
  let goal = await ensureObjectiveGoal(goals, deps);
  const ap = { ...(goal.context?.autopilot || { steps: [] }) };
  const steps = ap.steps || (ap.steps = []);
  const report = { goalId: goal.goalId, goalStatus: goal.status, stage: ap.stage || 'select', waiting: null, steps: [], opportunity: null, offer: null, job: null, proof: null };

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

  if (ap.opportunityId) {
    report.opportunity = { id: ap.opportunityId, title: ap.opportunityTitle, confidence: ap.confidence, approval_status: ap.approvalStatus };
  }
  if (ap.offerId) report.offer = { offerId: ap.offerId, name: ap.offerName, priceCents: ap.priceCents };
  if (ap.jobId) report.job = { jobId: ap.jobId, checkoutSessionId: ap.checkoutSessionId, checkoutUrl: ap.checkoutUrl };

  const opp = ap.opportunityId ? await store.getOpportunity(ap.opportunityId) : null;

  // Parked: sync the required boundary set against current reality — the
  // mode may have changed, prerequisites may now be satisfied, or stale
  // links may need dropping. Only a still-open boundary keeps us parked.
  // The set is STAGE-AWARE: a parked payment/delivery action stays linked
  // exactly as long as its stage is open.
  if (goal.context?.waitingOnHuman) {
    if (ap.offerId) {
      const mode = await stripeModeName(deps);
      const specs = await requiredBoundarySpecs({ opp, ap, deps, envPresent });
      if (ap.jobId) {
        const jm = await loadJobManager(deps);
        const job = await jm.getJob(ap.jobId);
        if (job && job.paymentStatus !== 'paid') specs.push(paymentSpec(job, ap.checkoutUrl, mode));
        else if (job && job.jobStatus === 'awaiting_review' && job.deliveryStatus !== 'delivered') specs.push(deliverySpec(job));
      }
      const waiting = await syncBoundaries({ svc, goals, goal, specs, actor });
      if (waiting) {
        report.steps = (ap.steps || []).slice(-4).map((s) => `${s.stage}: ${s.detail}`);
        report.stage = 'WAITING_ON_HUMAN';
        report.waiting = waiting;
        report.goalStatus = 'escalated';
        return report;
      }
      goal = await goals.getGoal(goal.goalId); // released — continue
    } else {
      // Parked before any boundary set existed — report honestly.
      report.steps = (ap.steps || []).slice(-4).map((s) => `${s.stage}: ${s.detail}`);
      report.stage = 'WAITING_ON_HUMAN';
      report.waiting = await waitingReport(svc, goal);
      return report;
    }
  }

  // ── select ────────────────────────────────────────────────────────────
  if (!ap.opportunityId) {
    const opportunities = await store.listOpportunities({ limit: 100 });
    // Opportunities already proven by a completed mission are never re-run.
    const allGoals = await goals.listGoals({ limit: 200 }).catch(() => []);
    const proven = new Set(allGoals
      .filter((g) => g.context?.autopilot?.proof?.opportunityId)
      .map((g) => g.context.autopilot.proof.opportunityId));
    const candidates = (opportunities || [])
      .filter((o) => o.approval_status !== 'rejected' && o.confidence >= MIN_CONFIDENCE && !proven.has(o.id))
      .sort((a, b) => (b.approval_status === 'approved') - (a.approval_status === 'approved') || b.confidence - a.confidence);
    const chosen = candidates[0] || null;
    if (!chosen) {
      await goals.updateGoal(goal.goalId, { status: 'pending', context: { ...goal.context, autopilot: { ...ap, stage: 'awaiting_opportunity' } } });
      report.stage = 'awaiting_opportunity';
      report.steps.push('no opportunity above the confidence floor — run the opportunity scan');
      return report;
    }
    // Durable selection rationale — "why this one instead of the others"
    // must be answerable from evidence, not reconstructed later.
    const selection = {
      chosenId: chosen.id,
      reason: `${chosen.approval_status === 'approved' ? 'approved + ' : ''}highest confidence (${chosen.confidence}) of ${candidates.length} candidate(s) at/above the ${MIN_CONFIDENCE} floor${proven.size ? `; ${proven.size} already-proven opportunit${proven.size === 1 ? 'y' : 'ies'} excluded` : ''}`,
      considered: candidates.slice(0, 5).map((o) => ({ id: o.id, title: o.title, confidence: o.confidence, approval: o.approval_status })),
      poolSize: (opportunities || []).length,
      selectedAt: now(),
    };
    await note('select', `${chosen.title} (confidence ${chosen.confidence}, approval ${chosen.approval_status}) — ${selection.reason}`, {
      stage: 'select', opportunityId: chosen.id, opportunityTitle: chosen.title,
      confidence: chosen.confidence, approvalStatus: chosen.approval_status, selection,
    });
    report.opportunity = { id: chosen.id, title: chosen.title, confidence: chosen.confidence, approval_status: chosen.approval_status };
  }

  const opp2 = opp || await store.getOpportunity(ap.opportunityId);
  report.opportunity = opp2 ? { id: opp2.id, title: opp2.title, confidence: opp2.confidence, approval_status: opp2.approval_status } : report.opportunity;

  // ── evaluate ──────────────────────────────────────────────────────────
  if (!ap.evaluatedAt) {
    if (!opp2) {
      await goals.updateGoal(goal.goalId, { status: 'pending', context: { ...goal.context, autopilot: { ...ap, stage: 'awaiting_opportunity', opportunityId: null } } });
      report.stage = 'awaiting_opportunity';
      report.steps.push('selected opportunity no longer exists — will re-select next pass');
      return report;
    }
    await note('evaluate', `evidence: confidence=${opp2.confidence}, approval=${opp2.approval_status}, source=${opp2.source_url || 'n/a'}`, {
      stage: 'evaluate', evaluatedAt: now(),
    });
  }

  // ── offer ─────────────────────────────────────────────────────────────
  if (!ap.offerId) {
    const { offer, matchedCategory, reason } = offerForOpportunity(opp2, catalog);
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

  // ── gate — sync every outstanding human prerequisite ──────────────────
  const specs = await requiredBoundarySpecs({ opp: opp2, ap, deps, envPresent });
  const waiting = await syncBoundaries({ svc, goals, goal, specs, actor });
  if (waiting) {
    await note('gate', `parked on ${waiting.total - waiting.satisfied} human prerequisite(s)`, { stage: 'gate' });
    report.goalStatus = 'escalated';
    report.stage = 'WAITING_ON_HUMAN';
    report.waiting = waiting;
    return report;
  }

  const mode = await stripeModeName(deps);

  // ── payable ───────────────────────────────────────────────────────────
  if (!ap.payableReady) {
    await note('payable', `offer legitimately payable — ${ap.offerName} @ ${ap.priceCents} cents (${mode} mode)`, {
      stage: 'payable', payableReadyAt: now(), payableReady: true,
    });
    await goals.updateGoal(goal.goalId, {
      evidence: [{ at: now(), runner: 'revenue-autopilot', type: 'PAYABLE_OFFER_READY', offerId: ap.offerId, priceCents: ap.priceCents, opportunityId: ap.opportunityId, stripeMode: mode }],
    });
  }

  // ── checkout — canonical job + session seam ───────────────────────────
  const co = await ensureCheckoutJob({ ap, opp: opp2, deps, mode });
  if (co.needsCustomer) {
    const w = await syncBoundaries({ svc, goals, goal, specs: [customerEmailSpec()], actor });
    report.stage = 'WAITING_ON_HUMAN';
    report.waiting = w;
    report.goalStatus = 'escalated';
    return report;
  }
  const job = co.job;
  if (co.created) {
    await note('checkout', `job ${job.jobId} + session ${co.sessionId} created (${mode})`, {
      stage: 'checkout', jobId: job.jobId, checkoutSessionId: co.sessionId, checkoutUrl: co.checkoutUrl, customerEmail: job.customerEmail,
    });
  }
  report.job = { jobId: job.jobId, checkoutSessionId: ap.checkoutSessionId, checkoutUrl: ap.checkoutUrl, paymentStatus: job.paymentStatus, jobStatus: job.jobStatus, deliveryStatus: job.deliveryStatus };

  // ── payment — verified webhook or park ────────────────────────────────
  const jm = co.jm;
  let jobNow = job;
  if (jobNow.paymentStatus !== 'paid') {
    const w = await syncBoundaries({ svc, goals, goal, specs: [paymentSpec(jobNow, ap.checkoutUrl, mode)], actor });
    if (w) {
      if (!ap.paymentParked) {
        await note('payment', `awaiting ${mode} payment — job ${jobNow.jobId}, session ${ap.checkoutSessionId}`, { stage: 'payment', paymentParked: true });
      }
      report.stage = 'WAITING_ON_HUMAN';
      report.waiting = w;
      report.goalStatus = 'escalated';
      return report;
    }
    // The verifier just flipped — the only honest "paid" is the row.
    jobNow = await jm.getJob(jobNow.jobId);
    if (jobNow.paymentStatus !== 'paid') {
      report.stage = 'payment_pending';
      report.steps.push('payment boundary cleared without paid status — recheck next pass');
      return report;
    }
  }
  if (!ap.paidAt) {
    await note('payment', `payment confirmed by verified webhook — job ${jobNow.jobId}`, { stage: 'payment', paidAt: now() });
  }
  if (!['awaiting_review', 'delivered', 'completed', 'failed'].includes(jobNow.jobStatus)) {
    const executeJob = await loadExecutor(deps);
    const exec = await executeJob(job.jobId);
    await note('execute', `executeJob → ${exec.success ? 'artifacts verified' : 'failed: ' + (exec.error || 'unknown')}${exec.delivered ? ' (auto-delivered)' : ''}`, {
      stage: 'execute', executedAt: now(), execSuccess: exec.success, execError: exec.error || null,
    });
    jobNow = await jm.getJob(job.jobId);
  }

  // ── deliver — auto or human approval ──────────────────────────────────
  if (jobNow.deliveryStatus !== 'delivered') {
    if (jobNow.jobStatus === 'failed') {
      report.stage = 'execution_failed';
      report.steps.push(`execution failed durably — job ${job.jobId}: inspect and retry through the job path`);
      return report;
    }
    const w = await syncBoundaries({ svc, goals, goal, specs: [deliverySpec(jobNow)], actor });
    if (w) {
      report.stage = 'WAITING_ON_HUMAN';
      report.waiting = w;
      report.goalStatus = 'escalated';
      return report;
    }
    jobNow = await jm.getJob(jobNow.jobId);
    if (jobNow.deliveryStatus !== 'delivered') {
      report.stage = 'delivering';
      report.steps.push('delivery boundary cleared without delivered status — recheck next pass');
      return report;
    }
  }
  if (!ap.deliveredAt) {
    await note('deliver', `job ${job.jobId} delivered`, { stage: 'deliver', deliveredAt: now() });
  }

  // ── reconcile — independent truth check ───────────────────────────────
  const reconciler = await loadReconciler(deps);
  const recon = await reconciler.reconcile(job.jobId);
  if (recon.state === 'INCOMPLETE') {
    report.stage = 'reconciling';
    report.steps.push(`reconciliation INCOMPLETE — ${recon.summary}; will re-check on next pass`);
    return report;
  }
  if (recon.state !== 'CONSISTENT') {
    await goals.updateGoal(goal.goalId, {
      status: 'escalated',
      context: { ...(goal.context || {}), autopilot: { ...ap, stage: 'reconciliation_failed' } },
      evidence: [{ at: now(), runner: 'revenue-autopilot', type: 'RECONCILIATION_FAILED', jobId: job.jobId, state: recon.state, violations: recon.violations || [] }],
    });
    report.stage = 'reconciliation_failed';
    report.steps.push(`reconciliation ${recon.state} — ${recon.summary}; violations: ${(recon.violations || []).join('; ') || 'none'}`);
    return report;
  }

  // ── proven ────────────────────────────────────────────────────────────
  const sessionId = jobNow.stripeCheckoutSessionId || ap.checkoutSessionId;
  const isTest = (sessionId || '').startsWith('cs_test_') || mode === 'test';
  const proof = {
    type: isTest ? 'TEST_PIPELINE_PROVEN' : 'REVENUE_PROVEN',
    provenAt: now(),
    opportunityId: ap.opportunityId,
    offerId: ap.offerId,
    goalId: goal.goalId,
    jobId: job.jobId,
    checkoutSessionId: sessionId,
    paymentIntentId: recon.correlation?.paymentIntentId || jobNow.paymentIntentId || null,
    ledgerEntryId: recon.correlation?.ledgerEntryId || null,
    stripeEventId: recon.correlation?.stripeEventId || null,
    amountCents: job.priceCents,
    currency: 'usd',
    stripeMode: mode,
    artifactCount: (jobNow.artifactPaths || []).length,
    reconciliation: { state: recon.state, summary: recon.summary },
  };
  await note('proven', `${proof.type} — ${proof.amountCents}¢ ${proof.currency} reconciled (${proof.checkoutSessionId})`, {
    stage: 'proven', proof,
  });
  await goals.updateGoal(goal.goalId, {
    status: 'completed',
    context: { ...(goal.context || {}), autopilotObjective: true, autopilot: { ...ap, stage: 'proven' } },
    evidence: [{ at: now(), runner: 'revenue-autopilot', ...proof }],
  });
  report.proof = proof;
  report.stage = proof.type;
  report.goalStatus = 'completed';
  return report;
}

/** Fast-path resume for the Stripe webhook: after a payment is confirmed,
 * advance the mission immediately rather than waiting for the next tick.
 * Bounded — only fires when the mission is parked on THIS exact job, so
 * unrelated payments never spin up or disturb the mission. Best-effort:
 * failures return null; the periodic tick catches anything missed. */
async function resumeForPayment(goals, jobId, extraDeps = {}) {
  try {
    const existing = await goals.listGoals({ limit: 200 }).catch(() => []);
    const goal = existing.find((g) => g.context?.autopilotObjective === true && !['completed', 'cancelled'].includes(g.status));
    const ap = goal && goal.context && goal.context.autopilot;
    if (!ap || ap.jobId !== jobId) return null;
    return await advance({ ...extraDeps, goals, actor: 'webhook:stripe' });
  } catch {
    return null;
  }
}

/** Find (or create) the single durable objective goal — completed
 * missions stay as evidence; a new instance is created for the next run. */
async function ensureObjectiveGoal(goals, deps) {
  const existing = await goals.listGoals({ limit: 200 }).catch(() => []);
  let goal = existing.find((g) => g.context?.autopilotObjective === true && !['completed', 'cancelled'].includes(g.status));
  if (!goal) goal = existing.find((g) => g.title === OBJECTIVE_TITLE && !['completed', 'cancelled'].includes(g.status));
  if (!goal) {
    goal = await goals.createGoal({
      goalType: 'mission',
      title: OBJECTIVE_TITLE,
      description: 'Find the highest-confidence path to legitimate revenue; execute every authorized step; park only at genuine human boundaries; resume after verification.',
      priority: 9,
      // Ownership invariant: this runner is the only execution owner —
      // managedBy keeps the goal out of the generic planner's pending queue
      // (getPendingWork), so the daemon can never 'complete' a revenue
      // mission mid-run the way it consumed a realization goal.
      context: { autopilotObjective: true, managedBy: 'revenue-autopilot', autopilot: { steps: [], stage: 'select' } },
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
  // Surface the last completed mission's proof alongside any live run.
  const lastProof = report.proof || (deps.goals ? await lastProvenProof(deps.goals, report.goalId) : null);
  lines.push('NEXT BEST ACTION');
  if (report.opportunity?.title) {
    lines.push(`  Opportunity: ${report.opportunity.title}`);
    lines.push(`  Confidence: ${report.opportunity.confidence ?? 'n/a'}${report.opportunity.approval_status ? ` · approval: ${report.opportunity.approval_status}` : ''}`);
  }
  if (report.offer?.name) {
    lines.push(`  Offer: ${report.offer.name} — ${report.offer.priceCents} cents`);
  }
  if (report.job?.jobId) {
    lines.push(`  Job: ${report.job.jobId}${report.job.checkoutSessionId ? ` · session ${report.job.checkoutSessionId}` : ''}`);
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
  } else if (report.stage === 'awaiting_opportunity') {
    lines.push('  STATUS: no qualified opportunity in the queue — run protoforge.daily_opportunity_scan to feed the pipeline.');
  }
  if (lastProof) {
    lines.push('');
    lines.push(`REVENUE OBJECTIVE — ${lastProof.type === 'TEST_PIPELINE_PROVEN' ? 'TEST PIPELINE PROVEN' : 'REVENUE PROVEN'}`);
    lines.push(`  ${lastProof.amountCents}¢ ${lastProof.currency} · job ${lastProof.jobId} · session ${lastProof.checkoutSessionId}`);
    lines.push(`  payment: ${lastProof.paymentIntentId || 'n/a'} · ledger: ${lastProof.ledgerEntryId || 'n/a'}`);
    lines.push(`  reconciliation: ${lastProof.reconciliation?.state} — ${lastProof.reconciliation?.summary || ''}`);
    if (lastProof.type === 'TEST_PIPELINE_PROVEN') {
      lines.push('  NOTE: test-mode (sk_test_) — proves the pipeline, not live revenue. Live revenue requires the live prerequisites.');
    }
  }
  return { report, text: lines.join('\n') };
}

async function lastProvenProof(goals, excludeGoalId) {
  const all = await goals.listGoals({ limit: 200 }).catch(() => []);
  const done = all
    .filter((g) => g.goalId !== excludeGoalId && g.context?.autopilot?.proof)
    .sort((a, b) => String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));
  return done[0]?.context.autopilot.proof || null;
}

/**
 * READ-ONLY commercial status — the durable truth behind "what are we
 * working on / why this opportunity / what's waiting on payment". Never
 * advances the stage machine: a status question must not mutate state.
 * Everything below is read from the durable goal context + job row.
 */
/**
 * Production-revenue readiness — read-only, from durable boundary actions
 * + the configured Stripe mode. Answers "what exactly is blocking first
 * real revenue" without mutating anything: no verifier runs, no action is
 * created here — the sync cadence (detectKnownBlockers) owns creation.
 */
const PRODUCTION_BOUNDARY_KEYS = [
  'stripe:live-credential',
  'protoforge:public-base-url',
  'stripe:live-webhook-endpoint',
  'stripe:webhook-processing',
];

async function productionReadiness(svc, deps) {
  const mode = await stripeModeName(deps);
  const open = (svc.list ? svc.list({ includeTerminal: false }) : [])
    .filter((a) => PRODUCTION_BOUNDARY_KEYS.includes(a.blockerKey));
  const liveCred = open.find((a) => a.blockerKey === 'stripe:live-credential');
  // The durable actions are the standing record; a missing live-credential
  // action in test mode only means detection hasn't run yet this boot —
  // mode tells the same truth without inventing a record.
  const ready = mode === 'live' && open.length === 0;
  return {
    ready,
    mode,
    blockers: open.map((a) => ({
      actionId: a.id, blockerKey: a.blockerKey, title: a.title,
      status: a.status, missing: a.verification?.failureReason || null,
      verifier: a.verifier?.name || null,
    })),
    // Even before detection materializes the action, a non-live mode is
    // itself the honest first blocker.
    implicitBlocker: mode !== 'live' && !liveCred
      ? `Stripe is in ${mode} mode — a live credential boundary will be recorded by the next sync`
      : null,
  };
}

async function status(deps) {
  const { goals } = deps;
  const svc = deps.service || new HumanActionService({});
  const all = await goals.listGoals({ limit: 200 }).catch(() => []);
  const goal = all.find((g) => g.context?.autopilotObjective === true && !['completed', 'cancelled'].includes(g.status));
  const ap = goal?.context?.autopilot || null;
  const lines = ['COMMERCIAL STATUS'];
  const prod = await productionReadiness(svc, deps);
  const out = { stage: ap?.stage || null, opportunity: null, offer: null, job: null, waiting: null, proof: null, production: prod, text: '' };

  const appendProduction = () => {
    lines.push('  ── Production revenue ──');
    if (prod.ready) {
      lines.push('  READY — live Stripe mode verified, no open production boundaries. First live checkout still requires a per-transaction authorization (issued at checkout time, never in advance).');
      return;
    }
    lines.push(`  NOT READY — stripe mode: ${prod.mode}${prod.mode === 'test' ? ' (sk_test_ — qualifies the pipeline, cannot produce real revenue)' : ''}`);
    for (const b of prod.blockers) {
      lines.push(`    • [${b.status}] ${b.title} — verifier: ${b.verifier}${b.missing ? ` — ${b.missing}` : ''}`);
    }
    if (prod.implicitBlocker) lines.push(`    • ${prod.implicitBlocker}`);
    if (prod.blockers.length === 0 && !prod.implicitBlocker) {
      lines.push('    • boundaries not yet materialized — they appear as durable actions on the next sync');
    }
  };

  if (!ap) {
    const proof = await lastProvenProof(goals, null);
    if (proof) {
      out.proof = proof;
      lines.push(`  No active commercial objective. Last run: ${proof.type} — ${proof.amountCents}¢ ${proof.currency} reconciled (job ${proof.jobId}, session ${proof.checkoutSessionId}).`);
      lines.push('  The next tick or "next best action" selects the next opportunity.');
    } else {
      lines.push('  No commercial objective has run yet — the autopilot selects the highest-confidence opportunity on the next tick or "next best action".');
    }
    appendProduction();
    out.text = lines.join('\n');
    return out;
  }

  const waitingOnHuman = !!goal.context?.waitingOnHuman;
  out.stage = waitingOnHuman ? 'WAITING_ON_HUMAN' : (ap.stage || 'select');
  lines.push(`  Stage: ${ap.stage || 'select'}${waitingOnHuman ? ' — WAITING ON HUMAN' : ''}`);

  if (ap.selection) {
    out.opportunity = { id: ap.opportunityId, title: ap.opportunityTitle, confidence: ap.confidence, selection: ap.selection };
    lines.push(`  Opportunity: ${ap.opportunityTitle} (confidence ${ap.confidence}, approval ${ap.approvalStatus || 'unknown'})`);
    lines.push(`  Why this one: ${ap.selection.reason}`);
  } else if (ap.opportunityId) {
    out.opportunity = { id: ap.opportunityId, title: ap.opportunityTitle, confidence: ap.confidence };
    lines.push(`  Opportunity: ${ap.opportunityTitle} (confidence ${ap.confidence})`);
  }

  if (ap.offerId) {
    out.offer = { offerId: ap.offerId, name: ap.offerName, priceCents: ap.priceCents };
    lines.push(`  Offer: ${ap.offerName} — ${ap.priceCents}¢ (catalog offer ${ap.offerId})`);
  }

  if (ap.jobId) {
    try {
      const jm = await loadJobManager(deps);
      const job = await jm.getJob(ap.jobId);
      if (job) {
        out.job = { jobId: job.jobId, paymentStatus: job.paymentStatus, jobStatus: job.jobStatus, deliveryStatus: job.deliveryStatus, checkoutUrl: ap.checkoutUrl };
        lines.push(`  Job ${job.jobId}: payment=${job.paymentStatus} · job=${job.jobStatus} · delivery=${job.deliveryStatus}${job.jobStatus === 'executing' ? ' — EXECUTING now' : ''}${job.jobStatus === 'delivered' ? ` — DELIVERED (${(job.artifactPaths || []).length} artifact(s))` : ''}`);
      }
    } catch { lines.push(`  Job ${ap.jobId}: state unreadable this pass`); }
  }

  if (waitingOnHuman) {
    const w = await waitingReport(svc, goal);
    out.waiting = w;
    lines.push(`  Waiting on human: ${w.satisfied}/${w.total} prerequisites satisfied`);
    for (const p of w.prerequisites) {
      if (['RESOLVED', 'CANCELLED', 'REJECTED'].includes(p.status)) continue;
      lines.push(`    • [${p.status}] ${p.title}${p.missing ? ` — still missing: ${p.missing}` : ''}`);
    }
    lines.push('  After you complete one, say "check again" — the verifier runs independently and the mission resumes on its own.');
  }

  const proof = ap.proof || await lastProvenProof(goals, goal.goalId);
  if (proof) {
    out.proof = proof;
    lines.push(`  Proven: ${proof.type} — ${proof.amountCents}¢ ${proof.currency} reconciled (job ${proof.jobId})`);
  }
  appendProduction();
  out.text = lines.join('\n');
  return out;
}

module.exports = { advance, brief, status, resumeForPayment, OBJECTIVE_TITLE, offerForOpportunity, productionReadiness, PRODUCTION_BOUNDARY_KEYS };
