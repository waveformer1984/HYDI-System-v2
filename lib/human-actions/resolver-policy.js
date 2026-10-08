'use strict';

/**
 * Resolution policy — the governed answer to "who can legitimately close
 * this Human Action".
 *
 * Every durable Human Action classifies into exactly one resolution
 * class (the mission vocabulary — deliberately distinct from the agent
 * autonomy levels used by AgentControlPlane.authorizationLevel):
 *
 *   R0 — AUTONOMOUSLY RESOLVABLE
 *        An existing authorized capability can complete the boundary
 *        with no new human authorization. A resolver is deployed on the
 *        sync cadence; the verifier still owns the RESOLVED verdict.
 *
 *   R1 — AUTONOMOUS WITH SCOPED AUTHORIZATION
 *        A resolver can complete it once a narrow, per-blocker
 *        authorization is present (e.g. a live Stripe credential that
 *        permits webhookEndpoints.create). The authorization check runs
 *        on every attempt — a missing prerequisite defers, never widens
 *        scope.
 *
 *   R2 — HUMAN AUTHORIZATION / INPUT REQUIRED
 *        The provider requires a human decision, dashboard action,
 *        payment, consent, or a value no connected system can supply.
 *        No agent is deployed; the action stays the precise human ask.
 *
 *   R3 — PHYSICAL / IRREDUCIBLY HUMAN
 *        Hardware access, possession-based auth, physical presence.
 *
 *   R4 — PROHIBITED
 *        Resolution would violate a production gate or security policy.
 *        Fail closed — no executable mission is ever created.
 *
 * Registry entries are keyed by blockerKey and declare the MINIMUM
 * capability a resolver needs — never broader. Unregistered blockers
 * fall through to classifyByBoundary(), which is fail-closed: unknown
 * boundaries classify as human-path (R2/R3), never autonomously.
 *
 * A policy entry answers: class, resolverId, capability, scope,
 * authorization check, and the honest reason — everything the COO/chat
 * surface needs to say WHO is resolving it or WHY a human is required.
 */

// ─── Policy registry (blockerKey → resolution contract) ──────────────────
// resolverId must exist in resolvers.js RESOLVERS for R0/R1 classes —
// a class without a resolver is treated as unavailable (fail-closed),
// never silently executed by a different mechanism.

