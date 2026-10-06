'use strict';

/**
 * Human Action verifiers — the "did the human actually do it" check.
 *
 * Verifiers inspect the WORLD and return derived facts only. Secret values
 * (keys, URLs containing credentials) are read to perform the check but are
 * NEVER copied into evidence — evidence carries names, derived public
 * addresses, booleans, and chain-readable numbers only.
 */

const fs = require('fs');
const path = require('path');

const ENV_FILES = ['.env.local', '.env', '.env.production'];

/** Names present in process.env or any env file — values never read into results. */
function envNamePresent(name, { files = ENV_FILES } = {}) {
  if (process.env[name] !== undefined && process.env[name] !== '') return true;
  for (const f of files) {
    const p = path.isAbsolute(f) ? f : path.join(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      if (m && m[1] === name) return true;
    }
  }
  return false;
}

function envValue(name, { files = ENV_FILES } = {}) {
  if (process.env[name]) return process.env[name];
  for (const f of files) {
    const p = path.isAbsolute(f) ? f : path.join(process.cwd(), f);
    if (!fs.existsSync(p)) continue;
    for (const line of fs.readFileSync(p, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
      if (m && m[1] === name) return m[2].trim().replace(/^["']|["']$/g, '');
    }
  }
  return null;
}

/** Verifier: a set of env var NAMES are configured. Spec: { envNames: [] } */
async function verifyEnvVars(spec) {
  const names = spec.envNames || [];
  const present = {};
  let all = true;
  for (const n of names) { present[n] = envNamePresent(n); if (!present[n]) all = false; }
  return { ok: all, evidence: { env_present: present }, reason: all ? null : 'missing: ' + names.filter((n) => !present[n]).join(', ') };
}

/** Verifier: human attests completion with a note. Spec: {} — record marks who attested. */
async function verifyManual() {
  return { ok: false, reason: 'manual action — resolves on human attestation, not auto-check' };
}

function loadEthers() {
  try { return require('ethers'); } catch { /* root has no ethers */ }
  try {
    const { createRequire } = require('module');
    const rrq = createRequire(path.join(process.cwd(), 'protoforge-applications', 'rezonate', 'package.json'));
    return rrq('ethers');
  } catch { return null; }
}

async function rpcCall(rpcUrl, method, params) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const r = await fetch(rpcUrl, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params: params || [] }),
      signal: ctrl.signal
    });
    const j = await r.json();
    if (j.error) throw new Error(j.error.message || 'rpc error');
    return j.result;
  } finally { clearTimeout(t); }
}

/**
 * Verifier: rezonate public-testnet credential gate, executed for real.
 * Spec: { rpcEnv, deployerKeyEnv, buyerKeyEnv, modeEnv, expectedChainId,
 *         minDeployerWei, minBuyerWei }
 * Reads secret VALUES only to use them; evidence contains derived public
 * addresses + booleans + chainId — never keys or the RPC URL.
 */
async function verifyRezonateTestnet(spec) {
  const evidence = {};
  const modeOk = !spec.modeEnv || envValue(spec.modeEnv) === 'testnet';
  evidence.mode_is_testnet = modeOk;
  const rpcUrl = spec.rpcEnv ? envValue(spec.rpcEnv) : null;
  evidence.rpc_configured = !!rpcUrl;
  const missing = [];
  for (const n of [spec.rpcEnv, spec.deployerKeyEnv, spec.buyerKeyEnv].filter(Boolean)) {
    if (!envNamePresent(n)) missing.push(n);
  }
  evidence.env_present = [spec.rpcEnv, spec.deployerKeyEnv, spec.buyerKeyEnv].filter(Boolean)
    .reduce((a, n) => (a[n] = envNamePresent(n), a), {});
  if (missing.length) return { ok: false, evidence, reason: 'missing: ' + missing.join(', ') };

  // RPC reachable + right chain
  try {
    const chainIdHex = await rpcCall(rpcUrl, 'eth_chainId');
    evidence.chainId = parseInt(chainIdHex, 16);
    evidence.rpc_reachable = true;
  } catch (e) {
    evidence.rpc_reachable = false;
    return { ok: false, evidence, reason: 'rpc unreachable: ' + (e.message || 'error') };
  }
  if (spec.expectedChainId && evidence.chainId !== spec.expectedChainId) {
    return { ok: false, evidence, reason: `wrong chain: ${evidence.chainId}, expected ${spec.expectedChainId}` };
  }

  // Derive addresses — public outputs of private keys; never log the keys.
  const ethers = loadEthers();
  if (!ethers) return { ok: false, evidence, reason: 'ethers unavailable — cannot derive wallet addresses' };
  let deployer, buyer;
  try { deployer = new ethers.Wallet(envValue(spec.deployerKeyEnv)).address; }
  catch { return { ok: false, evidence, reason: 'deployer key malformed' }; }
  try { buyer = new ethers.Wallet(envValue(spec.buyerKeyEnv)).address; }
  catch { return { ok: false, evidence, reason: 'buyer key malformed' }; }
  evidence.deployer = deployer;
  evidence.buyer = buyer;
  if (deployer.toLowerCase() === buyer.toLowerCase()) {
    return { ok: false, evidence, reason: 'deployer and buyer must be distinct wallets' };
  }

  // Balances — public chain facts.
  try {
    const [dBal, bBal] = await Promise.all([
      rpcCall(rpcUrl, 'eth_getBalance', [deployer, 'latest']),
      rpcCall(rpcUrl, 'eth_getBalance', [buyer, 'latest'])
    ]);
    evidence.deployer_balance_wei = BigInt(dBal).toString();
    evidence.buyer_balance_wei = BigInt(bBal).toString();
    evidence.deployer_funded = BigInt(dBal) >= BigInt(spec.minDeployerWei || 0);
    evidence.buyer_funded = BigInt(bBal) >= BigInt(spec.minBuyerWei || 0);
  } catch (e) {
    return { ok: false, evidence, reason: 'balance check failed: ' + (e.message || 'error') };
  }
  if (!evidence.deployer_funded) return { ok: false, evidence, reason: 'deployer wallet underfunded' };
  if (!evidence.buyer_funded) return { ok: false, evidence, reason: 'buyer wallet underfunded' };
  if (!modeOk) return { ok: false, evidence, reason: 'REZONATE_CHAIN_MODE is not testnet' };
  return { ok: true, evidence };
}

const VERIFIERS = {
  'env-vars': verifyEnvVars,
  'manual': verifyManual,
  'rezonate-testnet': verifyRezonateTestnet,
};

function runVerifier(name, spec) {
  const v = VERIFIERS[name];
  if (!v) return Promise.resolve({ ok: false, reason: `unknown verifier '${name}'` });
  return v(spec || {});
}

module.exports = { VERIFIERS, runVerifier, envNamePresent, envValue };
