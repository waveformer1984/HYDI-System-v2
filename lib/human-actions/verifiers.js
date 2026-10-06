'use strict';

/**
 * Human Action verifiers — the "did the human actually do it" check.
 *
 * Verifier registry (closed set — persisted verifier names resolve only
 * against functions defined here; an unknown name fails closed, never
 * dynamically executes):
 *
 *   env-vars          — a set of env var NAMES exist (names, not values)
 *   manual            — no machine check; resolves by human attestation
 *   rezonate-testnet  — full Sepolia credential gate, executed for real
 *   http-reachable    — a public URL responds (metadata/provenance probes)
 *
 * Verifiers inspect the WORLD and return derived facts only. Secret values
 * (keys, URLs containing credentials) are read to perform the check but are
 * NEVER copied into evidence — evidence carries names, derived public
 * addresses, booleans, and chain-readable numbers only.
 *
 * Durable result shape:
 *   { verificationId, verifier, checkedAt, passed,
 *     checks: [{ name, passed, detail }],   — one row per invariant
 *     evidence,                              — derived facts only
 *     safeSummary, failureReason }
 */

const crypto = require('crypto');
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

function check(name, passed, detail) { return { name, passed: !!passed, detail: detail ?? null }; }

/** Verifier: a set of env var NAMES are configured. Spec: { envNames: [] } */
async function verifyEnvVars(spec) {
  const names = spec.envNames || [];
  const checks = names.map((n) => check(`env present: ${n}`, envNamePresent(n)));
  const missing = names.filter((n) => !envNamePresent(n));
  return {
    ok: missing.length === 0,
    checks,
    evidence: { env_present: names.reduce((a, n) => (a[n] = envNamePresent(n), a), {}) },
    reason: missing.length ? 'missing: ' + missing.join(', ') : null,
  };
}

