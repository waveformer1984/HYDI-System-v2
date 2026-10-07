'use strict';

/**
 * Blocker detector — turns known system gates into Human Actions.
 * Each rule checks a real precondition and requests a dedupe-keyed action
 * only when the precondition genuinely fails. Adding a new human-needed
 * gate = adding one rule here, not a new subsystem.
 *
 * syncHumanActions() is the idempotent cadence entry point: called from
 * surfaces that already run on demand (chat answers, the authenticated
 * API, the COO endpoint) so detection never needs a polling loop and can
 * never duplicate actions — blockerKey dedupe makes re-runs no-ops.
 */

const { HumanActionService } = require('./service');
const { envNamePresent, envValue } = require('./verifiers');

const REZONATE_TESTNET_SPEC = {
  blockerKey: 'rezonate:testnet-credentials',   // keep original key — dedupe continuity for existing records
  type: 'credential',
  boundary: { category: 'CREDENTIAL', externalSystem: 'sepolia', capability: 'rezonate.public-testnet' },
  expectedOutcome: 'Verifier derives both wallet addresses, confirms chainId 11155111, distinct funded wallets, and a public metadata URL — without exposing keys.',
  resumeCapability: 'rezonate-v1.3-public-testnet mission resumes',
  title: 'Configure Rezonate public testnet credentials (Sepolia)',
  description: 'Rezonate V1.3 public-testnet execution is blocked on external credentials only a human can supply. HYDI must never fabricate keys, RPC endpoints, balances, or transactions.',
  priority: 'high',
  instructions: [
    'In .env.local set REZONATE_CHAIN_MODE=testnet',
    'Set REZONATE_CHAIN_RPC to a Sepolia endpoint (free: https://ethereum-sepolia-rpc.publicnode.com, or an Alchemy/Infura free-tier URL)',
    'Set REZONATE_DEPLOYER_KEY to a funded deployer wallet private key (≥ ~0.05 SepoliaETH — free from sepolia faucets)',
    'Set REZONATE_BUYER_KEY to a DISTINCT second funded wallet (≥ listing price + gas)',
    'Set REZONATE_PUBLIC_URL to a publicly reachable https base URL for token metadata/provenance (localhost is dead from a buyer wallet)',
    'Optional: REZONATE_CHAIN_CONFIRMATIONS=2',
    'When done, tell Heidi "I did it" or POST /api/human-actions/<id> {action:"verify"} — the check derives addresses, probes chainId 11155111, confirms wallets are distinct + funded, and pings the public URL — without exposing key material',
  ],
  verifier: {
    name: 'rezonate-testnet',
    spec: {
      modeEnv: 'REZONATE_CHAIN_MODE',
      rpcEnv: 'REZONATE_CHAIN_RPC',
      deployerKeyEnv: 'REZONATE_DEPLOYER_KEY',
      buyerKeyEnv: 'REZONATE_BUYER_KEY',
      publicUrlEnv: 'REZONATE_PUBLIC_URL',
      expectedChainId: 11155111,
      minDeployerWei: '50000000000000000',  // 0.05 ETH — deploys + mint + list
      minBuyerWei: '200000000000000000',    // 0.2 ETH — purchase + gas
    },
  },
  sourceMissionId: 'rezonate-v1.3-public-testnet',
  resumePolicy: 'auto',
  context: { mission: 'REZONATE V1.3', blocker: 'BLOCKED_EXTERNAL_CREDENTIAL' },
};

