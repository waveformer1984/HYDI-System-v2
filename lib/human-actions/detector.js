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
const { envNamePresent } = require('./verifiers');

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

const RULES = [
  {
    key: 'rezonate:testnet-credentials',
    active: () => !['REZONATE_CHAIN_RPC', 'REZONATE_DEPLOYER_KEY', 'REZONATE_BUYER_KEY', 'REZONATE_PUBLIC_URL'].every((n) => envNamePresent(n)),
    spec: REZONATE_TESTNET_SPEC,
  },
  {
    key: 'stripe:e2e-credentials',
    active: () => !['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_ENDPOINT'].every((n) => envNamePresent(n))
      || !['STRIPE_WEBHOOK_SECRET_01', 'STRIPE_WEBHOOK_SECRET'].some((n) => envNamePresent(n)),
    spec: STRIPE_E2E_SPEC,
  },
];

/**
 * Scan all rules; request actions for blockers that are currently real.
 * Returns { checked, requested, alreadyOpen, clear } — replay-safe.
 */
function detectKnownBlockers(service) {
  const svc = service || new HumanActionService();
  const out = { checked: 0, requested: [], alreadyOpen: [], clear: [] };
  for (const rule of RULES) {
    out.checked++;
    if (!rule.active()) { out.clear.push(rule.key); continue; }
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
  const detection = detectKnownBlockers(svc);
  const out = { detection, goalScan: null, verify: null, resume: null };
  out.verify = await verifyEligibleActions(svc, opts.verify || {}).catch((e) => ({ error: e instanceof Error ? e.message : 'verify sweep failed' }));
  if (goals) {
    const { scanEscalatedGoals, resumeSatisfiedGoals } = require('./mission-link');
    out.goalScan = await scanEscalatedGoals(svc, goals).catch((e) => ({ error: e instanceof Error ? e.message : 'scan failed' }));
    out.resume = await resumeSatisfiedGoals(svc, goals).catch((e) => ({ error: e instanceof Error ? e.message : 'resume failed' }));
  }
  return out;
}

module.exports = { detectKnownBlockers, verifyEligibleActions, syncHumanActions, RULES, REZONATE_TESTNET_SPEC, STRIPE_E2E_SPEC };
