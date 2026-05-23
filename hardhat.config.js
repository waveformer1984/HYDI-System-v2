require("@nomicfoundation/hardhat-toolbox");
// Load .env.local for Web3/agent-registry vars (PRIVATE_KEY, WEB3_PROVIDER_URL, HYDI_AGENT_REGISTRY_*)
require("dotenv").config({ path: ".env.local" });
// Fall back to .env.hydicoin for legacy HydiCoin deployment vars
require("dotenv").config({ path: ".env.hydicoin" });

// Prefer PRIVATE_KEY (.env.local) over ORCHESTRATOR_PRIVATE_KEY (.env.hydicoin).
// Guard: Hardhat validates all configured accounts at startup; skip placeholder keys.
const _rawKey   = process.env.PRIVATE_KEY || process.env.ORCHESTRATOR_PRIVATE_KEY || '';
const _keyHex   = _rawKey.startsWith('0x') ? _rawKey.slice(2) : _rawKey;
const _keyValid = /^[0-9a-fA-F]{64}$/.test(_keyHex);
const accounts  = _keyValid ? [_rawKey] : [];

/** @type import('hardhat/config').HardhatUserConfig */
module.exports = {
  solidity: {
    version: "0.8.24",
    settings: {
      optimizer: { enabled: true, runs: 200 }
    }
  },
  networks: {
    // ── Local development node (npx hardhat node) ──────────────────────────
    localhost: {
      url: "http://127.0.0.1:8545",
      chainId: 31337
    },

    // ── Holesky testnet (primary HYDI agent testing chain) ─────────────────
    holesky: {
      url: process.env.WEB3_PROVIDER_URL || "https://ethereum-holesky.publicnode.com",
      accounts,
      chainId: 17000
    },

    // ── Existing production/staging networks ───────────────────────────────
    sepolia: {
      url: process.env.RPC_PROVIDER_URL || "https://sepolia.infura.io/v3/YOUR_INFURA_KEY",
      accounts,
      chainId: 11155111
    },
    arbitrum: {
      url: process.env.RPC_PROVIDER_URL || "https://arb-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY",
      accounts,
      chainId: 421614
    },
    base: {
      url: process.env.RPC_PROVIDER_URL || "https://base-sepolia.g.alchemy.com/v2/YOUR_ALCHEMY_KEY",
      accounts,
      chainId: 84532
    },
    mainnet: {
      url: process.env.RPC_PROVIDER_URL || "https://eth-mainnet.g.alchemy.com/v2/YOUR_ALCHEMY_KEY",
      accounts,
      chainId: 1
    }
  },

  // etherscan / blockscout verification (bundled in hardhat-toolbox)
  etherscan: {
    apiKey: {
      holesky:       process.env.ETHERSCAN_API_KEY || "",
      sepolia:       process.env.ETHERSCAN_API_KEY || "",
      arbitrumSepolia: process.env.ARBISCAN_API_KEY || "",
      baseSepolia:   process.env.BASESCAN_API_KEY || "",
      mainnet:       process.env.ETHERSCAN_API_KEY || ""
    }
  },

  // Gas reporter (activated with REPORT_GAS=true in env)
  gasReporter: {
    enabled: process.env.REPORT_GAS === "true",
    currency: "USD"
  },

  // Compile only HYDI core contracts — excludes legacy HydiCoin contracts that
  // require a separate OZ v4-compatible toolchain.
  paths: {
    sources:   "./contracts/core",
    tests:     "./test",
    cache:     "./cache",
    artifacts: "./artifacts"
  }
};