const STRIPE_E2E_SPEC = {
  blockerKey: 'stripe:e2e-credentials',   // keep original key — dedupe continuity
  type: 'credential',
  boundary: { category: 'CREDENTIAL', externalSystem: 'stripe', capability: 'stripe.e2e-qualification' },
  title: 'Configure Stripe E2E qualification credentials',
  description: 'Stripe E2E qualification is blocked on credentials only a human can supply (StripeE2EOrchestrator BLOCKED_NO_CREDENTIAL / BLOCKED_NO_WEBHOOK_SECRET / BLOCKED_NO_ENDPOINT). HYDI must never fabricate keys or endpoints.',
  priority: 'medium',
  instructions: [
    'Set STRIPE_SECRET_KEY to the account secret key (test-mode sk_test_ for qualification)',
    'Set STRIPE_WEBHOOK_SECRET_01 (or STRIPE_WEBHOOK_SECRET) to the webhook signing secret for the E2E endpoint',
    'Set STRIPE_WEBHOOK_ENDPOINT to the reachable webhook endpoint for E2E qualification',
    'Ensure the Stripe CLI is installed and authenticated (run "stripe login") — this part is not env-verifiable',
    'When done, tell Heidi "I did it" or POST /api/human-actions/<id> {action:"verify"} — the check verifies env presence by NAME only',
  ],
  verifier: {
    name: 'env-vars',
    spec: { envNames: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_ENDPOINT'], anyOfGroups: [['STRIPE_WEBHOOK_SECRET_01'], ['STRIPE_WEBHOOK_SECRET']] },
  },
  expectedOutcome: 'All required env NAMES present — qualification can construct the Stripe client and reach the webhook endpoint.',
  resumeCapability: 'stripe-e2e-qualification mission resumes',
  sourceMissionId: 'stripe-e2e-qualification',
  resumePolicy: 'auto',
  context: { mission: 'Stripe E2E qualification', blocker: 'BLOCKED_NO_CREDENTIAL' },
};

// ─── Production revenue boundaries ─────────────────────────────────────
// These rules cover what separates test-mode qualification from first
// real revenue. They are standing boundaries — durable, dedupe-keyed,
// verified on every sync cadence — deliberately NOT goal-linked: a test
// mission in flight must not be held hostage by live configuration, and
// live configuration must not wait for a mission to exist.

function liveKeyPresent(env) {
  const k = env.envValue('STRIPE_SECRET_KEY');
  return !!k && (k.startsWith('sk_live_') || k.startsWith('rk_live_'));
}

function publicBaseUrlConfigured(env) {
  for (const n of ['NEXT_PUBLIC_APP_URL', 'APP_BASE_URL']) {
    const v = env.envValue(n);
    if (!v || !/^https:\/\//i.test(v)) continue;
    try {
      const host = new URL(v).host;
      if (!/^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/.test(host)) return true;
    } catch { /* malformed — keep looking */ }
  }
  return false;
}

const STRIPE_LIVE_CREDENTIAL_SPEC = {
  blockerKey: 'stripe:live-credential',
  type: 'credential',
  boundary: { category: 'CREDENTIAL', externalSystem: 'stripe', capability: 'revenue.production' },
  title: 'Provide a live Stripe credential for production revenue',
  description: 'The configured STRIPE_SECRET_KEY is missing or test-mode (sk_test_). Test checkouts prove the pipeline but can never produce real revenue — only a live-mode credential can create cs_live_ sessions a real customer can pay.',
  priority: 'high',
  instructions: [
    'In the Stripe dashboard (live mode), create a RESTRICTED key (rk_live_) with write access to Checkout Sessions only — prefer rk_ over sk_ for production',
    'Set STRIPE_SECRET_KEY to that live key in .env.local — never paste it into chat or commit it',
    'Do NOT set ALLOW_LIVE_STRIPE yourself — a live transaction authorization (issued through /api/operations/authorize-transaction) enables it for exactly one scoped transaction, then auto-reverts',
    'Tell Heidi "check again" — the verifier reads only the key prefix (sk_live_/rk_live_), never the secret',
  ],
  verifier: { name: 'stripe-live-credential', spec: {} },
  expectedOutcome: 'STRIPE_SECRET_KEY carries a live-mode prefix; the system can create cs_live_ checkout sessions once authorized.',
  resumeCapability: 'production revenue path unblocked — next checkout attempt proceeds to live-mode (gated by live-transaction authorization)',
  sourceMissionId: 'protoforge-production-revenue',
  resumePolicy: 'auto',
  context: { mission: 'protoforge-production-revenue', blocker: 'STRIPE_CREDENTIAL_TEST_MODE' },
};

const PUBLIC_BASE_URL_SPEC = {
  blockerKey: 'protoforge:public-base-url',
  type: 'deployment',
  boundary: { category: 'DEPLOYMENT', externalSystem: 'dns/https', capability: 'revenue.production' },
  title: 'Configure the public customer-facing base URL',
  description: 'Production checkout success/cancel links and the Stripe webhook endpoint require a public https domain. No public base URL is configured — generated links would point at localhost, unreachable by customers and Stripe.',
  priority: 'high',
  instructions: [
    'Deploy heidi-web to a public https domain (or configure the existing deployment hostname)',
    'Set NEXT_PUBLIC_APP_URL (or APP_BASE_URL) to https://<your-domain> in .env.local',
    'Restart heidi-web so checkout session creation picks it up',
    'Tell Heidi "check again" — the verifier checks the URL is https and not localhost (host name only is evidence)',
  ],
  verifier: { name: 'public-base-url', spec: {} },
  expectedOutcome: 'A public https base URL is configured; checkout links and the webhook path are customer-reachable.',
  resumeCapability: 'production checkout URLs become valid for real customers',
  sourceMissionId: 'protoforge-production-revenue',
  resumePolicy: 'auto',
  context: { mission: 'protoforge-production-revenue', blocker: 'PUBLIC_BASE_URL_UNSET' },
};

const STRIPE_LIVE_WEBHOOK_SPEC = {
  blockerKey: 'stripe:live-webhook-endpoint',
  type: 'credential',
  boundary: { category: 'EXTERNAL_SERVICE', externalSystem: 'stripe', capability: 'revenue.production.webhook' },
  title: 'Configure the live Stripe webhook endpoint',
  description: 'Verified payment requires a live-mode Stripe webhook endpoint delivering checkout.session.completed to /api/webhooks/stripe, plus its signing secret locally. Without it, a real payment cannot be verified — and unverified payment is never revenue.',
  priority: 'high',
  instructions: [
    'Stripe dashboard (live mode) → Developers → Webhooks → Add endpoint: https://<your-domain>/api/webhooks/stripe',
    'Subscribe to: checkout.session.completed, invoice.payment_succeeded, invoice.payment_failed, charge.refunded',
    'Copy the endpoint signing secret (whsec_...) into STRIPE_WEBHOOK_SECRET_01 in .env.local — never paste it into chat',
    'Tell Heidi "check again" — the verifier lists live endpoints via the Stripe API and checks the secret env NAME only',
  ],
  verifier: {
    name: 'stripe-live-webhook-endpoint',
    spec: { path: '/api/webhooks/stripe', requiredEvents: ['checkout.session.completed'] },
  },
  expectedOutcome: 'A live-enabled endpoint delivers checkout.session.completed to /api/webhooks/stripe and its whsec_ is configured locally.',
  resumeCapability: 'verified live payment → job → ledger path is wired end-to-end',
  sourceMissionId: 'protoforge-production-revenue',
  resumePolicy: 'auto',
  context: { mission: 'protoforge-production-revenue', blocker: 'LIVE_WEBHOOK_ENDPOINT_UNVERIFIED' },
};

const WEBHOOK_PROCESSING_SPEC = {
  blockerKey: 'stripe:webhook-processing',
  type: 'config',
  boundary: { category: 'EXTERNAL_SERVICE', externalSystem: 'stripe', capability: 'revenue.production.webhook' },
  title: 'Enable webhook processing (WEBHOOK_PROCESSING_ENABLED)',
  description: 'The webhook handler is paused by the kill switch. No Stripe event — test or live — can be verified or recorded while this is off.',
  priority: 'high',
  instructions: [
    'Set WEBHOOK_PROCESSING_ENABLED=true in .env.local and restart heidi-web',
    'Tell Heidi "check again" — the verifier checks the env NAME only',
  ],
  verifier: { name: 'env-vars', spec: { envNames: ['WEBHOOK_PROCESSING_ENABLED'] } },
  expectedOutcome: 'WEBHOOK_PROCESSING_ENABLED=true — the webhook handler processes events instead of returning "paused".',
  resumeCapability: 'verified webhook events flow to the job bridge and ledger',
  sourceMissionId: 'protoforge-production-revenue',
  resumePolicy: 'auto',
  context: { mission: 'protoforge-production-revenue', blocker: 'WEBHOOK_PROCESSING_DISABLED' },
};

const RULES = [
  {
    key: 'rezonate:testnet-credentials',
    active: (env) => !['REZONATE_CHAIN_RPC', 'REZONATE_DEPLOYER_KEY', 'REZONATE_BUYER_KEY', 'REZONATE_PUBLIC_URL'].every((n) => env.envNamePresent(n)),
    spec: REZONATE_TESTNET_SPEC,
  },
  {
    key: 'stripe:e2e-credentials',
    active: (env) => !['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_ENDPOINT'].every((n) => env.envNamePresent(n))
      || !['STRIPE_WEBHOOK_SECRET_01', 'STRIPE_WEBHOOK_SECRET'].some((n) => env.envNamePresent(n)),
    spec: STRIPE_E2E_SPEC,
  },
  // Production readiness — the standing gap between test-mode proof and
  // first real revenue. The webhook-endpoint rule additionally consults
  // the store: request() dedupes only OPEN actions, so a RESOLVED record
  // must silence the rule or every sync would mint a duplicate.
  {
    key: 'stripe:live-credential',
    active: (env) => !liveKeyPresent(env),
    spec: STRIPE_LIVE_CREDENTIAL_SPEC,
  },
  {
    key: 'protoforge:public-base-url',
    active: (env) => !publicBaseUrlConfigured(env),
    spec: PUBLIC_BASE_URL_SPEC,
  },
  {
    key: 'stripe:live-webhook-endpoint',
    active: (env, svc) => liveKeyPresent(env) && !(svc && svc.list({ includeTerminal: true })
      .some((a) => a.blockerKey === 'stripe:live-webhook-endpoint' && a.status === 'RESOLVED')),
    spec: STRIPE_LIVE_WEBHOOK_SPEC,
  },
  {
    key: 'stripe:webhook-processing',
    active: (env) => env.envValue('WEBHOOK_PROCESSING_ENABLED') !== 'true',
    spec: WEBHOOK_PROCESSING_SPEC,
  },
];

/**
 * Scan all rules; request actions for blockers that are currently real.
 * Returns { checked, requested, alreadyOpen, clear } — replay-safe.
 * env is injectable ({ envNamePresent, envValue }) for hermetic tests.
 */
function detectKnownBlockers(service, env) {
  const svc = service || new HumanActionService();
  const e = env || { envNamePresent, envValue };
  const out = { checked: 0, requested: [], alreadyOpen: [], clear: [] };
  for (const rule of RULES) {
    out.checked++;
    if (!rule.active(e, svc)) { out.clear.push(rule.key); continue; }
    const { action, created } = svc.request(rule.spec);
    (created ? out.requested : out.alreadyOpen).push(action.id);
  }
  return out;
}

/**
 * Periodic verification sweep — the missing half of the protocol. Open
 * actions only used to be verified when a human said "I did it"; this
 * pass re-checks them on the sync cadence (tick/chat/API) so a boundary
 * the world already cleared resolves without anyone telling Heidi.
 *
 * Scope rules (non-negotiable):
 *   - 'manual' verifiers are skipped — nothing machine-checkable exists.
 *   - Throttled per action: an action checked within throttleMs is not
 *     re-run (external verifiers can cost RPC/HTTP calls).
 *   - verify() is the only path to RESOLVED — this sweep changes nothing
 *     about proof semantics; it only decides WHEN checks run.
 */
async function verifyEligibleActions(service, { throttleMs, actor, disabled } = {}) {
  const svc = service || new HumanActionService();
  if (disabled) return { checked: 0, throttled: 0, resolved: [], stillBlocked: [], skipped: 'disabled' };
  const throttle = throttleMs ?? (Number(process.env.HYDI_VERIFY_THROTTLE_MS) || 5 * 60 * 1000);
  const nowMs = Date.now();
  const open = svc.listOpen().filter((a) => a.verifier?.name && a.verifier.name !== 'manual');
  const results = { checked: 0, throttled: 0, resolved: [], stillBlocked: [] };
  for (const a of open) {
    const lastChecked = a.verification?.checkedAt ? Date.parse(a.verification.checkedAt) : 0;
    if (lastChecked && nowMs - lastChecked < throttle) {
      results.throttled++;
      continue;
    }
    try {
      const res = await svc.verify(a.id, actor || 'sync-sweep');
      results.checked++;
      (res.action.status === 'RESOLVED' ? results.resolved : results.stillBlocked)
        .push({ actionId: a.id, reason: res.result?.failureReason || null });
    } catch (e) {
      results.stillBlocked.push({ actionId: a.id, reason: e instanceof Error ? e.message : 'verify error' });
    }
  }
  return results;
}

/**
 * Full synchronization pass — the single call surfaces should make:
 *   1. detect env/config blockers → durable actions
 *   2. scan escalated goals for unlinked human boundaries (when a
 *      GoalSystem-like { listGoals, getGoal, updateGoal } is provided)
 *   3. re-verify open machine-checkable actions (throttled)
 *   4. resume goals whose linked actions are now all RESOLVED
 * Idempotent: dedupe by blockerKey; no goal moves without all linked
 * actions resolved.
 */
async function syncHumanActions(service, goals, opts = {}) {
  const svc = service || new HumanActionService();
  const detection = detectKnownBlockers(svc, opts.env);
  const out = { detection, goalScan: null, verify: null, resume: null };
  out.verify = await verifyEligibleActions(svc, opts.verify || {}).catch((e) => ({ error: e instanceof Error ? e.message : 'verify sweep failed' }));
  if (goals) {
    const { scanEscalatedGoals, resumeSatisfiedGoals } = require('./mission-link');
    out.goalScan = await scanEscalatedGoals(svc, goals).catch((e) => ({ error: e instanceof Error ? e.message : 'scan failed' }));
    out.resume = await resumeSatisfiedGoals(svc, goals).catch((e) => ({ error: e instanceof Error ? e.message : 'resume failed' }));
  }
  return out;
}

module.exports = {
  detectKnownBlockers, verifyEligibleActions, syncHumanActions, RULES,
  REZONATE_TESTNET_SPEC, STRIPE_E2E_SPEC,
  STRIPE_LIVE_CREDENTIAL_SPEC, PUBLIC_BASE_URL_SPEC,
  STRIPE_LIVE_WEBHOOK_SPEC, WEBHOOK_PROCESSING_SPEC,
  liveKeyPresent, publicBaseUrlConfigured,
};
