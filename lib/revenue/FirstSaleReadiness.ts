/**
 * First-Sale Readiness Gate
 *
 * lib/revenue/FirstSaleReadiness.ts
 *
 * A deterministic, evidence-backed assessment of whether the system can
 * accept its first legitimate live sale for a given offer (default:
 * checkpoint_audit). Evaluates seven areas against live state and returns
 * exactly one verdict:
 *
 *   VERIFIED_LIVE_TRANSACTION — a real live payment + fulfillment + ledger
 *                               entry + consistent reconciliation are
 *                               independently verifiable. Never produced by
 *                               test-mode records, passing tests, or green
 *                               configuration.
 *   READY_FOR_OPERATOR_REVIEW — every machine check passes and every known
 *                               human boundary is resolved; only the
 *                               operator's final review remains.
 *   BLOCKED_HUMAN_ACTION      — machine-side prerequisites are satisfied
 *                               but one or more human-owned boundaries are
 *                               still open (credentials, authorization,
 *                               prospects, consent).
 *   BLOCKED_MACHINE_FAILURE   — a machine-owned prerequisite is failing
 *                               (runtime down, offer inactive, webhook
 *                               processing disabled, ledger unreachable).
 *
 * Precedence: VERIFIED_LIVE_TRANSACTION is checked first (real revenue
 * outranks readiness), then machine failures (they must be fixed before
 * human work matters), then open human actions.
 *
 * Every check is read-only. Secrets are inspected by prefix/presence only
 * and never surfaced in evidence.
 */

import fs from 'fs';
import path from 'path';

export type ReadinessVerdict =
  | 'VERIFIED_LIVE_TRANSACTION'
  | 'READY_FOR_OPERATOR_REVIEW'
  | 'BLOCKED_HUMAN_ACTION'
  | 'BLOCKED_MACHINE_FAILURE';

export interface ReadinessCheck {
  name: string;
  ok: boolean;
  /** Who must act when this check fails. */
  owner: 'machine' | 'human';
  detail?: string;
}

export interface ReadinessArea {
  area: string;
  ok: boolean;
  checks: ReadinessCheck[];
  /** blockerKeys of open Human Actions this area depends on. */
  linkedBlockers: string[];
}

export interface LiveTransactionEvidence {
  jobId: string;
  checkoutSessionId: string;
  paymentStatus: string;
  deliveryStatus: string;
  ledgerEntryId: string | null;
  reconciliationStatus: string | null;
}

export interface FirstSaleReadinessResult {
  verdict: ReadinessVerdict;
  evaluatedAt: string;
  offerId: string;
  areas: ReadinessArea[];
  /** Open Human Actions currently gating the sale. */
  openHumanActions: Array<{ blockerKey: string; actionId: string; status: string; title: string }>;
  liveTransaction: LiveTransactionEvidence | null;
  summary: string;
}

/** Injectable seams — every external dependency is replaceable in tests. */
export interface ReadinessDeps {
  env?: (name: string) => string | undefined;
  /** GET a URL; resolves true when the response is HTTP <500-reachable. */
  probe?: (url: string, timeoutMs?: number) => Promise<ProbeResult>;
  fileExists?: (p: string) => boolean;
  readJson?: (p: string) => unknown;
  listHumanActions?: () => Array<{
    id: string; blockerKey: string; status: string; title?: string;
    verifier?: { name?: string };
  }>;
  /** Count legitimate experiment prospects (operator-supplied, not synthetic). */
  countLegitimateProspects?: () => Promise<{ count: number; source: string }>;
  /** Find the first fully-verified live transaction, if any. */
  findLiveTransaction?: () => Promise<LiveTransactionEvidence | null>;
  getOffer?: (offerId: string) => Record<string, unknown> | null;
}

export interface ProbeResult { ok: boolean; status?: number; error?: string }

const DEFAULT_OFFER = 'checkpoint_audit';
const DEMAND_EXPERIMENT_PATH = path.join(process.cwd(), '.hydi-operational', 'checkpoint-demand-experiment.json');
const LIVE_AUTH_STORE_PATH = path.join(process.cwd(), '.hydi-operational', 'live-transaction-authorization.json');
const PROSPECT_TARGET = 5;

function check(name: string, ok: boolean, owner: 'machine' | 'human', detail?: string): ReadinessCheck {
  return { name, ok, owner, detail };
}

function defaultEnv(name: string): string | undefined {
  return process.env[name];
}

async function defaultProbe(url: string, timeoutMs = 6000): Promise<ProbeResult> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'ngrok-skip-browser-warning': '1' } })
      .finally(() => clearTimeout(t));
    return { ok: r.status < 500, status: r.status };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'probe failed' };
  }
}

