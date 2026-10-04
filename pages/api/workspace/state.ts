/**
 * GET /api/workspace/state — the single live-state feed for the
 * ProtoForge Workspace. Every module reads real durable state; nothing
 * is hardcoded. Read-only — mutations stay in governed capabilities.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { execFile } from 'child_process';
import pg from 'pg';
import { getValidationQueue } from '../../../lib/heidi/ValidationQueue';
import { autonomousState } from '../../../lib/heidi/ActionController';
import { collectAgentState } from '../../../lib/heidi/AgentControlPlane';
import { requireOpsAuth } from '../../../lib/api/requireOpsAuth';

const REPO = 'C:\\Users\\Owner\\HYDI-System-v2';
const POOL = new pg.Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' });

const TEAM_MISSION_ROLES = new Set(['coo', 'scout', 'builder', 'qa', 'revenue', 'research', 'analyst', 'verifier', 'operations']);

// ── Telemetry freshness contract ────────────────────────────────────────────
// Expensive operational probes (pm2, git, supabase REST) are bounded-async
// and cached briefly. Callers always get an explicit freshness/status —
// never a stale value presented as live.
export type TelemetryStatus = 'HEALTHY' | 'DEGRADED' | 'TIMEOUT' | 'UNAVAILABLE' | 'STALE';
export interface Telemetry<T> { value: T; observedAt: string; ageMs: number; status: TelemetryStatus; ms?: number }

function run(cmd: string, args: string[], timeoutMs: number): Promise<{ ok: boolean; ms: number; stdout: string; status: TelemetryStatus }> {
  const t0 = Date.now();
  return new Promise(resolve => {
    execFile(cmd, args, { cwd: REPO, timeout: timeoutMs, encoding: 'utf8' as BufferEncoding, windowsHide: true }, (err, stdout) => {
      const ms = Date.now() - t0;
      if (err) {
        const killed = (err as NodeJS.ErrnoException & { killed?: boolean }).killed || /timed out/i.test(err.message);
        resolve({ ok: false, ms, stdout: '', status: killed ? 'TIMEOUT' : 'UNAVAILABLE' });
      } else {
        resolve({ ok: true, ms, stdout: String(stdout), status: 'HEALTHY' });
      }
    });
  });
}

// pm2 jlist on this host measured ~8s+ per call (up to ~196s observed
// when the PM2 daemon is busy) — it can never ride the request path.
// Policy: serve the last-known telemetry with honest ageMs/STALE
// status and refresh in the background; only a cold cache pays the
// bounded probe.
const PM2_TTL_MS = 30_000;
let pm2Cache: { at: number; telemetry: Telemetry<Array<{ name: string; status: string; uptime?: number; restarts?: number; memory?: number }>> } | null = null;
let pm2RefreshInFlight = false;

async function getPm2(): Promise<Telemetry<Array<{ name: string; status: string; uptime?: number; restarts?: number; memory?: number }>>> {
  const cached = pm2Cache;
  if (cached) {
    const underlying = cached.telemetry.status;
    const ageMs = Date.now() - cached.at;
    if (ageMs >= PM2_TTL_MS && !pm2RefreshInFlight) {
      pm2RefreshInFlight = true;
      void refreshPm2().finally(() => { pm2RefreshInFlight = false; });
    }
    return {
      ...cached.telemetry,
      ageMs,
      status: underlying === 'HEALTHY' ? 'STALE' : underlying,
    };
  }
  // Cold cache: return UNAVAILABLE now, refresh in background. PM2 on
  // this host is too slow (~8-196s) to ever ride a request path.
  if (!pm2RefreshInFlight) {
    pm2RefreshInFlight = true;
    void refreshPm2().finally(() => { pm2RefreshInFlight = false; });
  }
  return { value: [], observedAt: new Date().toISOString(), ageMs: 0, status: 'UNAVAILABLE', ms: 0 };
}

async function refreshPm2(): Promise<Telemetry<Array<{ name: string; status: string; uptime?: number; restarts?: number; memory?: number }>>> {
  // 25s — pm2's daemon on this host measured ~8s typical, ~196s
  // pathological; runs only in the background, never blocking a request.
  const r = await run('cmd', ['/c', 'C:\\Users\\Owner\\AppData\\Roaming\\npm\\pm2.cmd', 'jlist'], 25_000);
  let telemetry: Telemetry<Array<{ name: string; status: string; uptime?: number; restarts?: number; memory?: number }>>;
  if (r.ok) {
    try {
      const services = JSON.parse(r.stdout).map((p: { name: string; pm2_env: { status: string; pm_uptime?: number; restart_time?: number }; monit?: { memory?: number } }) => ({
        name: p.name, status: p.pm2_env.status,
        uptime: p.pm2_env.pm_uptime, restarts: p.pm2_env.restart_time, memory: p.monit?.memory,
      }));
      telemetry = { value: services, observedAt: new Date().toISOString(), ageMs: 0, status: 'HEALTHY', ms: r.ms };
    } catch {
      telemetry = { value: [], observedAt: new Date().toISOString(), ageMs: 0, status: 'UNAVAILABLE', ms: r.ms };
    }
  } else {
    telemetry = { value: [], observedAt: new Date().toISOString(), ageMs: 0, status: r.status, ms: r.ms };
  }
  pm2Cache = { at: Date.now(), telemetry };
  return telemetry;
}

// Recovery throttle snapshot — the watchdog's durable delegation state.
// Read-only: missing/corrupt file means "no failures tracked", which is
// honest (the throttle only writes on failure).
function readRecoveryStates(): Record<string, unknown> {
  try {
    const p = path.join(REPO, '.hydi-operational', 'recovery-throttle.json');
    if (!fs.existsSync(p)) return {};
    const raw = JSON.parse(fs.readFileSync(p, 'utf8'));
    const now = Date.now();
    const out: Record<string, unknown> = {};
    for (const [name, e] of Object.entries<any>(raw)) {
      const nextAt = e.nextAttemptAt ? new Date(e.nextAttemptAt).getTime() : null;
      out[name] = {
        service: name,
        state: e.state,
        cycles: e.cycles ?? 0,
        lastAttemptAt: e.lastAttemptAt ?? null,
        nextAttemptAt: e.nextAttemptAt ?? null,
        cooldownRemainingMs: nextAt && now < nextAt ? nextAt - now : 0,
        lastFailure: e.lastFailure ?? null,
        owner: 'watchdog',
        blocking: e.state === 'OPEN',
      };
    }
    return out;
  } catch { return {}; }
}

interface Recommendation {
  action: string; why: string; evidence: string; expectedValue: string;
  effort: string; risk: string; authorization: string; kind: string; ref?: string;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (!requireOpsAuth(req, res)) return;
  try {
    const [identity, goals, jobs, opps, invReqs, escs, latestCoo, latestEvents] = await Promise.all([
      POOL.query('select autonomy_level, current_environment from heidi_identity limit 1'),
      POOL.query(`select id, title, status, priority, context, created_at, updated_at from heidi_goals
                  where status in ('active','pending','in_progress','blocked') order by priority, created_at limit 20`),
      POOL.query(`select job_status, payment_status, delivery_status, intervention_status, count(*)::int c
                  from customer_jobs group by 1,2,3,4`),
      POOL.query(`select status, count(*)::int c, max(confidence) mx from protoforge_opportunities group by 1`),
      POOL.query(`select request_id, objective, status, created_at from human_intervention_requests
                  where status='pending' order by created_at desc limit 10`).catch(() => ({ rows: [] })),
      POOL.query(`select id, title, created_at from operator_escalations where resolved=false
                  order by created_at desc limit 10`).catch(() => ({ rows: [] })),
      POOL.query(`select payload, created_at from heidi_events where event_type='coo_state'
                  order by created_at desc limit 1`).catch(() => ({ rows: [] })),
      POOL.query(`select event_type, payload, created_at from heidi_events
                  where event_type in ('action_execution','delivery_approved','intervention_requested')
                  order by created_at desc limit 12`).catch(() => ({ rows: [] })),
    ]);

    // Investigations + interventions evidence
    const invLog = path.join(REPO, '.hydi-operational', 'dev-investigations.jsonl');
    const investigations = fs.existsSync(invLog)
      ? fs.readFileSync(invLog, 'utf8').trim().split('\n').slice(-10).map(l => JSON.parse(l))
      : [];

    // Business facts
    const facts = (await POOL.query(
      `select kind, key, value, status, last_verified from business_facts order by kind, key`).catch(() => ({ rows: [] }))).rows;

    // Autopilot loop state — the daemon's own persisted view
    const autopilot = fs.existsSync(path.join(REPO, '.hydi-operational', 'autopilot-status.json'))
      ? JSON.parse(fs.readFileSync(path.join(REPO, '.hydi-operational', 'autopilot-status.json'), 'utf8'))
      : null;

    // Engineering probes — all bounded-async and concurrent. The old
    // synchronous execFileSync block cost ~8-10s serial; the endpoint's
    // tail latency was pm2 jlist alone. Now each has its own timeout
    // and the worst case is max(budgets), not sum(budgets).
    const gitHeadP = run('git', ['rev-parse', '--short', 'HEAD'], 3000);
    const gitDirtyP = run('git', ['status', '--porcelain'], 5000);
    const pm2P = getPm2();
    const ollamaP = (async (): Promise<Telemetry<{ ok: boolean; models: string[] }>> => {
      const t0 = Date.now();
      try {
        const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(4000) });
        const j = await r.json() as { models?: Array<{ name: string }> };
        return { value: { ok: true, models: (j.models ?? []).map(m => m.name) }, observedAt: new Date().toISOString(), ageMs: 0, status: 'HEALTHY', ms: Date.now() - t0 };
      } catch (e) {
        return { value: { ok: false, models: [] }, observedAt: new Date().toISOString(), ageMs: 0, status: 'UNAVAILABLE', ms: Date.now() - t0 };
      }
    })();
    const restP = (async (): Promise<Telemetry<{ ok: boolean; circuit: string; failures: number }>> => {
      const t0 = Date.now();
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL;
      try {
        if (!url) return { value: { ok: false, circuit: 'unknown', failures: 0 }, observedAt: new Date().toISOString(), ageMs: 0, status: 'UNAVAILABLE', ms: 0 };
        const r = await fetch(`${url.replace(/\/$/, '')}/rest/v1/`, { signal: AbortSignal.timeout(2000) });
        const { supabaseRestHealth } = await import('../../../lib/supabase-timed');
        const health = supabaseRestHealth();
        return { value: { ok: r.ok, circuit: health.circuit, failures: health.failures }, observedAt: new Date().toISOString(), ageMs: 0, status: r.ok ? 'HEALTHY' : 'DEGRADED', ms: Date.now() - t0 };
      } catch {
        const { supabaseRestHealth } = await import('../../../lib/supabase-timed').catch(() => ({ supabaseRestHealth: () => ({ circuit: 'open' as const, failures: 0 }) }));
        const health = supabaseRestHealth();
        return { value: { ok: false, circuit: health.circuit, failures: health.failures }, observedAt: new Date().toISOString(), ageMs: 0, status: 'TIMEOUT', ms: Date.now() - t0 };
      }
    })();

    const [gitHeadR, gitDirtyR, pm2, ollama, supabaseRest] = await Promise.all([gitHeadP, gitDirtyP, pm2P, ollamaP, restP]);
    const gitHead = gitHeadR.ok ? gitHeadR.stdout.trim() : 'unknown';
    const dirty = gitDirtyR.ok ? gitDirtyR.stdout.split('\n').filter(Boolean).length : -1;

    const autonomy = identity.rows[0]?.autonomy_level ?? 0;
    const coo = latestCoo.rows[0]?.payload ?? null;
    const cooStale = latestCoo.rows[0] ? Date.now() - new Date(latestCoo.rows[0].created_at).getTime() > 45 * 60 * 1000 : true;

    const jobAgg = jobs.rows as Array<{ job_status: string; payment_status: string; delivery_status: string; intervention_status: string; c: number }>;
    const paidDelivered = jobAgg.filter(j => j.job_status === 'delivered').reduce((s, j) => s + j.c, 0);
    const escalated = jobAgg.filter(j => j.intervention_status === 'requested').reduce((s, j) => s + j.c, 0);
    const oppAgg = opps.rows as Array<{ status: string; c: number; mx: number | null }>;

    // Decisions queue — human items only
    const decisions = [
      ...(escs.rows as Array<{ id: number; title: string; created_at: string }>).map(e => ({
        id: `esc-${e.id}`, title: e.title, kind: 'escalation', created: e.created_at,
      })),
      ...(invReqs.rows as Array<{ request_id: string; objective: string; created_at: string }>).map(r => ({
        id: r.request_id, title: r.objective, kind: 'intervention', created: r.created_at,
      })),
      ...(escalated > 0 ? [{ id: 'qa-escalations', title: `${escalated} paid Model Prep jobs failed QA — review artifacts`, kind: 'delivery_qa', created: null }] : []),
    ];

    // Recommendations — deterministic ordering per the spec
    const recommendations: Recommendation[] = [];
    for (const d of decisions.slice(0, 3)) {
      recommendations.push({
        action: `Review human decision: ${d.title.slice(0, 80)}`,
        why: 'Requires owner authority — cannot proceed autonomously',
        evidence: d.id, expectedValue: 'Unblocks a gated business item', effort: 'human review',
        risk: 'none — decision only', authorization: 'R3+', kind: 'human_decision', ref: d.id,
      });
    }
    const confirmed = [...investigations].reverse().find((i: { conclusion: string }) => i.conclusion === 'CONFIRMED_DEFECT');
    if (confirmed) {
      recommendations.push({
        action: `Fix confirmed defect: ${confirmed.target}`,
        why: 'Bounded engineering fix — evidence-backed, reversible',
        evidence: confirmed.investigationId, expectedValue: confirmed.recommendedAction?.slice(0, 100) ?? 'remove defect',
        effort: 'bounded R2', risk: 'low — rollback on failure', authorization: 'R2', kind: 'dev_fix', ref: confirmed.investigationId,
      });
    }
    const topOpp = oppAgg.find(o => o.status === 'needs_review');
    if (topOpp && Number(topOpp.c) > 0) {
      const { rows: oppRows } = await POOL.query(
        `select id, title, confidence from protoforge_opportunities
         where status='needs_review' order by confidence desc nulls last limit 1`).catch(() => ({ rows: [] }));
      const opp = oppRows[0];
      recommendations.push({
        action: `Investigate top pending opportunity: ${opp ? String(opp.title).slice(0, 80) : `${topOpp.c} pending`}`,
        why: `${topOpp.c} opportunities sit in needs_review — intake produces no value until triaged`,
        evidence: 'protoforge_opportunities.needs_review', expectedValue: 'surface revenue-adjacent demand',
        effort: 'bounded R1 review', risk: 'none', authorization: 'R1', kind: 'opportunity', ref: opp?.id,
      });
    }

    res.status(200).json({
      at: new Date().toISOString(),
      system: {
        autonomyLevel: autonomy,
        autonomyName: ['OBSERVE', 'RECOMMEND', 'EXECUTE_REVERSIBLE', 'BOUNDED_WORKFLOWS', 'MULTI_STEP', 'STRATEGIC'][autonomy] ?? `L${autonomy}`,
        health: coo?.applicationHealth ?? 'UNKNOWN',
        deployment: coo?.deployment ?? null,
        cooStale,
      },
      autopilot: {
        state: autonomy >= 3 ? 'RUNNING' : 'GOVERNED_WAITING',
        head: autopilot?.head ?? null,
        scanCadenceMin: 30,
        lastInvestigations: investigations.slice(-5).map((i: { conclusion: string; target: string; confidence: string }) => ({ conclusion: i.conclusion, target: i.target, confidence: i.confidence })),
      },
      goals: (goals.rows as Array<Record<string, unknown>>).map(g => ({
        id: String(g.id).slice(0, 8), title: g.title, status: g.status, priority: g.priority,
        capability: (g.context as Record<string, unknown> | null)?.capabilityId ?? null,
        age: g.created_at,
      })),
      business: {
        revenueVerified: (facts.find(f => f.key === 'verified_total')?.value ?? '$0 (unverified)'),
        products: facts.filter(f => f.kind === 'product').map(f => ({ name: f.key, status: f.status, summary: f.value.slice(0, 120), verified: f.last_verified })),
      },
      missions: {
        jobs: { paidDelivered, escalated, total: jobAgg.reduce((s, j) => s + j.c, 0) },
        devGoals: (goals.rows as Array<Record<string, unknown>>).filter(g => String(g.title ?? '').startsWith('Investigate:') || String(g.title ?? '').startsWith('Fix ')).length,
        events: (latestEvents.rows as Array<{ event_type: string; payload: Record<string, unknown>; created_at: string }>).slice(0, 8).map(e => ({ type: e.event_type, at: e.created_at, detail: JSON.stringify(e.payload).slice(0, 100) })),
      },
      opportunities: oppAgg.map(o => ({ status: o.status, count: o.c, topConfidence: o.mx })),
      // Commercial offers from the persisted coo_state snapshot — the
      // CHECKOUT_READY boundary the console must surface as customer-required.
      offers: (() => {
        const o = (coo?.revenue as { offers?: { total?: number; byStage?: Record<string, number>; ready?: Array<{ offerId: string; product: string; priceCents: number; currency: string }>; boundary?: Array<{ offerId: string; stage: string; reason?: string }> } } | null)?.offers;
        if (!o) return null;
        return { total: o.total ?? 0, byStage: o.byStage ?? {}, ready: o.ready ?? [], boundary: o.boundary ?? [] };
      })(),
      // Customer validation queue — folded from durable state by
      // ValidationQueue; stages never collapse (AUTHORIZED ≠ EXECUTED,
      // DECLARED ≠ VERIFIED).
      validation: await (async () => {
        try {
          const q = await getValidationQueue(POOL);
          return q.map(i => ({
            opportunity: i.opportunityTitle,
            stage: i.stage,
            verdict: i.finding?.verdict ?? null,
            confidence: i.finding?.confidence ?? null,
            hypothesisId: i.hypothesisRequestId,
            hypothesisStatus: i.hypothesisStatus,
            authorized: i.stage === 'AUTHORIZED' || i.stage === 'EVIDENCE_DECLARED' || i.stage === 'VERIFIED',
            experimentId: i.experimentId,
            evidenceCount: i.evidence.length,
            verified: i.verified,
            nextHumanAction: i.nextHumanAction,
            blockedReason: i.blockedReason,
          }));
        } catch { return []; }
      })(),
      engineering: {
        head: gitHead, dirtyPaths: dirty,
        services: pm2.value, servicesOnline: pm2.value.filter(s => s.status === 'online').length, servicesTotal: pm2.value.length,
        servicesTelemetry: { observedAt: pm2.observedAt, ageMs: pm2.ageMs, status: pm2.status, ms: pm2.ms },
        ollama: ollama.value,
        ollamaTelemetry: { observedAt: ollama.observedAt, ageMs: ollama.ageMs, status: ollama.status, ms: ollama.ms },
        supabaseRest: { ...supabaseRest.value, ms: supabaseRest.ms },
        supabaseRestTelemetry: { observedAt: supabaseRest.observedAt, ageMs: supabaseRest.ageMs, status: supabaseRest.status, ms: supabaseRest.ms },
        // Recovery delegation throttle state — per-component backoff /
        // cooldown / OPEN status. Read-only read of the durable file the
        // watchdog writes; a missing file means no failures tracked.
        recoveryStates: readRecoveryStates(),
      },
      decisions,
      recommendations,
      autonomous: await autonomousState(POOL).catch(() => null),
      // Commercial bridge — durable offer records folded from
      // heidi_events division='commercial'. Empty means no opportunity
      // has been commercially qualified yet (honest, not an error).
      commercial: await (async () => {
        try {
          const { collectOffers } = await import('../../../lib/heidi/CommercialBridge');
          const offers = await collectOffers(POOL);
          return {
            offers: offers.map(o => ({
              offerId: o.offerId, opportunityId: o.opportunityId.slice(0, 8),
              title: o.opportunityTitle.slice(0, 80), product: o.product,
              priceCents: o.priceCents, stage: o.stage, stageReason: o.stageReason,
              updatedAt: o.updatedAt,
            })),
            counts: {
              prepared: offers.filter(o => o.stage === 'OFFER_PREPARED').length,
              checkoutReady: offers.filter(o => o.stage === 'CHECKOUT_READY').length,
              blocked: offers.filter(o => o.stage === 'OFFER_BLOCKED').length,
              authRequired: offers.filter(o => o.stage === 'AUTHORIZATION_REQUIRED').length,
            },
          };
        } catch { return { offers: [], counts: { prepared: 0, checkoutReady: 0, blocked: 0, authRequired: 0 } }; }
      })(),
      // Command Center: the persistent agent team, live mission state,
      // and recent agent activity — folded from the agents event ledger.
      agents: await (async () => {
        try {
          const plane = await collectAgentState(POOL);
          const team = plane.agents.filter(a => a.agentId.startsWith('team-')).map(a => ({
            agentId: a.agentId, role: a.role, status: a.status,
            lastHeartbeat: a.lastHeartbeatAt, lastStep: a.lastStep,
            currentMission: plane.missions.find(m => m.agentId === a.agentId && (m.status === 'RUNNING' || m.status === 'PENDING'))?.missionId ?? null,
            authority: a.authorizationLevel,
          }));
          const missions = plane.missions
            .filter(m => m.role && (m.agentId?.startsWith('team-') || TEAM_MISSION_ROLES.has(m.role)))
            .slice(-20).map(m => ({
              missionId: m.missionId, role: m.role, agentId: m.agentId,
              objective: m.objective.slice(0, 90), status: m.status,
              priority: m.priority, attempt: m.attempt,
              updatedAt: m.updatedAt, failure: m.failure,
            })).reverse();
          return {
            team, missions,
            counts: {
              running: plane.missions.filter(m => m.status === 'RUNNING').length,
              pending: plane.missions.filter(m => m.status === 'PENDING').length,
              needsHuman: plane.missions.filter(m => m.status === 'NEEDS_HUMAN').length,
              stale: plane.staleCount,
            },
            activity: (await POOL.query(
              `select event_type, payload, created_at from heidi_events
                 where division='agents' order by created_at desc limit 15`,
            ).catch(() => ({ rows: [] as Array<{ event_type: string; payload: Record<string, unknown>; created_at: string }> }))).rows
              .map(e => ({ type: e.event_type, at: e.created_at, detail: JSON.stringify(e.payload).slice(0, 130) })),
          };
        } catch { return { team: [], missions: [], counts: { running: 0, pending: 0, needsHuman: 0, stale: 0 }, activity: [] }; }
      })(),

      // ── Control Tower (HYDI 4: PriorityEngine + MissionLifecycle + ProofEngine) ──
      // outcomes, not activity: what is claimed, what is proven, what is
      // refused, what is next. Claims never present UNKNOWN as PROVEN.
      controlTower: await (async () => {
        try {
          const { ProofEngine } = await import('../../../lib/heidi/ProofEngine');
          const { PriorityEngine } = await import('../../../lib/heidi/PriorityEngine');
          const engine = new ProofEngine(POOL);
          const claims = await engine.evaluateAll();

          // Rank open goals the same way the cognitive loop does — the
          // API process has no CapabilityRegistry, so executor-bound
          // fields (reversibility/dependencyHealth/autonomyRequirement)
          // come from goal context when present, else safe defaults.
          const pe = new PriorityEngine();
          const prioritized = pe.prioritize(
            (goals.rows as Array<Record<string, unknown>>).map((g) => {
              const ctx = (g.context ?? {}) as Record<string, unknown>;
              return {
                item: g,
                assessment: {
                  impact: Math.min(10, Math.max(0, Number(g.priority) || 0)),
                  urgency: Math.min(10, Math.max(0, Number(g.priority) || 0)),
                  confidence: 0.7,
                  reversibility: typeof ctx.reversibility === 'number' ? ctx.reversibility : 0.6,
                  autonomyLevel: typeof ctx.autonomyLevel === 'number' ? ctx.autonomyLevel : 0,
                  estimatedEffort: typeof ctx.estimatedEffort === 'number' ? ctx.estimatedEffort : 5,
                  dependencyHealth: typeof ctx.dependencyHealth === 'number' ? ctx.dependencyHealth : 0.7,
                  revenueEffect: typeof ctx.revenueEffect === 'number' ? ctx.revenueEffect : 0,
                  humanRequired: ctx.humanRequired === true,
                  prohibited: ctx.prohibited === true,
                  prohibitionReason: typeof ctx.prohibitionReason === 'string' ? ctx.prohibitionReason : undefined,
                },
              };
            }),
            autonomy,
          );

          // Latest lifecycle transition per goal — the receipt chain tail.
          const transitions = (await POOL.query(
            `select payload, created_at from heidi_events
               where event_type='mission_transition' order by created_at desc limit 20`,
          ).catch(() => ({ rows: [] as Array<{ payload: Record<string, unknown>; created_at: string }> }))).rows;

          return {
            claims: claims.map(c => ({
              claim: c.claim, verdict: c.verdict, confidence: c.confidence,
              freshnessMs: c.freshnessMs, gap: c.gap ?? null,
              provenance: c.provenance.map(l => ({ kind: l.kind, ref: String(l.ref).slice(0, 24), summary: l.summary.slice(0, 100), at: l.at })),
            })),
            priorities: {
              ranked: prioritized.ranked.slice(0, 5).map(p => ({
                goalId: String((p.item as Record<string, unknown>).id).slice(0, 8),
                title: (p.item as Record<string, unknown>).title,
                score: Math.round(p.score * 100) / 100,
              })),
              refused: prioritized.refused.slice(0, 5).map(p => ({
                goalId: String((p.item as Record<string, unknown>).id).slice(0, 8),
                title: (p.item as Record<string, unknown>).title,
                reason: p.reason,
              })),
              deferred: prioritized.deferred.slice(0, 5).map(p => ({
                goalId: String((p.item as Record<string, unknown>).id).slice(0, 8),
                title: (p.item as Record<string, unknown>).title,
              })),
            },
            lifecycle: transitions.map(t => ({
              missionId: String((t.payload as { missionId?: string }).missionId ?? '').slice(0, 8),
              toStage: (t.payload as { toStage?: string }).toStage,
              failureClass: (t.payload as { failureClass?: string }).failureClass ?? null,
              at: t.created_at,
            })),
          };
        } catch (e) {
          return { claims: [], priorities: null, lifecycle: [], error: e instanceof Error ? e.message : 'control tower failed' };
        }
      })(),
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'workspace state failed' });
  }
}
