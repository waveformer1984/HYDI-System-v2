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
 *   stripe-live-credential        — configured Stripe key is live-mode
 *   public-base-url               — public https domain for checkout/webhooks
 *   stripe-live-webhook-endpoint  — live Stripe endpoint delivers our events
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

/**
 * Verifier: a set of env var NAMES are configured.
 * Spec: { envNames: [], anyOfGroups?: [[name,...], ...] } — every envName
 * must be present AND (if anyOfGroups given) at least one whole group
 * must be fully present. Names only — values never enter the result.
 */
async function verifyEnvVars(spec, deps) {
  const present = (deps && deps.envNamePresent) || envNamePresent;
  const names = spec.envNames || [];
  const checks = names.map((n) => check(`env present: ${n}`, present(n)));
  const missing = names.filter((n) => !present(n));
  const groups = spec.anyOfGroups || [];
  let groupOk = true;
  if (groups.length) {
    groupOk = groups.some((g) => g.every((n) => present(n)));
    for (const g of groups) {
      checks.push(check(`env group: ${g.join(' + ')}`, g.every((n) => present(n))));
    }
    if (!groupOk) {
      missing.push('one of: ' + groups.map((g) => g.join('+')).join(' | '));
    }
  }
  return {
    ok: missing.length === 0,
    checks,
    evidence: { env_present: names.reduce((a, n) => (a[n] = present(n), a), {}) },
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
async function verifyHttpReachable(spec, deps) {
  const readEnv = (deps && deps.envValue) || envValue;
  const doFetch = (deps && deps.fetch) || fetch;
  const url = spec.url || (spec.urlEnv ? readEnv(spec.urlEnv) : null);
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
    const r = await doFetch(url, { method: 'HEAD', signal: ctrl.signal }).finally(() => clearTimeout(t));
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

/**
 * Verifier: a ProtoForge opportunity has been approved by a human via the
 * existing approval path. Spec: { opportunityId }. Reads the durable
 * opportunity store — it never approves anything itself; it only proves
 * that the authorized endpoint already recorded the decision.
 */
async function verifyOpportunityApproved(spec, deps) {
  const checks = [];
  const id = spec.opportunityId;
  if (!id) return { ok: false, checks: [check('opportunity id', false, 'no opportunityId in spec')], reason: 'no opportunityId configured' };
  try {
    const { getOpportunity } = (deps && deps.opportunityStore) || require('../missions/opportunity-store');
    const opp = await getOpportunity(id);
    if (!opp) return { ok: false, checks: [check('opportunity exists', false)], reason: `opportunity ${id} not found` };
    checks.push(check('opportunity exists', true, String(opp.title || '').slice(0, 80)));
    const approved = opp.approval_status === 'approved';
    checks.push(check('approval_status == approved', approved, `status=${opp.approval_status}`));
    return {
      ok: approved,
      checks,
      evidence: { approval_status: opp.approval_status, approved_by: opp.approved_by || null, approved_at: opp.approved_at || null },
      reason: approved ? null : `approval_status is '${opp.approval_status}'`,
    };
  } catch (e) {
    checks.push(check('store readable', false, e instanceof Error ? e.message : 'error'));
    return { ok: false, checks, reason: 'store error: ' + (e instanceof Error ? e.message : 'unknown') };
  }
}

/**
 * Verifier: a fresh, valid live-transaction authorization exists — issued
 * by a human through lib/revenue/LiveTransactionAuthorization. Spec:
 * { storePath? }. Passes when a PENDING or RESERVED authorization exists
 * and has not expired. Reads the persisted store read-only; evidence
 * carries ids/state/scope only — never amounts beyond public metadata.
 */
async function verifyLiveAuthIssued(spec) {
  const checks = [];
  const p = spec.storePath || path.join(process.cwd(), '.hydi-operational', 'live-transaction-authorization.json');
  if (!fs.existsSync(p)) {
    checks.push(check('authorization store exists', false));
    return { ok: false, checks, reason: 'no live-transaction authorization on file' };
  }
  let store;
  try { store = JSON.parse(fs.readFileSync(p, 'utf8')); }
  catch { return { ok: false, checks: [check('authorization store parseable', false)], reason: 'authorization store unreadable' } };
  const now = Date.now();
  const all = Object.values(store || {});
  const fresh = all.filter((a) =>
    (a.state === 'PENDING' || a.state === 'RESERVED') && Date.parse(a.expiresAt || '') > now);
  checks.push(check('authorization issued', all.length > 0, `${all.length} on file`));
  checks.push(check('fresh PENDING/RESERVED authorization', fresh.length > 0,
    fresh.length ? `${fresh.length} valid` : 'none unexpired'));
  return {
    ok: fresh.length > 0,
    checks,
    evidence: { valid_authorizations: fresh.map((a) => ({ authorizationId: a.authorizationId, state: a.state, scope: a.scope, expiresAt: a.expiresAt, authorizedBy: a.authorizedBy })) },
    reason: fresh.length ? null : 'no unexpired live-transaction authorization — issue one via the existing authorization endpoint',
  };
}

/**
 * Verifier: a durable customer_job row has reached a required state.
 * Spec: { jobId, field?, want? } — reads JobManager (never writes).
 * 'job-payment-status' proves payment_status === 'paid' — the only
 * honest proof that a verified Stripe webhook confirmed payment.
 * 'job-delivered' proves delivery_status === 'delivered'.
 * deps.jobManager is injectable for tests; production resolves the real
 * JobManager through the same dynamic-import pattern JobWebhookBridge
 * uses for ESM TS modules.
 */
async function verifyJobField(spec, deps, field, want) {
  const checks = [];
  if (!spec.jobId) return { ok: false, checks: [check('job id', false, 'no jobId in spec')], reason: 'no jobId configured' };
  try {
    const jm = (deps && deps.jobManager)
      || (await import('../revenue/JobManager.ts')).getJobManager();
    const job = await jm.getJob(spec.jobId);
    if (!job) return { ok: false, checks: [check('job exists', false)], reason: `job ${spec.jobId} not found` };
    checks.push(check('job exists', true, spec.jobId));
    const actual = job[field];
    checks.push(check(`${field} == ${want}`, actual === want, `${field}=${actual}`));
    return {
      ok: actual === want,
      checks,
      evidence: { jobId: spec.jobId, [field]: actual, jobStatus: job.jobStatus, sessionId: job.stripeCheckoutSessionId || null },
      reason: actual === want ? null : `${field} is '${actual}'`,
    };
  } catch (e) {
    checks.push(check('job store readable', false, e instanceof Error ? e.message : 'error'));
    return { ok: false, checks, reason: 'job store error: ' + (e instanceof Error ? e.message : 'unknown') };
  }
}

/**
 * Verifier: an app's own test suite passes, run for real.
 * Spec: { dir, command, timeoutMs? } — `command` executes in `dir`
 * (bounded: no shell string interpolation beyond the configured command;
 * deps.runCommand is injectable for tests). Evidence: exit code + the
 * last summary line of output — never the full log.
 */
async function verifyAppTestsPass(spec, deps) {
  const checks = [];
  const dir = spec.dir;
  const command = spec.command || 'npm test';
  if (!dir) return { ok: false, checks: [check('app dir configured', false)], reason: 'no dir configured' };
  const fs = require('fs');
  if (!fs.existsSync(dir)) {
    return { ok: false, checks: [check('app dir exists', false, dir)], reason: `dir missing: ${dir}` };
  }
  checks.push(check('app dir exists', true));
  try {
    const run = (deps && deps.runCommand)
      || ((cmd, cwd, timeoutMs) => new Promise((resolve) => {
        const { exec } = require('child_process');
        exec(cmd, { cwd, timeout: timeoutMs || 120000, maxBuffer: 1024 * 512 }, (err, stdout, stderr) => {
          resolve({ code: err ? (typeof err.code === 'number' ? err.code : 1) : 0, output: ((stdout || '') + (stderr || '')).slice(-4000) });
        });
      }));
    const result = await run(command, dir, spec.timeoutMs || 120000);
    const summaryLine = (result.output || '').split('\n').map((l) => l.trim()).filter((l) => /pass|fail|tests \d|✔|✖|error/i.test(l)).slice(-1)[0] || result.output?.slice(-200) || '';
    checks.push(check('test command exits 0', result.code === 0, `exit=${result.code}`));
    return {
      ok: result.code === 0,
      checks,
      evidence: { command, exitCode: result.code, summaryLine },
      reason: result.code === 0 ? null : `tests failed (exit ${result.code}): ${summaryLine}`,
    };
  } catch (e) {
    return { ok: false, checks, reason: 'test run error: ' + (e instanceof Error ? e.message : 'unknown') };
  }
}

/**
 * Verifier: an HTTP endpoint actually performs — not just responds.
 * Spec: { method, url, body?, expectStatus?, expectJsonField?, timeoutMs? }
 * Evidence: status + which expected field was present — never the body
 * contents. Used to prove an external engine endpoint works end-to-end.
 */
async function verifyHttpEndpoint(spec, deps) {
  const checks = [];
  const url = spec.url;
  if (!url) return { ok: false, checks: [check('url configured', false)], reason: 'no url configured' };
  checks.push(check('url configured', true, url));
  try {
    const doFetch = (deps && deps.fetch) || fetch;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), spec.timeoutMs || 8000);
    const r = await doFetch(url, {
      method: spec.method || 'GET',
      headers: spec.body ? { 'Content-Type': 'application/json' } : undefined,
      body: spec.body ? JSON.stringify(spec.body) : undefined,
      signal: ctrl.signal,
    }).finally(() => clearTimeout(t));
    const want = spec.expectStatus || 200;
    checks.push(check(`HTTP ${want}`, r.status === want, `HTTP ${r.status}`));
    let fieldOk = true;
    if (spec.expectJsonField) {
      const json = await r.json().catch(() => null);
      const val = json && spec.expectJsonField.split('.').reduce((o, k) => (o == null ? o : o[k]), json);
      fieldOk = val !== undefined && val !== null;
      checks.push(check(`json field '${spec.expectJsonField}' present`, fieldOk, fieldOk ? `present (${typeof val})` : 'absent'));
      return {
        ok: r.status === want && fieldOk,
        checks,
        evidence: { http_status: r.status, field: spec.expectJsonField, field_present: fieldOk },
        reason: r.status !== want ? `HTTP ${r.status}` : (fieldOk ? null : `field '${spec.expectJsonField}' absent`),
      };
    }
    return { ok: r.status === want && fieldOk, checks, evidence: { http_status: r.status }, reason: r.status === want ? null : `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, checks, reason: 'endpoint error: ' + (e instanceof Error ? e.message : 'unknown') };
  }
}

/**
 * Verifier: a service offer exists in the canonical OfferCatalog.
 * Spec: { offerId }. Reads the catalog; never creates offers.
 */
async function verifyOfferExists(spec, deps) {
  const checks = [];
  if (!spec.offerId) return { ok: false, checks: [check('offerId configured', false)], reason: 'no offerId configured' };
  try {
    const catalog = (deps && deps.catalog) || require('../revenue/OfferCatalog').getOfferCatalog();
    const offer = typeof catalog.get === 'function' ? catalog.get(spec.offerId) : (catalog.offers || {})[spec.offerId] || null;
    const priceCents = offer ? (offer.priceCents ?? offer.setupPrice ?? null) : null;
    checks.push(check(`offer '${spec.offerId}' exists`, !!offer, offer ? `${offer.name || spec.offerId} @ ${priceCents ?? '?'}¢` : 'not in catalog'));
    return {
      ok: !!offer,
      checks,
      evidence: offer ? { offerId: spec.offerId, priceCents, currency: offer.currency } : { offerId: spec.offerId },
      reason: offer ? null : `offer '${spec.offerId}' not in catalog`,
    };
  } catch (e) {
    return { ok: false, checks, reason: 'catalog error: ' + (e instanceof Error ? e.message : 'unknown') };
  }
}

/**
 * Verifier: a human commercial decision is recorded for an offerId.
 * Spec: { offerId }. Reads the durable decision store — the recorded
 * human decision is the evidence; nothing here can approve on its own.
 */
async function verifyCommercialApproved(spec, deps) {
  const checks = [];
  if (!spec.offerId) return { ok: false, checks: [check('offerId configured', false)], reason: 'no offerId configured' };
  try {
    const get = (deps && deps.commercialDecision)
      || ((id) => require('../commercial/decision-store').getDecision(id));
    const d = await get(spec.offerId);
    const approved = !!d && d.decision === 'approved';
    checks.push(check(`commercial decision '${spec.offerId}'`, approved,
      d ? `${d.decision} by ${d.approvedBy} @ ${d.decidedAt}` : 'no recorded decision'));
    return {
      ok: approved,
      checks,
      evidence: approved ? { offerId: spec.offerId, approvedBy: d.approvedBy, decidedAt: d.decidedAt, priceCents: d.priceCents ?? null } : { offerId: spec.offerId },
      reason: approved ? null : `no approved commercial decision for '${spec.offerId}'`,
    };
  } catch (e) {
    return { ok: false, checks, reason: 'decision store error: ' + (e instanceof Error ? e.message : 'unknown') };
  }
}

/**
 * Verifier: an external payment signal has reached a terminal,
 * evidence-backed state. Spec: { signalId }.
 *
 * Reads the durable payment-signal store — never writes it. Passes when
 * the signal is 'resolved', which happens only via governed paths:
 *   (a) reconcileSignal re-checked internal records and found a terminal
 *       attribution (MATCHED_REVENUE / KNOWN_TEST_EVENT / DUPLICATE_EVENT), or
 *   (b) a human recorded a disposition through the API (external_not_found /
 *       external_confirmed / belongs_to_other) with actor + captured ids.
 *
 * Independent check: when the disposition carries a providerObjectId and
 * the configured credential can reach that object, the object is
 * re-fetched and its amount must agree with the signal — a fat-fingered
 * payment id fails verification. Never creates revenue or state.
 */
async function verifyPaymentSignalResolved(spec, deps) {
  const checks = [];
  const id = spec.signalId;
  if (!id) return { ok: false, checks: [check('signalId configured', false)], reason: 'no signalId configured' };
  try {
    const store = (deps && deps.signalStore) || require('../revenue/payment-signal-store');
    const rec = store.getSignal(id);
    if (!rec) {
      return { ok: false, checks: [check('signal exists', false)], reason: `signal ${id} not found` };
    }
    checks.push(check('signal exists', true, `${rec.signal.amountCents}¢ ${rec.signal.currency} — ${rec.verdict.classification}`));
    const resolved = rec.status === 'resolved';
    checks.push(check('signal resolved', resolved,
      resolved ? `via ${rec.disposition?.type || 'auto_reconcile'}` : `status=${rec.status}`));

    // Independent provider re-check when the captured object is inspectable.
    const objId = rec.disposition?.providerObjectId || rec.signal.providerObjectId;
    const stripe = deps && deps.stripe;
    if (objId && stripe) {
      try {
        let obj = null;
        if (objId.startsWith('pi_') && stripe.paymentIntents) obj = await stripe.paymentIntents.retrieve(objId);
        else if (objId.startsWith('ch_') && stripe.charges) obj = await stripe.charges.retrieve(objId);
        else if (objId.startsWith('cs_') && stripe.checkout) obj = await stripe.checkout.sessions.retrieve(objId);
        if (obj) {
          const objAmount = Number(obj.amount ?? obj.amount_total ?? 0);
          const agree = objAmount === rec.signal.amountCents;
          checks.push(check('provider object amount agrees', agree,
            agree ? `${objId} = ${objAmount}¢` : `${objId} is ${objAmount}¢, signal claims ${rec.signal.amountCents}¢ — wrong payment captured`));
          if (!agree) {
            return {
              ok: false, checks,
              evidence: { signalId: id, providerObjectId: objId, signalAmount: rec.signal.amountCents, providerAmount: objAmount },
              reason: `captured object ${objId} does not match the signal amount`,
            };
          }
        } else {
          checks.push(check('provider object re-fetch', false, `${objId} not retrievable with configured credential`));
        }
      } catch (e) {
        checks.push(check('provider object re-fetch', false, e instanceof Error ? e.message : 'error'));
      }
    } else {
      checks.push(check('provider object inspectable', resolved, objId ? 'no reachable credential — disposition record is the evidence' : 'no providerObjectId — disposition record is the evidence'));
    }

    return {
      ok: resolved,
      checks,
      evidence: {
        signalId: id,
        classification: rec.verdict.classification,
        protoforgeAttribution: rec.verdict.protoforgeAttribution,
        disposition: rec.disposition ? { type: rec.disposition.type, actor: rec.disposition.actor, at: rec.disposition.at } : null,
        internalMatch: rec.verdict.internalMatch,
      },
      reason: resolved ? null : `signal still ${rec.status} — ${rec.verdict.summary}`,
    };
  } catch (e) {
    return { ok: false, checks, reason: 'signal store error: ' + (e instanceof Error ? e.message : 'unknown') };
  }
}

/**
 * Verifier: the configured Stripe credential is LIVE — not merely present.
 * Spec: { keyEnv? } default STRIPE_SECRET_KEY. Reads the value only to
 * inspect its 8-char mode prefix; the prefix is public metadata (Stripe
 * documents sk_live_/sk_test_ shapes) and never exposes the secret body.
 */
async function verifyStripeLiveCredential(spec, deps) {
  const env = (deps && deps.envValue) || envValue;
  const name = spec.keyEnv || 'STRIPE_SECRET_KEY';
  const checks = [];
  const key = env(name);
  checks.push(check(`${name} configured`, !!key));
  if (!key) {
    return { ok: false, checks, evidence: { configured: false }, reason: `missing: ${name}` };
  }
  const isLive = key.startsWith('sk_live_') || key.startsWith('rk_live_');
  const prefix = key.slice(0, 8);
  checks.push(check('key is live-mode', isLive, `prefix=${prefix}…`));
  return {
    ok: isLive,
    checks,
    evidence: { configured: true, keyPrefix: prefix },
    reason: isLive ? null : `${name} is ${prefix}… (test mode) — a live sk_live_/rk_live_ credential is required`,
  };
}

/**
 * Verifier: a public, non-localhost https base URL exists — the domain a
 * real customer's checkout success/cancel links and the Stripe webhook
 * endpoint must reach. Spec: { envNames? } default
 * ['NEXT_PUBLIC_APP_URL','APP_BASE_URL']. The host is evidence-safe.
 */
async function verifyPublicBaseUrl(spec, deps) {
  const env = (deps && deps.envValue) || envValue;
  const names = spec.envNames || ['NEXT_PUBLIC_APP_URL', 'APP_BASE_URL'];
  const checks = [];
  let url = null, usedName = null;
  for (const n of names) {
    const v = env(n);
    if (v) { url = v; usedName = n; break; }
  }
  checks.push(check('public base URL configured', !!url, url ? `via ${usedName}` : `none of ${names.join(', ')}`));
  if (!url) {
    return { ok: false, checks, reason: `missing: public base URL (one of ${names.join(', ')})` };
  }
  let host = null;
  try { host = new URL(url).host; } catch { /* malformed */ }
  const https = /^https:\/\//i.test(url);
  const local = !host || /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(:\d+)?$/.test(host);
  checks.push(check('https scheme', https, https ? null : 'must be https:// for a customer-facing domain'));
  checks.push(check('publicly reachable host', !local, local ? `${host} is localhost/private — a Stripe webhook cannot reach it` : `host=${host}`));
  const ok = https && !local;
  return {
    ok, checks,
    evidence: { configuredVia: usedName, host, https, localhost: local },
    reason: ok ? null : (https ? 'base URL is not a public domain' : 'base URL must be https://'),
  };
}

/**
 * Verifier: a live Stripe webhook endpoint exists that delivers
 * checkout.session.completed to our handler, and its signing secret is
 * configured locally. Spec: { path?, requiredEvents? }.
 *
 * Uses the Stripe API read-only (webhookEndpoints.list) — enumerating
 * endpoints cannot charge anything; ALLOW_LIVE_STRIPE gates money, not
 * reads. Requires a live credential; without one the boundary is the
 * credential action, so this reports FAILED fast with no network call.
 * API errors report PENDING (undecidable), not FAILED.
 */
async function verifyStripeLiveWebhookEndpoint(spec, deps) {
  const env = (deps && deps.envValue) || envValue;
  const envPresent = (deps && deps.envNamePresent) || envNamePresent;
  const checks = [];
  const key = env(spec.keyEnv || 'STRIPE_SECRET_KEY');
  const isLive = !!key && (key.startsWith('sk_live_') || key.startsWith('rk_live_'));
  checks.push(check('live credential present', isLive));
  if (!isLive) {
    return { ok: false, checks, reason: 'live credential required first — resolve stripe:live-credential' };
  }
  const secretPresent = envPresent('STRIPE_WEBHOOK_SECRET_01') || envPresent('STRIPE_WEBHOOK_SECRET');
  checks.push(check('webhook signing secret configured', secretPresent, secretPresent ? 'whsec_…' : 'STRIPE_WEBHOOK_SECRET_01 unset'));

  const wantPath = spec.path || '/api/webhooks/stripe';
  const wantEvents = spec.requiredEvents || ['checkout.session.completed'];
  let endpoint = null;
  try {
    const stripe = (deps && deps.stripe) || require('stripe')(key);
    const list = await stripe.webhookEndpoints.list({ limit: 100 });
    const match = (list.data || []).find((e) =>
      e.status === 'enabled' &&
      String(e.url || '').replace(/\/+$/, '').endsWith(wantPath) &&
      wantEvents.every((ev) => (e.enabled_events || []).includes(ev) || (e.enabled_events || []).includes('*')));
    endpoint = match || null;
    checks.push(check('enabled endpoint for ' + wantPath, !!match,
      match ? `${new URL(match.url).host}${wantPath}` : `${(list.data || []).length} endpoint(s) on account, none match ${wantPath}`));
    if (match) {
      checks.push(check('subscribed to ' + wantEvents.join(','), true,
        (match.enabled_events || []).join(',').slice(0, 120)));
    }
  } catch (e) {
    checks.push(check('Stripe API reachable', false, e instanceof Error ? e.message : 'error'));
    return { ok: false, pending: true, checks, reason: 'Stripe API error: ' + (e instanceof Error ? e.message : 'unknown') };
  }
  const ok = !!endpoint && secretPresent;
  return {
    ok, checks,
    evidence: { endpointUrl: endpoint ? endpoint.url : null, endpointId: endpoint ? endpoint.id : null, signingSecretConfigured: secretPresent },
    reason: ok ? null : (!endpoint ? `no enabled live webhook endpoint delivers to ${wantPath} with ${wantEvents.join(', ')}` : 'endpoint exists but STRIPE_WEBHOOK_SECRET_01 is not set'),
  };
}

const VERIFIERS = {
  'env-vars': verifyEnvVars,
  'manual': verifyManual,
  'rezonate-testnet': verifyRezonateTestnet,
  'http-reachable': verifyHttpReachable,
  'opportunity-approved': verifyOpportunityApproved,
  'live-auth-issued': verifyLiveAuthIssued,
  'job-payment-status': (spec, deps) => verifyJobField(spec, deps, 'paymentStatus', 'paid'),
  'job-delivered': (spec, deps) => verifyJobField(spec, deps, 'deliveryStatus', 'delivered'),
  'app-tests-pass': verifyAppTestsPass,
  'http-endpoint': verifyHttpEndpoint,
  'offer-exists': verifyOfferExists,
  'commercial-approved': verifyCommercialApproved,
  'payment-signal-resolved': verifyPaymentSignalResolved,
  'stripe-live-credential': verifyStripeLiveCredential,
  'public-base-url': verifyPublicBaseUrl,
  'stripe-live-webhook-endpoint': verifyStripeLiveWebhookEndpoint,
};

/**
 * Run a named verifier and normalize to the durable evidence shape.
 * Unknown names fail closed — a persisted record can never select code
 * that isn't in this registry.
 */
async function runVerifier(name, spec, deps) {
  const v = VERIFIERS[name];
  const base = {
    verificationId: 'ver_' + crypto.randomBytes(8).toString('hex'),
    verifier: name,
    checkedAt: new Date().toISOString(),
  };
  if (!v) {
    return { ...base, status: 'UNAVAILABLE', resumeEligible: false, passed: false, checks: [], evidence: null, safeSummary: `unknown verifier '${name}' — refused`, failureReason: `unknown verifier '${name}'` };
  }
  let r;
  try {
    r = await v(spec || {}, deps);
  } catch (e) {
    return { ...base, status: 'UNAVAILABLE', resumeEligible: false, passed: false, checks: [], evidence: null, safeSummary: 'verifier threw', failureReason: e instanceof Error ? e.message : 'unknown' };
  }
  const passed = !!r.ok;
  // Canonical verifier status (Phase 4 contract):
  //   VERIFIED    — the check proved the boundary is cleared
  //   FAILED      — the check ran and the boundary still exists
  //   PENDING     — the check ran but the outcome isn't decidable yet
  //   UNAVAILABLE — the check itself could not run (threw/unknown name)
  const status = passed ? 'VERIFIED' : r.pending ? 'PENDING' : 'FAILED';
  return {
    ...base,
    status,
    resumeEligible: passed,      // a VERIFIED boundary is resumable; nothing else is
    passed,
    checks: r.checks || [],
    evidence: r.evidence ?? null,
    safeSummary: passed ? 'all checks passed' : (r.reason || 'check did not pass'),
    failureReason: passed ? null : (r.reason || 'check did not pass'),
  };
}

module.exports = { VERIFIERS, runVerifier, envNamePresent, envValue };