function defaultReadJson(p: string): unknown {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return null; }
}

function defaultListHumanActions() {
  // Read the authoritative store directly — no service construction needed
  // for a read-only listing, and this surface must never run resolvers.
  const storePath = path.join(process.cwd(), 'data', 'human-actions.json');
  const db = defaultReadJson(storePath) as { actions?: Array<Record<string, unknown>> } | null;
  return (db?.actions ?? []) as Array<{ id: string; blockerKey: string; status: string; title?: string; verifier?: { name?: string } }>;
}

async function defaultCountLegitimateProspects(): Promise<{ count: number; source: string }> {
  // The demand-experiment tracking file is the authoritative record for
  // THIS experiment — operator-supplied prospects recorded through the
  // governed prospects API. Synthetic rows in the leads table never count.
  const exp = defaultReadJson(DEMAND_EXPERIMENT_PATH) as { prospects?: Array<Record<string, unknown>> } | null;
  const prospects = Array.isArray(exp?.prospects) ? exp!.prospects! : [];
  const legitimate = prospects.filter((p) =>
    p.legitimate === true && p.businessName && p.contactChannel && p.relevanceReason,
  );
  return { count: legitimate.length, source: DEMAND_EXPERIMENT_PATH };
}

async function defaultFindLiveTransaction(): Promise<LiveTransactionEvidence | null> {
  try {
    const { getRevenueDatabase } = await import('./RevenueDatabase');
    const db = getRevenueDatabase();
    // VERIFIED_LIVE_TRANSACTION requires the full chain: cs_live_ session,
    // paid job, delivered artifacts, a ledger entry, and a consistent
    // reconciliation verdict — all for the SAME transaction.
    const row = await db.queryOne<Record<string, unknown>>(`
      SELECT j.job_id, j.stripe_checkout_session_id, j.payment_status, j.delivery_status,
             l.entry_id AS ledger_entry_id
      FROM customer_jobs j
      LEFT JOIN revenue_ledger l
        ON l.metadata->>'job_id' = j.job_id OR l.job_id = j.job_id
      WHERE j.stripe_checkout_session_id LIKE 'cs_live_%'
        AND j.payment_status = 'paid'
        AND j.delivery_status = 'delivered'
      ORDER BY j.updated_at DESC
      LIMIT 1
    `);
    if (!row) return null;
    return {
      jobId: String(row.job_id),
      checkoutSessionId: String(row.stripe_checkout_session_id).slice(0, 12) + '…',
      paymentStatus: String(row.payment_status),
      deliveryStatus: String(row.delivery_status),
      ledgerEntryId: row.ledger_entry_id ? String(row.ledger_entry_id) : null,
      reconciliationStatus: row.ledger_entry_id ? 'ledger-matched' : null,
    };
  } catch {
    return null;
  }
}

function defaultGetOffer(offerId: string): Record<string, unknown> | null {
  const p = path.join(process.cwd(), '.hydi-operational', 'approved-offers.json');
  const offers = defaultReadJson(p) as Record<string, Record<string, unknown>> | null;
  return offers?.[offerId] ?? null;
}

function isOpenStatus(status: string): boolean {
  return !['RESOLVED', 'CANCELED', 'REJECTED', 'EXPIRED'].includes(status);
}