/** Verifier: human attests completion with a note. Spec: {} — record marks who attested. */
async function verifyManual() {
  return { ok: false, checks: [check('machine verification', false, 'no automated check exists for this action')], reason: 'manual action — resolves on human attestation, not auto-check' };
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
 * Verifier: a public URL responds over HTTP(S). Spec: { urlEnv } or { url }.
 * The URL value itself is evidence-safe only when it contains no
 * credentials — URLs with a userinfo component are reported as configured
 * but never echoed.
 */
async function verifyHttpReachable(spec) {
  const url = spec.url || (spec.urlEnv ? envValue(spec.urlEnv) : null);
  const checks = [];
  if (!url) {
    checks.push(check('url configured', false, spec.urlEnv ? `${spec.urlEnv} not set` : 'no url in spec'));
    return { ok: false, checks, reason: spec.urlEnv ? `missing: ${spec.urlEnv}` : 'no url configured' };
  }
  const hasUserinfo = /@|:\/\/.+:.+@/.test(url.replace(/^\w+:\/\//, '')) || /\/\/[^/]*@/.test(url);
  checks.push(check('url configured', true, hasUserinfo ? 'configured (contains credentials — value withheld)' : url));
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const r = await fetch(url, { method: 'HEAD', signal: ctrl.signal }).finally(() => clearTimeout(t));
    checks.push(check('reachable', r.ok, `HTTP ${r.status}`));
    return { ok: r.ok, checks, evidence: { http_status: r.status }, reason: r.ok ? null : `HTTP ${r.status}` };
  } catch (e) {
    checks.push(check('reachable', false, e.message || 'fetch failed'));
    return { ok: false, checks, reason: 'unreachable: ' + (e.message || 'error') };
  }
}

/**
 * Verifier: rezonate public-testnet credential gate, executed for real.
 * Spec: { rpcEnv, deployerKeyEnv, buyerKeyEnv, modeEnv, publicUrlEnv,
 *         expectedChainId, minDeployerWei, minBuyerWei }
 * Reads secret VALUES only to use them; checks/evidence contain derived
 * public addresses + booleans + chainId — never keys or the RPC URL.
 */
async function verifyRezonateTestnet(spec) {
  const checks = [];
  const evidence = {};
  const fail = (reason) => ({ ok: false, checks, evidence, reason });

  // 1. env presence (names only)
  const envs = [spec.modeEnv, spec.rpcEnv, spec.deployerKeyEnv, spec.buyerKeyEnv, spec.publicUrlEnv].filter(Boolean);
  const missing = envs.filter((n) => !envNamePresent(n));
  for (const n of envs) checks.push(check(`env present: ${n}`, envNamePresent(n)));
  evidence.env_present = envs.reduce((a, n) => (a[n] = envNamePresent(n), a), {});
  if (missing.length) return fail('missing: ' + missing.join(', '));

  // 2. mode is testnet (never mainnet — that would be a different gate)
  const mode = spec.modeEnv ? envValue(spec.modeEnv) : null;
  checks.push(check('chain mode is testnet', !spec.modeEnv || mode === 'testnet', mode ? `mode=${mode}` : 'no mode env'));
  if (spec.modeEnv && mode !== 'testnet') return fail(`${spec.modeEnv} is '${mode}', expected 'testnet'`);

  // 3. RPC reachable + right chain
  const rpcUrl = envValue(spec.rpcEnv);
  let chainId;
  try {
    chainId = parseInt(await rpcCall(rpcUrl, 'eth_chainId'), 16);
    checks.push(check('RPC reachable', true, 'eth_chainId responded'));
    checks.push(check(`chainId == ${spec.expectedChainId}`, chainId === spec.expectedChainId, `got ${chainId}`));
    evidence.chainId = chainId;
    evidence.rpc_reachable = true;
  } catch (e) {
    checks.push(check('RPC reachable', false, e.message || 'error'));
    evidence.rpc_reachable = false;
    return fail('rpc unreachable: ' + (e.message || 'error'));
  }
  if (spec.expectedChainId && chainId !== spec.expectedChainId) {
    return fail(`wrong chain: ${chainId}, expected ${spec.expectedChainId}`);
  }

  // 4. derive addresses — public outputs of private keys; never log keys
  const ethers = loadEthers();
  if (!ethers) return fail('ethers unavailable — cannot derive wallet addresses');
  let deployer, buyer;
  try { deployer = new ethers.Wallet(envValue(spec.deployerKeyEnv)).address; }
  catch { checks.push(check('deployer key derivable', false, 'malformed')); return fail('deployer key malformed'); }
  try { buyer = new ethers.Wallet(envValue(spec.buyerKeyEnv)).address; }
  catch { checks.push(check('buyer key derivable', false, 'malformed')); return fail('buyer key malformed'); }
  checks.push(check('deployer key derivable', true, deployer));
  checks.push(check('buyer key derivable', true, buyer));
  checks.push(check('wallets distinct', deployer.toLowerCase() !== buyer.toLowerCase()));
  evidence.deployer = deployer;
  evidence.buyer = buyer;
  if (deployer.toLowerCase() === buyer.toLowerCase()) {
    return fail('deployer and buyer must be distinct wallets');
  }

  // 5. balances — public chain facts
  try {
    const [dBal, bBal] = await Promise.all([
      rpcCall(rpcUrl, 'eth_getBalance', [deployer, 'latest']),
      rpcCall(rpcUrl, 'eth_getBalance', [buyer, 'latest'])
    ]);
    evidence.deployer_balance_wei = BigInt(dBal).toString();
    evidence.buyer_balance_wei = BigInt(bBal).toString();
    const dOk = BigInt(dBal) >= BigInt(spec.minDeployerWei || 0);
    const bOk = BigInt(bBal) >= BigInt(spec.minBuyerWei || 0);
    checks.push(check('deployer balance sufficient', dOk, `${evidence.deployer_balance_wei} wei`));
    checks.push(check('buyer balance sufficient', bOk, `${evidence.buyer_balance_wei} wei`));
    if (!dOk) return fail('deployer wallet underfunded');
    if (!bOk) return fail('buyer wallet underfunded');
  } catch (e) {
    checks.push(check('balance check', false, e.message || 'error'));
    return fail('balance check failed: ' + (e.message || 'error'));
  }

  // 6. public metadata URL — a buyer's wallet must be able to reach it
  if (spec.publicUrlEnv) {
    const pub = envValue(spec.publicUrlEnv);
    const local = /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(pub || '');
    checks.push(check('public URL is not localhost', !local, local ? pub : null));
    if (local) return fail(`${spec.publicUrlEnv} points at localhost — unreachable from a buyer's wallet`);
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const r = await fetch(pub, { method: 'HEAD', signal: ctrl.signal }).finally(() => clearTimeout(t));
      checks.push(check('public URL reachable', r.ok, `HTTP ${r.status}`));
      evidence.public_url_status = r.status;
      if (!r.ok) return fail(`public URL returned HTTP ${r.status}`);
    } catch (e) {
      checks.push(check('public URL reachable', false, e.message || 'error'));
      return fail('public URL unreachable: ' + (e.message || 'error'));
    }
  }

  return { ok: true, checks, evidence };
}

const VERIFIERS = {
  'env-vars': verifyEnvVars,
  'manual': verifyManual,
  'rezonate-testnet': verifyRezonateTestnet,
  'http-reachable': verifyHttpReachable,
};

/**
 * Run a named verifier and normalize to the durable evidence shape.
 * Unknown names fail closed — a persisted record can never select code
 * that isn't in this registry.
 */
async function runVerifier(name, spec) {
  const v = VERIFIERS[name];
  const base = {
    verificationId: 'ver_' + crypto.randomBytes(8).toString('hex'),
    verifier: name,
    checkedAt: new Date().toISOString(),
  };
  if (!v) {
    return { ...base, passed: false, checks: [], evidence: null, safeSummary: `unknown verifier '${name}' — refused`, failureReason: `unknown verifier '${name}'` };
  }
  let r;
  try {
    r = await v(spec || {});
  } catch (e) {
    return { ...base, passed: false, checks: [], evidence: null, safeSummary: 'verifier threw', failureReason: e instanceof Error ? e.message : 'unknown' };
  }
  const passed = !!r.ok;
  return {
    ...base,
    passed,
    checks: r.checks || [],
    evidence: r.evidence ?? null,
    safeSummary: passed ? 'all checks passed' : (r.reason || 'check did not pass'),
    failureReason: passed ? null : (r.reason || 'check did not pass'),
  };
}

module.exports = { VERIFIERS, runVerifier, envNamePresent, envValue };
