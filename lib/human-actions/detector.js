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
const { classifyAction, isAgentResolvable } = require('./resolver-policy');
const { getResolver } = require('./resolvers');

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
 * Deploy one resolver through the Agent Control Plane — a durable,
 * dedupe-keyed mission with the minimum declared capability and scope.
 * Deterministic missionId (role+objective+targetKey) makes repeated sync
 * passes collapse onto the same mission; runAgent's advisory claim means
 * the same resolver can never execute twice concurrently. The HYDI agent
 * budget is honored here too: at capacity the attempt defers durably.
 *
 * Returns the resolver outcome read back from the mission record — the
 * agent's claim, never the truth. verify() still decides RESOLVED.
 */
async function deployResolverMission(pool, action, policy, { env, deps }) {
  const acp = require('../heidi/AgentControlPlane');
  const resolver = getResolver(policy.resolverId);
  const state = await acp.collectAgentState(pool).catch(() => null);
  if (state && state.activeCount >= acp.maxActiveAgents()) {
    return { outcome: 'deferred', reason: `agent capacity ${state.activeCount}/${acp.maxActiveAgents()}`, missionId: null };
  }
  const spec = {
    role: policy.agentRole || 'operations',
    objective: `resolve:${action.blockerKey}`,
    targetKey: action.id,
    params: {
      actionId: action.id, blockerKey: action.blockerKey,
      capability: policy.capability, scope: policy.scope,
      resolutionClass: policy.resolutionClass,
    },
    authorizationLevel: 'R1',
    maxRuntimeMs: 60 * 1000,
    maxRetries: 1,
  };
  const m = await acp.createMission(pool, spec);
  const prior = state?.missions?.find((x) => x.missionId === m.missionId);
  // A COMPLETED mission for this action already executed its resolver —
  // don't re-run an identical external mutation. FAILED/PENDING may
  // retry (runAgent's claim refuses RUNNING/COMPLETED/terminal claimants).
  if (!m.created && prior?.status === 'COMPLETED') {
    return { outcome: 'deferred', reason: 'resolver mission already completed for this action', missionId: m.missionId };
  }
  await acp.runAgent(pool, m.missionId, {
    [spec.role]: async ({ heartbeat }) => {
      await heartbeat(`resolver:${policy.resolverId}`);
      const r = await resolver({ action, policy, env, deps: deps || {} });
      return { result: r, evidence: r.evidence ? [r.evidence] : [] };
    },
  });
  const after = await acp.collectAgentState(pool).catch(() => null);
  const mv = after?.missions?.find((x) => x.missionId === m.missionId);
  const r = mv?.result && typeof mv.result === 'object' ? mv.result : null;
  if (mv?.status === 'COMPLETED') {
    return { outcome: r?.outcome || 'completed', reason: r?.reason, evidence: r?.evidence ?? (mv.evidence?.[0] ?? null), missionId: m.missionId };
  }
  return { outcome: 'failed', reason: mv?.failure || `resolver mission ${mv?.status || 'unreadable'}`, missionId: m.missionId };
}

/**
 * Deterministic resolution priority for a durable action. Lower = sooner.
 * Revenue/production boundaries outrank everything (they block the money
 * path and the R1 resolver chain); within a band, the action's declared
 * priority field breaks ties.
 */
function resolutionRank(a) {
  const key = String(a.blockerKey || '');
  const domain = /^(stripe:|revenue:|payment-signal:|protoforge:)/.test(key) ? 0
    : /credential|e2e|testnet/.test(key) ? 1 : 2;
  const pr = a.priority === 'high' ? 0 : a.priority === 'low' ? 2 : 1;
  return domain * 10 + pr;
}

/**
 * Autonomous resolution sweep — the bridge between detection and
 * verification. For every open action:
 *   1. classify the boundary (resolver-policy) and persist the contract
 *   2. R2/R3/R4 → human path; never deploy
 *   3. R0/R1 → check the scoped authorization; missing → durably
 *      'unauthorized', never widened
 *   4. run the resolver (AgentControlPlane mission when a pool exists,
 *      inline bounded call otherwise) and record the attempt
 *   5. a 'completed' claim triggers verify() immediately — the verifier
 *      owns truth, the agent never self-attests
 * Throttled per action so external resolvers cannot hammer providers.
 */