const RESOLUTION_POLICY = {
  // HYDI owns this flag: ProductionOperationsControlPlane classifies
  // WEBHOOK_PROCESSING_DISABLED owner:'hydi' AUTO_RESOLVABLE, and the
  // ConfigurationControlPlane descriptor is autoModifiable. The resolver
  // re-checks canAutoModify at execution time — a future descriptor change
  // flips this boundary to unauthorized without any code change here.
  'stripe:webhook-processing': {
    resolutionClass: 'R0',
    resolverId: 'config-set',
    agentRole: 'operations',
    capability: 'config.write',
    scope: { key: 'WEBHOOK_PROCESSING_ENABLED', value: 'true' },
    reason: 'WEBHOOK_PROCESSING_ENABLED is a HYDI-owned, auto-modifiable config key — the governed ConfigurationControlPlane can set it atomically with audit + rollback.',
    humanFallback: 'set WEBHOOK_PROCESSING_ENABLED=true in .env.local',
  },

  // R1: the Stripe API genuinely supports webhookEndpoints.list/create —
  // but only under a live credential, and the target URL only exists once
  // a public base URL is configured. Both are checked per attempt; the
  // upstream actions remain the human-path boundaries until resolved.
  'stripe:live-webhook-endpoint': {
    resolutionClass: 'R1',
    resolverId: 'stripe-webhook-endpoint',
    agentRole: 'operations',
    capability: 'stripe.webhookEndpoints.write',
    scope: { path: '/api/webhooks/stripe', events: ['checkout.session.completed', 'invoice.payment_succeeded', 'invoice.payment_failed', 'charge.refunded'], secretEnv: 'STRIPE_WEBHOOK_SECRET_01' },
    authorization: {
      // {granted, missing[]} — every prerequisite is another durable boundary
      check: (env, helpers) => {
        const missing = [];
        if (!helpers.liveKeyPresent(env)) missing.push('live Stripe credential (stripe:live-credential)');
        if (!helpers.publicBaseUrlConfigured(env)) missing.push('public base URL (protoforge:public-base-url)');
        return { granted: missing.length === 0, missing };
      },
    },
    reason: 'stripe.webhookEndpoints.list/create is a real provider API — creating an endpoint mutates no money and its signing secret is the only deliverable.',
    humanFallback: 'create the endpoint in the Stripe dashboard and set STRIPE_WEBHOOK_SECRET_01 in .env.local',
  },

  // R2: Stripe exposes NO API to create secret or restricted keys —
  // dashboard-only by Stripe's own design. No connected capability can
  // produce this credential; it is irreducibly an operator action.
  'stripe:live-credential': {
    resolutionClass: 'R2',
    resolverId: null,
    capability: 'stripe.dashboard.restricted_key.create',
    scope: null,
    reason: 'Stripe provides no API for creating API keys — a restricted rk_live_ key can only be created by a human in the Stripe dashboard. Autonomous resolution is unavailable: no connected system holds this authority.',
    humanFallback: 'create a restricted rk_live_ key in the Stripe dashboard and set STRIPE_SECRET_KEY in .env.local',
  },

  // R2: the domain value must come from a human/deployment decision — no
  // connected registrar or deploy provider exists to choose or supply it.
  'protoforge:public-base-url': {
    resolutionClass: 'R2',
    resolverId: null,
    capability: 'deployment.hostname.assign',
    scope: null,
    reason: 'No connected DNS registrar or deployment provider can supply the hostname — the public domain is an operator decision.',
    humanFallback: 'deploy heidi-web to a public https domain and set NEXT_PUBLIC_APP_URL in .env.local',
  },

  // R2: E2E qualification needs real account credentials + a CLI session —
  // none can be fabricated or provisioned by an agent.
  'stripe:e2e-credentials': {
    resolutionClass: 'R2',
    resolverId: null,
    capability: 'stripe.account.credentials',
    scope: null,
    reason: 'Account credentials and `stripe login` are human-supplied — never fabricated.',
    humanFallback: 'set STRIPE_SECRET_KEY, STRIPE_WEBHOOK_ENDPOINT and a webhook secret in .env.local',
  },

  // R2: wallets could be generated but Sepolia funding requires a faucet —
  // the irreducible human step is funding, so the whole action stays human.
  'rezonate:testnet-credentials': {
    resolutionClass: 'R2',
    resolverId: null,
    capability: 'sepolia.faucet.funding',
    scope: null,
    reason: 'RPC URL and keys are operator-supplied; funded testnet wallets require faucet interaction no connected system can perform.',
    humanFallback: 'set the Sepolia RPC + two funded wallet keys + public URL in .env.local',
  },

  // R2: live transactions require a human-issued single-use authorization —
  // this IS the human gate, not a boundary an agent may cross.
  'stripe:live-transaction-authorization': {
    resolutionClass: 'R2',
    resolverId: null,
    capability: 'operations.authorize-transaction',
    scope: null,
    reason: 'Per-transaction live authorization is a deliberate human financial decision — the system must never grant it to itself.',
    humanFallback: 'approve via /api/operations/authorize-transaction',
  },
};

// ─── Category fallback (fail-closed) ─────────────────────────────────────
// Unregistered blockers classify by boundary category. Nothing defaults
// to autonomous — a boundary we don't understand is a human's job.

const CATEGORY_CLASS = {
  PHYSICAL_ACTION: 'R3',
  PAYMENT: 'R2',           // an external payment is a human/customer act
  AUTHORIZATION: 'R2',     // approval/authorization decisions are human
  CREDENTIAL: 'R2',        // secrets are never fabricated or fetched broadly
  ACCOUNT_SETUP: 'R2',
  DOMAIN: 'R2',
  DEPLOYMENT: 'R2',
  FUNDING: 'R2',
  CUSTOMER_ACTION: 'R2',
  COMPLIANCE: 'R2',
  EXTERNAL_SERVICE: 'R2',
  OTHER: 'R2',
};

/**
 * Classify one action into its resolution contract.
 * Returns { resolutionClass, resolverId, capability, scope, reason,
 *           humanFallback, authorizationCheck } — a snapshot safe to
 * persist on the action (functions stripped for durability).
 */
function classifyAction(action) {
  const spec = RESOLUTION_POLICY[action?.blockerKey];
  if (spec) {
    return {
      resolutionClass: spec.resolutionClass,
      resolverId: spec.resolverId ?? null,
      agentRole: spec.agentRole ?? 'operations',
      capability: spec.capability ?? null,
      scope: spec.scope ?? null,
      authorization: spec.authorization ?? null,
      reason: spec.reason,
      humanFallback: spec.humanFallback ?? null,
    };
  }
  const category = action?.boundary?.category || 'OTHER';
  return {
    resolutionClass: CATEGORY_CLASS[category] || 'R2',
    resolverId: null,
    agentRole: 'operations',
    capability: null,
    scope: null,
    authorization: null,
    reason: `no registered resolver for boundary ${category} — fail-closed: the human path applies`,
    humanFallback: null,
  };
}

/** Is this class one an authorized agent may attempt? */
function isAgentResolvable(resolutionClass) {
  return resolutionClass === 'R0' || resolutionClass === 'R1';
}

module.exports = { RESOLUTION_POLICY, CATEGORY_CLASS, classifyAction, isAgentResolvable };
