/**
 * GET /api/workspace/state — the single live-state feed for the
 * ProtoForge Workspace. Every module reads real durable state; nothing
 * is hardcoded. Read-only — mutations stay in governed capabilities.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import { execFileSync } from 'child_process';
import pg from 'pg';

const REPO = 'C:\\Users\\Owner\\HYDI-System-v2';
const POOL = new pg.Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' });

interface Recommendation {
  action: string; why: string; evidence: string; expectedValue: string;
  effort: string; risk: string; authorization: string; kind: string; ref?: string;
}

export default async function handler(_req: NextApiRequest, res: NextApiResponse) {
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

    // Engineering: git + pm2
    const gitHead = execFileSync('git', ['rev-parse', '--short', 'HEAD'], { cwd: REPO }).toString().trim();
    const dirty = execFileSync('git', ['status', '--porcelain'], { cwd: REPO }).toString().split('\n').filter(Boolean).length;
    let pm2: Array<{ name: string; status: string; uptime?: number; restarts?: number; memory?: number }> = [];
    try {
      const raw = execFileSync('cmd', ['/c', 'C:\\Users\\Owner\\AppData\\Roaming\\npm\\pm2.cmd', 'jlist'], { cwd: REPO, timeout: 8000 }).toString();
      pm2 = JSON.parse(raw).map((p: { name: string; pm2_env: { status: string; pm_uptime?: number; restart_time?: number }; monit?: { memory?: number } }) => ({
        name: p.name, status: p.pm2_env.status,
        uptime: p.pm2_env.pm_uptime, restarts: p.pm2_env.restart_time, memory: p.monit?.memory,
      }));
    } catch { /* pm2 unavailable */ }

    // Ollama
    let ollama: { ok: boolean; models: string[] } = { ok: false, models: [] };
    try {
      const r = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(4000) });
      const j = await r.json() as { models?: Array<{ name: string }> };
      ollama = { ok: true, models: (j.models ?? []).map(m => m.name) };
    } catch { /* offline */ }

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
      recommendations.push({
        action: `Review ${topOpp.c} pending ProtoForge opportunities (top confidence ${topOpp.mx ?? '?'})`,
        why: 'Opportunity intake produces no value until triaged',
        evidence: 'protoforge_opportunities.needs_review', expectedValue: 'surface revenue-adjacent demand',
        effort: 'bounded R1 review', risk: 'none', authorization: 'R1', kind: 'opportunity',
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
      engineering: {
        head: gitHead, dirtyPaths: dirty,
        services: pm2, servicesOnline: pm2.filter(s => s.status === 'online').length, servicesTotal: pm2.length,
        ollama,
      },
      decisions,
      recommendations,
    });
  } catch (e) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'workspace state failed' });
  }
}
