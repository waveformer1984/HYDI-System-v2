const { EvmChainAdapter } = require('./evm-chain-adapter');
const { MockChainAdapter } = require('./mock-chain-adapter');

/**
 * Chain adapter factory.
 * REZONATE_CHAIN_MODE: local | testnet | mainnet | mock
 *   local   — real local EVM node (proving environment; default)
 *   testnet — REZONATE_CHAIN_RPC + REZONATE_DEPLOYER_KEY required
 *   mainnet — additionally requires ALLOW_LIVE_CHAIN=true
 *   mock    — unit tests only; stamped isMock
 */
/**
 * Wallet keys for non-deployer signers (e.g. the second/buyer wallet on a
 * public testnet sale). Sources, in priority order:
 *   options.walletKeys            — explicit { address: privateKey } map
 *   REZONATE_WALLET_KEYS          — JSON map { "0xAddr": "0xKey" }
 *   REZONATE_BUYER_KEY            — single buyer key; address derived
 * Values are never logged or written anywhere — they only reach the adapter.
 */
function walletKeysFromEnv() {
  const keys = {};
  const raw = process.env.REZONATE_WALLET_KEYS;
  if (raw) {
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error('REZONATE_WALLET_KEYS is not valid JSON ({"0xAddr":"0xKey"})'); }
    for (const [addr, key] of Object.entries(parsed)) keys[addr.toLowerCase()] = key;
  }
  const buyer = process.env.REZONATE_BUYER_KEY;
  if (buyer) {
    const { ethers } = require('ethers');
    const w = new ethers.Wallet(buyer);
    keys[w.address.toLowerCase()] = buyer;
  }
  return keys;
}

function createChainAdapter(options = {}) {
  const mode = options.mode || process.env.REZONATE_CHAIN_MODE || 'local';
  if (mode === 'mock') return new MockChainAdapter();
  return new EvmChainAdapter({
    confirmations: Number(process.env.REZONATE_CHAIN_CONFIRMATIONS || 1),
    walletKeys: walletKeysFromEnv(),
    ...options, mode
  });
}

module.exports = { createChainAdapter, walletKeysFromEnv, EvmChainAdapter, MockChainAdapter };
