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
  blockerKey: 'rezonate:testnet-credentials',
  type: 'credential',
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
  blockerKey: 'stripe:e2e-credentials',
  type: 'credential',
  title: 'Configure Stripe E2E qualification credentials',
  description: 'Stripe E2E qualification is blocked on credentials only a human can supply (StripeE2EOrchestrator BLOCKED_NO_CREDENTIAL / BLOCKED_NO_ENDPOINT). HYDI must never fabricate keys or endpoints.',
  priority: 'medium',
  instructions: [
    'Set STRIPE_SECRET_KEY to the account secret key (test-mode sk_test_ for qualification)',
    'Set STRIPE_WEBHOOK_ENDPOINT to the reachable webhook endpoint for E2E qualification',
    'Ensure the Stripe CLI is installed and authenticated (run "stripe login") — this part is not env-verifiable',
    'When done, tell Heidi "I did it" or POST /api/human-actions/<id> {action:"verify"} — the check verifies env presence by NAME only',
  ],
  verifier: {
    name: 'env-vars',
    spec: { envNames: ['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_ENDPOINT'] },
  },
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
    active: () => !['STRIPE_SECRET_KEY', 'STRIPE_WEBHOOK_ENDPOINT'].every((n) => envNamePresent(n)),
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
 * Full synchronization pass — the single call surfaces should make:
 *   1. detect env/config blockers → durable actions
 *   2. scan escalated goals for unlinked human boundaries (when a
 *      GoalSystem-like { listGoals, getGoal, updateGoal } is provided)
 *   3. resume goals whose linked actions are now all RESOLVED
 * Idempotent: dedupe by blockerKey; no goal moves without all linked
 * actions resolved.
 */
async function syncHumanActions(service, goals) {
  const svc = service || new HumanActionService();
  const detection = detectKnownBlockers(svc);
  const out = { detection, goalScan: null, resume: null };
  if (goals) {
    const { scanEscalatedGoals, resumeSatisfiedGoals } = require('./mission-link');
    out.goalScan = await scanEscalatedGoals(svc, goals).catch((e) => ({ error: e instanceof Error ? e.message : 'scan failed' }));
    out.resume = await resumeSatisfiedGoals(svc, goals).catch((e) => ({ error: e instanceof Error ? e.message : 'resume failed' }));
  }
  return out;
}

module.exports = { detectKnownBlockers, syncHumanActions, RULES, REZONATE_TESTNET_SPEC, STRIPE_E2E_SPEC };
