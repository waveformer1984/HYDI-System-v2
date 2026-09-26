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
 */
import { NextApiRequest, NextApiResponse } from 'next';
import fs from 'fs';
import path from 'path';
import pg from 'pg';

const REPO = 'C:\\Users\\Owner\\HYDI-System-v2';
const pool = new pg.Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
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
  } else {
    return res.status(400).json({ error: `unknown action kind '${kind}' — allowed: acknowledge, resolve, fix, investigate, investigate_opportunity` });
  }

  try {
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
    return res.status(200).json({ ok: true, goalId, capabilityId: goal.capabilityId, message: `submitted as governed goal ${goalId.slice(0, 8)} — the daemon executes under existing policy` });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'goal insert failed' });
  }
}