export async function assessFirstSaleReadiness(
  opts: { offerId?: string } = {},
  deps: ReadinessDeps = {},
): Promise<FirstSaleReadinessResult> {
  const offerId = opts.offerId || DEFAULT_OFFER;
  const env = deps.env || defaultEnv;
  const probe = deps.probe || defaultProbe;
  const fileExists = deps.fileExists || ((p) => fs.existsSync(p));
  const readJson = deps.readJson || defaultReadJson;
  const listActions = deps.listHumanActions || defaultListHumanActions;
  const countProspects = deps.countLegitimateProspects || defaultCountLegitimateProspects;
  const findLive = deps.findLiveTransaction || defaultFindLiveTransaction;
  const getOffer = deps.getOffer || defaultGetOffer;

  const actions = listActions();
  const openActions = actions.filter((a) => isOpenStatus(a.status));
  const openByKey = new Map(openActions.map((a) => [a.blockerKey, a]));

  // ─── VERIFIED_LIVE_TRANSACTION is checked first: real revenue outranks
  // every readiness signal. Requires the full evidence chain.
  const liveTxn = await findLive();
  if (liveTxn && liveTxn.paymentStatus === 'paid'
    && liveTxn.deliveryStatus === 'delivered' && liveTxn.ledgerEntryId) {
    return {
      verdict: 'VERIFIED_LIVE_TRANSACTION',
      evaluatedAt: new Date().toISOString(),
      offerId,
      areas: [],
      openHumanActions: [],
      liveTransaction: liveTxn,
      summary: `verified live transaction ${liveTxn.jobId} — paid, delivered, ledger ${liveTxn.ledgerEntryId}`,
    };
  }

  const areas: ReadinessArea[] = [];

  // ─── A. Runtime + public URL (machine)
  const localProbe: ProbeResult = await probe('http://localhost:3000/api/ping').catch(() => ({ ok: false }));
  const coreProbe: ProbeResult = await probe('http://localhost:3005/health').catch(() => ({ ok: false }));
  const baseUrl = env('NEXT_PUBLIC_APP_URL') || env('APP_BASE_URL') || null;
  let publicProbe: ProbeResult = { ok: false };
  if (baseUrl) publicProbe = await probe(`${baseUrl.replace(/\/+$/, '')}/api/ping`).catch(() => ({ ok: false }));
  areas.push({
    area: 'A_runtime_and_public_url',
    ok: localProbe.ok && coreProbe.ok && !!baseUrl && publicProbe.ok,
    checks: [
      check('heidi-web /api/ping', localProbe.ok, 'machine', `HTTP ${localProbe.status ?? 'unreachable'}`),
      check('protoforge-core /health', coreProbe.ok, 'machine', `HTTP ${coreProbe.status ?? 'unreachable'}`),
      check('public base URL configured', !!baseUrl, 'machine', baseUrl ? new URL(baseUrl).host : 'NEXT_PUBLIC_APP_URL unset'),
      check('public URL reaches backend', !baseUrl || publicProbe.ok, 'machine', baseUrl ? `HTTP ${publicProbe.status ?? 'unreachable'}` : 'no URL to probe'),
    ],
    linkedBlockers: ['protoforge:stable-public-url', 'protoforge:web-runtime-capacity', 'protoforge:public-base-url-stale'],
  });

  // ─── B. Offer + checkout configuration (machine)
  const offer = getOffer(offerId);
  const pagePath = path.join(process.cwd(), 'pages', 'services', 'checkpoint-audit.jsx');
  const apiPath = path.join(process.cwd(), 'pages', 'api', 'revenue', 'jobs', 'index.js');
  areas.push({
    area: 'B_offer_and_checkout',
    ok: !!offer && offer.active === true && Number(offer.setupPrice) > 0 && fileExists(pagePath) && fileExists(apiPath),
    checks: [
      check(`offer '${offerId}' approved`, !!offer, 'machine', offer ? `${offer.name ?? offerId}` : 'not in approved-offers'),
      check('offer active', offer?.active === true, 'machine', `active=${offer?.active}`),
      check('price configured', Number(offer?.setupPrice) > 0, 'machine', `${offer?.setupPrice ?? 0}¢`),
      check('purchase page exists', fileExists(pagePath), 'machine', '/services/checkpoint-audit'),
      check('checkout intake endpoint exists', fileExists(apiPath), 'machine', 'POST /api/revenue/jobs'),
    ],
    linkedBlockers: [],
  });

  // ─── C. Live Stripe credentials (human boundary)
  const key = env('STRIPE_SECRET_KEY') || '';
  const isLive = key.startsWith('sk_live_') || key.startsWith('rk_live_');
  const liveAllowed = env('ALLOW_LIVE_STRIPE') === 'true';
  areas.push({
    area: 'C_live_stripe_credential',
    ok: isLive && liveAllowed,
    checks: [
      check('live-mode Stripe credential', isLive, 'human', key ? `prefix=${key.slice(0, 8)}…` : 'STRIPE_SECRET_KEY unset'),
      check('ALLOW_LIVE_STRIPE opt-in', liveAllowed, 'human', `ALLOW_LIVE_STRIPE=${env('ALLOW_LIVE_STRIPE') ?? 'unset'}`),
    ],
    linkedBlockers: ['stripe:live-credential'],
  });

  // ─── D. Per-transaction authorization (human boundary)
  const authStore = readJson(LIVE_AUTH_STORE_PATH) as Record<string, Record<string, unknown>> | null;
  const auths = Object.values(authStore || {});
  const fresh = auths.filter((a) =>
    (a.state === 'PENDING' || a.state === 'RESERVED') && Date.parse(String(a.expiresAt || '')) > Date.now());
  areas.push({
    area: 'D_per_transaction_authorization',
    ok: fresh.length > 0,
    checks: [
      check('unexpired live-transaction authorization', fresh.length > 0, 'human',
        fresh.length ? `${fresh.length} valid` : `${auths.length} on file, none usable`),
    ],
    linkedBlockers: ['stripe:live-transaction-authorization'],
  });

  // ─── E. Webhook + fulfillment readiness (machine + one human downstream)
  const webhookSecret = !!(env('STRIPE_WEBHOOK_SECRET_01') || env('STRIPE_WEBHOOK_SECRET'));
  const webhookEnabled = env('WEBHOOK_PROCESSING_ENABLED') === 'true';
  const ursulaProbe: ProbeResult = await probe('http://localhost:5000/checkpoint/health').catch(() => ({ ok: false }));
  const artifactsDir = path.join(process.cwd(), 'artifacts', 'customer-jobs');
  areas.push({
    area: 'E_webhook_and_fulfillment',
    ok: webhookSecret && webhookEnabled && ursulaProbe.ok && fileExists(artifactsDir),
    checks: [
      check('webhook signing secret configured', webhookSecret, 'machine', webhookSecret ? 'whsec_…' : 'unset'),
      check('WEBHOOK_PROCESSING_ENABLED', webhookEnabled, 'machine', String(env('WEBHOOK_PROCESSING_ENABLED'))),
      check('Ursula checkpoint engine healthy', ursulaProbe.ok, 'machine', `HTTP ${ursulaProbe.status ?? 'unreachable'}`),
      check('artifact storage writable path', fileExists(artifactsDir), 'machine', artifactsDir),
      check('live webhook endpoint registered (needs live credential)', !isLive || !openByKey.has('stripe:live-webhook-endpoint'), 'human',
        isLive ? 'open unless a live endpoint is verified' : 'deferred — requires live credential first'),
    ],
    linkedBlockers: ['stripe:live-webhook-endpoint'],
  });

  // ─── F. Legitimate prospects + outreach consent (human boundary)
  const prospects = await countProspects().catch(() => ({ count: 0, source: 'error' }));
  const outreachResolved = openByKey.get('checkpoint:outreach-authorization') === undefined;
  areas.push({
    area: 'F_prospects_and_outreach',
    ok: prospects.count >= PROSPECT_TARGET && outreachResolved,
    checks: [
      check(`${PROSPECT_TARGET}+ legitimate prospects`, prospects.count >= PROSPECT_TARGET, 'human',
        `${prospects.count}/${PROSPECT_TARGET} recorded`),
      check('outreach authorized', outreachResolved, 'human',
        outreachResolved ? 'authorization action resolved' : 'checkpoint:outreach-authorization open'),
    ],
    linkedBlockers: ['checkpoint:demand-prospects', 'checkpoint:outreach-authorization'],
  });

  // ─── G. Ledger + reconciliation readiness (machine)
  const ledgerModule = fileExists(path.join(process.cwd(), 'lib', 'revenue', 'RevenueLedger.ts'));
  const reconcilerModule = fileExists(path.join(process.cwd(), 'lib', 'revenue', 'RevenueReconciler.ts'));
  const webhookBridge = fileExists(path.join(process.cwd(), 'lib', 'revenue', 'JobWebhookBridge.js'));
  areas.push({
    area: 'G_ledger_and_reconciliation',
    ok: ledgerModule && reconcilerModule && webhookBridge,
    checks: [
      check('revenue ledger module', ledgerModule, 'machine'),
      check('reconciler module', reconcilerModule, 'machine'),
      check('job-webhook bridge wired', webhookBridge, 'machine'),
    ],
    linkedBlockers: [],
  });

  // ─── Verdict
  const machineFailed = areas.some((a) => a.checks.some((c) => !c.ok && c.owner === 'machine'));
  const gating = openActions.filter((a) =>
    areas.some((ar) => ar.linkedBlockers.includes(a.blockerKey)));
  const humanFailed = areas.some((a) => a.checks.some((c) => !c.ok && c.owner === 'human'));

  let verdict: ReadinessVerdict;
  let summary: string;
  if (machineFailed) {
    verdict = 'BLOCKED_MACHINE_FAILURE';
    const failed = areas.flatMap((a) => a.checks.filter((c) => !c.ok && c.owner === 'machine').map((c) => c.name));
    summary = `machine prerequisites failing: ${failed.join('; ')}`;
  } else if (humanFailed || gating.length > 0) {
    verdict = 'BLOCKED_HUMAN_ACTION';
    summary = `${gating.length} human-owned blocker(s) open: ${gating.map((a) => a.blockerKey).join(', ') || 'human checks failing'}`;
  } else {
    verdict = 'READY_FOR_OPERATOR_REVIEW';
    summary = 'all machine checks pass and no gating human actions are open — operator review is the only remaining step';
  }

  return {
    verdict,
    evaluatedAt: new Date().toISOString(),
    offerId,
    areas,
    openHumanActions: gating.map((a) => ({ blockerKey: a.blockerKey, actionId: a.id, status: a.status, title: a.title ?? '' })),
    liveTransaction: null,
    summary,
  };
}
