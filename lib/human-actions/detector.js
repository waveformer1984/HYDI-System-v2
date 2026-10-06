'use strict';

/**
 * Blocker detector — turns known system gates into Human Actions.
 * Each rule checks a real precondition and requests a dedupe-keyed action
 * only when the precondition genuinely fails. Adding a new human-needed
 * gate = adding one rule here, not a new subsystem.
 */

const { HumanActionService } = require('./service');
const { envNamePresent } = require('./verifiers');

const REZONATE_TESTNET_SPEC = {
  blockerKey: 'rezonate:testnet-credentials',
  kind: 'credential',
  title: 'Configure Rezonate public testnet credentials (Sepolia)',
  priority: 'high',
  instructions: [
    'In .env.local set REZONATE_CHAIN_MODE=testnet',
    'Set REZONATE_CHAIN_RPC to a Sepolia endpoint (free: https://ethereum-sepolia-rpc.publicnode.com, or an Alchemy/Infura free-tier URL)',
    'Set REZONATE_DEPLOYER_KEY to a funded deployer wallet private key (≥ ~0.05 SepoliaETH — free from sepolia faucets)',
    'Set REZONATE_BUYER_KEY to a DISTINCT second funded wallet (≥ listing price + gas)',
    'Set REZONATE_PUBLIC_URL to a publicly reachable https base URL for token metadata/provenance',
    'Optional: REZONATE_CHAIN_CONFIRMATIONS=2',
    'When done, ask Heidi to verify (or POST /api/human-actions/<id>/verify) — the check derives addresses, probes chainId 11155111, and confirms balances without exposing keys',
  ],
  verification: {
    verifier: 'rezonate-testnet',
    spec: {
      modeEnv: 'REZONATE_CHAIN_MODE',
      rpcEnv: 'REZONATE_CHAIN_RPC',
      deployerKeyEnv: 'REZONATE_DEPLOYER_KEY',
      buyerKeyEnv: 'REZONATE_BUYER_KEY',
      expectedChainId: 11155111,
      minDeployerWei: '50000000000000000',  // 0.05 ETH — deploys + mint + list
      minBuyerWei: '200000000000000000',    // 0.2 ETH — purchase + gas
    },
  },
  context: { mission: 'REZONATE V1.3', blocker: 'BLOCKED_EXTERNAL_CREDENTIAL' },
};

const RULES = [
  {
    key: 'rezonate:testnet-credentials',
    active: () => !['REZONATE_CHAIN_RPC', 'REZONATE_DEPLOYER_KEY', 'REZONATE_BUYER_KEY', 'REZONATE_PUBLIC_URL'].every((n) => envNamePresent(n)),
    spec: REZONATE_TESTNET_SPEC,
  },
];

/**
 * Scan all rules; request actions for blockers that are currently real.
 * Returns { checked, requested, alreadyOpen } — replay-safe.
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

module.exports = { detectKnownBlockers, RULES };
