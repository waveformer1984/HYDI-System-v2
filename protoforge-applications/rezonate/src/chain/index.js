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
function createChainAdapter(options = {}) {
  const mode = options.mode || process.env.REZONATE_CHAIN_MODE || 'local';
  if (mode === 'mock') return new MockChainAdapter();
  return new EvmChainAdapter({ ...options, mode });
}

module.exports = { createChainAdapter, EvmChainAdapter, MockChainAdapter };