async function resolveEligibleActions(service, { env, throttleMs, pool, deps, actor, disabled } = {}) {
  const svc = service || new HumanActionService();
  if (disabled) return { classified: 0, attempted: [], unauthorized: [], deferred: [], failed: [], human: [], skipped: 'disabled' };
  const e = env || { envNamePresent, envValue };
  const throttle = throttleMs ?? (Number(process.env.HYDI_RESOLVER_THROTTLE_MS) || 5 * 60 * 1000);
  const nowMs = Date.now();
  const helpers = { liveKeyPresent, publicBaseUrlConfigured };
  const out = { classified: 0, attempted: [], unauthorized: [], deferred: [], failed: [], human: [] };
  // Deterministic resolution order (Phase 10): revenue/production
  // boundaries first (they gate the money path), then the action's own
  // priority field, then oldest first — a recorded, explainable order,
  // never whatever the store happens to return.
  const open = svc.listOpen().sort((x, y) => resolutionRank(x) - resolutionRank(y) || String(x.createdAt).localeCompare(String(y.createdAt)));
  for (const a of open) {
    const c = classifyAction(a);
    if (!a.resolver || a.resolver.resolutionClass !== c.resolutionClass || a.resolver.resolverId !== c.resolverId) {
      svc.classifyResolution(a.id, {
        resolutionClass: c.resolutionClass, resolverId: c.resolverId,
        capability: c.capability, scope: c.scope, reason: c.reason,
        actor: actor || 'resolver-sweep',
      });
      out.classified++;
    }
    if (!isAgentResolvable(c.resolutionClass)) {
      out.human.push({ actionId: a.id, class: c.resolutionClass, reason: c.reason });
      continue;
    }
    const resolver = getResolver(c.resolverId);
    if (!resolver) {
      // A policy claiming autonomous resolution without a registered
      // resolver fails closed — recorded once, never silently run.
      svc.recordResolverAttempt(a.id, { outcome: 'unauthorized', detail: `no resolver registered for '${c.resolverId}'`, actor });
      out.unauthorized.push({ actionId: a.id, reason: `no resolver '${c.resolverId}'` });
      continue;
    }
    const fresh = svc.get(a.id);
    const last = fresh?.resolver?.lastAttemptAt ? Date.parse(fresh.resolver.lastAttemptAt) : 0;
    if (last && nowMs - last < throttle) { out.deferred.push({ actionId: a.id, reason: 'throttled' }); continue; }
    const auth = c.authorization?.check ? c.authorization.check(e, helpers) : { granted: true, missing: [] };
    if (!auth.granted) {
      svc.recordResolverAttempt(a.id, {
        outcome: 'unauthorized', actor,
        detail: `missing authorization: ${(auth.missing || []).join('; ') || 'scoped capability absent'}`,
      });
      out.unauthorized.push({ actionId: a.id, reason: auth.missing });
      continue;
    }
    let result;
    // Governance parity: inline execution is an implementation detail,
    // not a lesser authority — the same bounded timeout, idempotency
    // contract, evidence rules, and verifier gate apply either way. A
    // hung resolver must never stall the sweep.
    const timeoutMs = Number(process.env.HYDI_RESOLVER_TIMEOUT_MS) || 30000;
    const run = () => pool
      ? deployResolverMission(pool, svc.get(a.id), c, { env: e, deps })
      : resolver({ action: fresh, policy: c, env: e, deps: deps || {} });
    try {
      result = await Promise.race([
        Promise.resolve().then(run),
        new Promise((_, rej) => {
          const t = setTimeout(() => rej(new Error(`resolver timeout after ${timeoutMs}ms`)), timeoutMs);
          t.unref?.();
        }),
      ]);
    } catch (err) {
      result = { outcome: 'failed', reason: err instanceof Error ? err.message : 'resolver error' };
    }
    svc.recordResolverAttempt(a.id, {
      outcome: result.outcome, detail: result.reason, evidence: result.evidence,
      missionId: result.missionId ?? null, actor,
    });
    const bucket = result.outcome === 'completed' || result.outcome === 'partial' ? out.attempted
      : result.outcome === 'deferred' ? out.deferred
        : result.outcome === 'unauthorized' ? out.unauthorized : out.failed;
    bucket.push({ actionId: a.id, outcome: result.outcome, reason: result.reason || null });
    // The resolver's claim is never truth — verify() independently decides.
    if (result.outcome === 'completed') {
      try { await svc.verify(a.id, actor || 'resolver-sweep'); } catch { /* verifier sweep reports it */ }
    }
  }
  return out;
}

/**
 * Full synchronization pass — the single call surfaces should make:
 *   1. detect env/config blockers → durable actions
 *   2. classify + attempt autonomous resolution where authorized
 *   3. re-verify open machine-checkable actions (throttled) — including
 *      the ones resolvers just claimed to complete
 *   4. scan escalated goals for unlinked human boundaries (when a
 *      GoalSystem-like { listGoals, getGoal, updateGoal } is provided)
 *   5. resume goals whose linked actions are now all RESOLVED
 * Idempotent: dedupe by blockerKey; no goal moves without all linked
 * actions resolved; resolvers are adopt-before-create.
 */
/**
 * Stale public-base-URL detector — the async half of deployment truth.
 * The public-base-url rule fires when no URL is configured; this pass
 * fires when a configured URL has gone dead or no longer matches a live
 * tunnel (ngrok free URLs rotate on restart — the env var silently goes
 * stale without this check).
 *
 * Detects two real failure modes:
 *   1. HEAD on the configured URL fails (down/tunnel dead)
 *   2. a local ngrok API answers and the env host is not among its
 *      tunnel hosts (the tunnel was replaced — URL is stale)
 * A reachable real domain or absent tunnel API (no tunnel running by
 * design) does not trip it. The action's verifier is http-reachable on
 * the env name, so fixing the URL (or restoring the tunnel) auto-resolves.
 */
