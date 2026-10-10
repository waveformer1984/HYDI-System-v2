/**
 * POST /api/workspace/action — the ONLY mutation surface for dashboard
 * buttons. Every action becomes a governed heidi_goals row carrying
 * capabilityId + capabilityParams; the daemon executes it through the
 * existing risk/verification/rollback path. The UI can never execute
 * code directly — it can only submit intents into the governed queue.
 *
 * Allowed actions (closed enum — unknown kinds are refused):
 *   acknowledge  { queueItemId }                          → ops.acknowledge_human_action
 *   resolve      { queueItemId, decision:approve|reject } → ops.resolve_human_action
 *   fix          { investigationId }                      → ops.dev_author (CONFIRMED only)
 *   investigate  { findingType?, target, question, ... }  → ops.dev_investigate
 *   sell_offer   { offerId, customerEmail }               → governed revenue.advance_offer
 *                proposal the operator must still approve — supplies the
 *                customer identity RevenueRuntime refuses to invent
 */
import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import pg from 'pg';
import { verifyServiceToken } from '../../../lib/auth/verifyServiceToken';
import { createActionProposal } from '../../../lib/heidi/ActionProposals';
import { collectOffers } from '../../../lib/heidi/CommercialBridge';

const REPO = 'C:\\Users\\Owner\\HYDI-System-v2';
const pool = new pg.Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  // Every kind below inserts a governed goal the daemon executes — this
  // surface is mutating-only, so the service token is required up front.
  const auth = verifyServiceToken(req.headers['x-hydi-service-token'] as string | undefined, null as unknown as string);
  if (!auth.valid) {
    return res.status(401).json({ error: 'AUTHORIZATION_REQUIRED', reason: auth.reason ?? 'invalid token' });
  }

  const { kind } = req.body ?? {};

  let goal: { title: string; description: string; priority: number; capabilityId: string; params: Record<string, unknown> };

  if (kind === 'acknowledge' || kind === 'resolve') {
    const { queueItemId, decision } = req.body;
    if (typeof queueItemId !== 'string' || !queueItemId.length) return res.status(400).json({ error: 'queueItemId required' });
    if (kind === 'resolve' && decision !== 'approve' && decision !== 'reject') return res.status(400).json({ error: "decision must be 'approve' or 'reject'" });
    goal = {
      title: `${kind === 'resolve' ? `${decision} ` : 'acknowledge '}queue item ${queueItemId}`,
      description: `workspace action: ${kind} on ${queueItemId}`,
      priority: 4,
      capabilityId: kind === 'resolve' ? 'ops.resolve_human_action' : 'ops.acknowledge_human_action',
      params: { queueItemId, decision, actor: 'workspace-operator' },
    };
  } else if (kind === 'fix') {
    const { investigationId } = req.body;
    if (typeof investigationId !== 'string') return res.status(400).json({ error: 'investigationId required' });
    // Only CONFIRMED_DEFECT investigations may spawn a fix — the record
    // is the evidence; UI cannot claim confirmation it doesn't have.
    const invLog = path.join(REPO, '.hydi-operational', 'dev-investigations.jsonl');
    const rec = fs.existsSync(invLog)
      ? fs.readFileSync(invLog, 'utf8').trim().split('\n').map(l => JSON.parse(l)).find((r: { investigationId?: string; id?: string }) => r.investigationId === investigationId || r.id === investigationId)
      : null;
    if (!rec) return res.status(404).json({ error: 'investigation not found' });
    if (rec.conclusion !== 'CONFIRMED_DEFECT') return res.status(409).json({ error: `refused: investigation conclusion is ${rec.conclusion} — only CONFIRMED_DEFECT can spawn a fix` });
    goal = {
      title: `Fix confirmed defect: ${String(rec.target).slice(0, 120)}`,
      description: rec.recommendedAction ?? 'bounded fix',
      priority: 3,
      capabilityId: 'ops.dev_author',
      params: { problem: rec.question, evidence: JSON.stringify(rec.evidence ?? {}).slice(0, 4000), targetFiles: rec.filesInspected ?? [], missionId: rec.missionId, sourceInvestigation: rec.investigationId },
    };
  } else if (kind === 'investigate') {
    const { target, question } = req.body;
    if (typeof target !== 'string' || !target.length) return res.status(400).json({ error: 'target required' });
    goal = {
      title: `Investigate: ${String(question ?? target).slice(0, 140)}`,
      description: `workspace-initiated investigation of ${target}`,
      priority: 5,
      capabilityId: 'ops.dev_investigate',
      params: {
        findingType: typeof req.body.findingType === 'string' ? req.body.findingType : 'generic',
        target, question: question ?? `investigate ${target}`,
        initialObservation: String(req.body.initialObservation ?? 'workspace-initiated'),
        suspectedFiles: Array.isArray(req.body.suspectedFiles) ? req.body.suspectedFiles : [],
      },
    };
  } else if (kind === 'investigate_opportunity') {
    const { opportunityId } = req.body;
    if (typeof opportunityId !== 'string' || !opportunityId.length) return res.status(400).json({ error: 'opportunityId required' });
    goal = {
      title: `Investigate opportunity ${opportunityId.slice(0, 8)}`,
      description: 'bounded protoforge.investigate mission (research → analyst)',
      priority: 5,
      capabilityId: 'ops.agent_mission',
      params: { opportunityId },
    };
  } else if (kind === 'sell_offer') {
    // Customer-identity intake for a CHECKOUT_READY offer. This endpoint
    // never creates a job, a checkout, or a payment — it creates a governed
    // heidi_action_proposals row bound to the exact offer, which the
    // operator must still approve in ACTIONS (consume-once, params-hash
    // bound). The customer email is durable evidence inside the proposal
    // params, supplied explicitly by the operator.
    const { offerId, customerEmail } = req.body ?? {};
    if (typeof offerId !== 'string' || !/^[\w:-]{1,120}$/.test(offerId)) {
      return res.status(400).json({ error: 'offerId must be a bounded identifier string' });
    }
    if (typeof customerEmail !== 'string' || customerEmail.length > 254
      || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customerEmail)) {
      return res.status(400).json({ error: 'customerEmail must be a syntactically valid email address' });
    }
    const offer = (await collectOffers(pool)).find(o => o.offerId === offerId);
    if (!offer) return res.status(404).json({ error: `offer '${offerId}' not found in durable commercial state` });
    if (offer.isTest) return res.status(409).json({ error: `refused: offer ${offerId} is a test fixture — durable evidence, not sellable inventory; a real customer can never be bound to it` });
    if (offer.stage !== 'CHECKOUT_READY' && offer.stage !== 'AUTHORIZATION_REQUIRED') {
      return res.status(409).json({ error: `refused: offer ${offerId} is ${offer.stage} — only CHECKOUT_READY/AUTHORIZATION_REQUIRED offers accept a customer identity` });
    }
    try {
      const { id, existing } = await createActionProposal(pool, {
        capabilityId: 'revenue.advance_offer',
        params: { offerId, customerEmail },
        title: `Sell ${offer.offerId}: ${offer.product} $${(offer.priceCents / 100).toFixed(2)} ${offer.currency} to ${customerEmail}`,
        reason: `Operator supplied customer identity for ${offerId} (${offer.stage}). Approving binds ${customerEmail} to this exact offer — params-hash locked — and creates the checkout/job pair through the governed revenue runtime.`,
        expectedEffects: 'Job created bound via requirements.offerId; hosted checkout session created and its URL persisted on the job record; offer advances to PAYMENT_PENDING.',
        risks: 'R2 — commercial transaction boundary. The customer is charged only after they complete the hosted checkout; test mode produces no real charge.',
        prerequisites: 'Offer is CHECKOUT_READY; Stripe test key configured; live mode additionally requires a matching LiveTransactionAuthorization.',
        rollback: 'Checkout session expires unpaid; job row remains unpaid.',
        reversible: true,
        producerKey: `sell_offer:${offerId}`,
        expiresInMs: 4 * 60 * 60 * 1000,
      });
      await pool.query(
        `INSERT INTO heidi_events (event_type, division, payload, created_at) VALUES ('workspace_action','workspace',$1,now())`,
        [JSON.stringify({ kind, offerId, proposalId: id, deduped: existing, actor: 'workspace-operator' })],
      ).catch(() => { });
      return res.status(200).json({
        ok: true, proposalId: id, deduped: existing,
        message: existing
          ? `proposal ${id.slice(0, 8)} already pending for this exact offer+customer — approve it in ACTIONS`
          : `governed proposal ${id.slice(0, 8)} created — approve it in ACTIONS to advance the offer`,
      });
    } catch (e) {
      return res.status(400).json({ error: e instanceof Error ? e.message : 'proposal refused' });
    }
  } else {
    return res.status(400).json({ error: `unknown action kind '${kind}' — allowed: acknowledge, resolve, fix, investigate, investigate_opportunity, sell_offer` });
  }

  try {
    // Dedupe: if an open goal for the same capability+target already
    // carries this work, report it rather than flooding the queue.
    const dupKey = goal.params.investigationId ?? goal.params.target ?? goal.params.opportunityId ?? goal.params.queueItemId ?? null;
    if (dupKey) {
      const dup = await pool.query(
        `SELECT id FROM heidi_goals WHERE status IN ('pending','active','in_progress','blocked')
           AND context->>'capabilityId' = $1
           AND (context->'capabilityParams'->>'target' = $2
                OR context->'capabilityParams'->>'investigationId' = $2
                OR context->'capabilityParams'->>'opportunityId' = $2
                OR context->'capabilityParams'->>'queueItemId' = $2)
           LIMIT 1`,
        [goal.capabilityId, String(dupKey)],
      );
      if (dup.rows.length > 0) {
        // Still ensure the verdict stage exists even when the mission
        // goal was created before chaining shipped.
        if (kind === 'investigate_opportunity') {
          const vd = await pool.query(
            `SELECT id FROM heidi_goals WHERE status IN ('pending','active','in_progress','blocked')
               AND context->>'capabilityId'='ops.opp_verdict'
               AND context->'capabilityParams'->>'opportunityId'=$1 LIMIT 1`,
            [String(dupKey)],
          );
          if (vd.rows.length === 0) {
            await pool.query(
              `INSERT INTO heidi_goals (parent_id, title, goal_type, description, status, priority, success_criteria, context, created_at, updated_at)
               VALUES ($1, $2, 'task', $2, 'active', 5, '["business_finding persisted with legal verdict"]'::jsonb, $3, now(), now())`,
              [dup.rows[0].id, `Verdict: business finding for opportunity ${String(dupKey).slice(0, 8)}`,
              JSON.stringify({ capabilityId: 'ops.opp_verdict', capabilityParams: { opportunityId: dupKey }, completeOnVerify: true, producedBy: 'workspace-ui', producerKey: `ws:verdict:${String(dupKey)}` })],
            ).catch(() => { });
          }
        }
        return res.status(200).json({ ok: true, deduped: true, goalId: dup.rows[0].id, capabilityId: goal.capabilityId, message: `already in flight as goal ${String(dup.rows[0].id).slice(0, 8)} — no duplicate dispatched` });
      }
    }
    const r = await pool.query(
      `INSERT INTO heidi_goals (title, goal_type, description, status, priority, success_criteria, context, created_at, updated_at)
       VALUES ($1,'task',$2,'active',$3,'["governed capability executes and contract-verifies"]'::jsonb,$4,now(),now()) RETURNING id`,
      [goal.title, goal.description, goal.priority,
      JSON.stringify({ capabilityId: goal.capabilityId, capabilityParams: goal.params, completeOnVerify: true, producedBy: 'workspace-ui', producerKey: `ws:${kind}:${Date.now()}` })],
    );
    const goalId = r.rows[0].id as string;
    await pool.query(
      `INSERT INTO heidi_events (event_type, division, payload, created_at) VALUES ('workspace_action','workspace',$1,now())`,
      [JSON.stringify({ goalId, kind, capabilityId: goal.capabilityId, params: goal.params, actor: 'workspace-operator' })],
    ).catch(() => { });

    // Business loop: investigation is stage 1 — chain the deterministic
    // verdict stage so an investigated opportunity always produces a
    // typed business finding, not just agent activity.
    if (kind === 'investigate_opportunity') {
      const dup = await pool.query(
        `SELECT id FROM heidi_goals WHERE status IN ('pending','active','in_progress','blocked')
           AND context->>'capabilityId'='ops.opp_verdict'
           AND context->'capabilityParams'->>'opportunityId'=$1 LIMIT 1`,
        [String(goal.params.opportunityId)],
      );
      if (dup.rows.length === 0) {
        await pool.query(
          `INSERT INTO heidi_goals (parent_id, title, goal_type, description, status, priority, success_criteria, context, created_at, updated_at)
           VALUES ($1, $2, 'task', $2, 'active', 5, '["business_finding persisted with legal verdict"]'::jsonb, $3, now(), now())`,
          [goalId, `Verdict: business finding for opportunity ${String(goal.params.opportunityId).slice(0, 8)}`,
            JSON.stringify({ capabilityId: 'ops.opp_verdict', capabilityParams: { opportunityId: goal.params.opportunityId }, completeOnVerify: true, producedBy: 'workspace-ui', producerKey: `ws:verdict:${String(goal.params.opportunityId)}` })],
        ).catch(() => { });
      }
    }
    return res.status(200).json({ ok: true, goalId, capabilityId: goal.capabilityId, message: `submitted as governed goal ${goalId.slice(0, 8)} — the daemon executes under existing policy` });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'goal insert failed' });
  }
}