const STALE_BASE_URL_SPEC = {
  blockerKey: 'protoforge:public-base-url-stale',
  type: 'deployment',
  boundary: { category: 'DEPLOYMENT', externalSystem: 'dns/https', capability: 'revenue.production' },
  title: 'Public base URL is configured but unreachable or stale',
  description: 'The configured public base URL does not answer, or the running tunnel no longer matches it. Customer-facing links (checkout success/cancel, webhook path) would point at a dead host.',
  priority: 'high',
  instructions: [
    'If using the supervised ngrok tunnel: check http://localhost:4040/api/tunnels for the live public URL and update NEXT_PUBLIC_APP_URL/APP_BASE_URL in .env.local',
    'If a real domain was deployed: set NEXT_PUBLIC_APP_URL to the live https origin',
    'Tell Heidi "check again" — the verifier HEAD-requests the CURRENT env value, so a corrected URL resolves this automatically',
  ],
  verifier: { name: 'http-reachable', spec: {} }, // spec.urlEnv filled at detection time
  expectedOutcome: 'The configured base URL answers over public https.',
  resumeCapability: 'public checkout/webhook links valid again',
};

async function detectStaleBaseUrl(service, env, opts = {}) {
  const svc = service || new HumanActionService();
  const e = env || { envNamePresent, envValue };
  const name = ['NEXT_PUBLIC_APP_URL', 'APP_BASE_URL'].find((n) => e.envValue(n));
  const url = name ? e.envValue(name) : null;
  if (!url) return { checked: false, reason: 'no base URL configured' };
  let staleReason = null;
  const fetchFn = (opts && opts.fetch) || globalThis.fetch;
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), opts.timeoutMs || 8000);
    const r = await fetchFn(url, { method: 'HEAD', signal: ctrl.signal }).finally(() => clearTimeout(t));
    if (!r.ok) staleReason = `configured URL returned HTTP ${r.status}`;
  } catch (err) {
    staleReason = 'configured URL unreachable: ' + (err instanceof Error ? err.message : 'error');
  }
  // Tunnel-identity check — only when a local ngrok API actually answers.
  if (!staleReason) {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 3000);
      const r = await fetchFn('http://localhost:4040/api/tunnels', { signal: ctrl.signal }).finally(() => clearTimeout(t));
      if (r.ok) {
        const data = await r.json().catch(() => null);
        const hosts = new Set((data && data.tunnels || [])
          .map((tn) => { try { return new URL(tn.public_url).host; } catch { return null; } })
          .filter(Boolean));
        const envHost = new URL(url).host;
        if (hosts.size && !hosts.has(envHost)) {
          staleReason = `env host ${envHost} not among live tunnels (${[...hosts].join(', ')}) — tunnel was replaced`;
        }
      }
    } catch { /* no tunnel API — real domain or no tunnel by design */ }
  }
  if (!staleReason) return { checked: true, stale: false };
  const spec = { ...STALE_BASE_URL_SPEC, verifier: { name: 'http-reachable', spec: { urlEnv: name } } };
  const { action, created } = svc.request(spec);
  return { checked: true, stale: true, staleReason, actionId: action.id, created };
}

async function syncHumanActions(service, goals, opts = {}) {
  const svc = service || new HumanActionService();
  const detection = detectKnownBlockers(svc, opts.env);
  const out = { detection, goalScan: null, resolve: null, verify: null, resume: null, staleBaseUrl: null };
  out.staleBaseUrl = await detectStaleBaseUrl(svc, opts.env, opts.staleCheck || {}).catch((e) => ({ error: e instanceof Error ? e.message : 'stale check failed' }));
  out.resolve = await resolveEligibleActions(svc, {
    env: opts.env, pool: opts.pool, deps: opts.resolverDeps, actor: opts.actor,
    ...(opts.resolve || {}),
  }).catch((e) => ({ error: e instanceof Error ? e.message : 'resolve sweep failed' }));
  out.verify = await verifyEligibleActions(svc, opts.verify || {}).catch((e) => ({ error: e instanceof Error ? e.message : 'verify sweep failed' }));
  if (goals) {
    const { scanEscalatedGoals, resumeSatisfiedGoals } = require('./mission-link');
    out.goalScan = await scanEscalatedGoals(svc, goals).catch((e) => ({ error: e instanceof Error ? e.message : 'scan failed' }));
    out.resume = await resumeSatisfiedGoals(svc, goals).catch((e) => ({ error: e instanceof Error ? e.message : 'resume failed' }));
  }
  return out;
}

module.exports = {
  detectKnownBlockers, detectStaleBaseUrl, verifyEligibleActions, resolveEligibleActions, syncHumanActions, RULES,
  REZONATE_TESTNET_SPEC, STRIPE_E2E_SPEC,
  STRIPE_LIVE_CREDENTIAL_SPEC, PUBLIC_BASE_URL_SPEC,
  STRIPE_LIVE_WEBHOOK_SPEC, WEBHOOK_PROCESSING_SPEC,
  liveKeyPresent, publicBaseUrlConfigured,
};
