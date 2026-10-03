/**
 * API LAYER - GET /api/proposals
 *
 * Lists governed action proposals for the chat UI's Actions panel.
 * Read-only: resolves nothing, executes nothing. Lazily expires stale
 * pending proposals (non-executing transition) before listing.
 *
 * Two panels:
 *   recommended — status='pending' and not yet expired
 *   history     — approved/rejected/expired/retracted, joined to the
 *                 mission the daemon ran (mission status/stage) so the
 *                 UI can show the truthful durable outcome.
 *
 * Auth: same workspace gate as the existing actions surface
 * (requireAuth, 'actions:view'). The list response includes the fields
 * needed to render a decision — it never carries secrets.
 */

import { createClient } from '@supabase/supabase-js';
import { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '../../../lib/auth/requireAuth.js';
import { listProposals, getProposalPool, PROPOSAL_ALLOWLIST } from '../../../lib/heidi/ActionProposals';

let _supabase: ReturnType<typeof createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}

function shape(r: {
  id: string; version: number; capability_id: string; params: Record<string, unknown>;
  params_hash: string; title: string; reason: string;
  expected_effects: string | null; risks: string | null;
  prerequisites: string | null; rollback: string | null; reversible: boolean;
  status: string; expires_at: string; decided_by: string | null;
  decided_at: string | null; goal_id: string | null; created_at: string;
  producer_key: string;
  authorization_consumed_at?: string | null;
  mission_id?: string | null; mission_status?: string | null; mission_stage?: string | null;
}) {
  return {
    id: r.id,
    version: r.version,
    capabilityId: r.capability_id,
    producerKey: r.producer_key,
    capabilityLabel: PROPOSAL_ALLOWLIST[r.capability_id]?.label ?? r.capability_id,
    params: r.params,
    title: r.title,
    reason: r.reason,
    expectedEffects: r.expected_effects,
    risks: r.risks,
    prerequisites: r.prerequisites,
    rollback: r.rollback,
    reversible: r.reversible,
    status: r.status,
    expiresAt: r.expires_at,
    decidedBy: r.decided_by,
    decidedAt: r.decided_at,
    goalId: r.goal_id,
    authorizedAt: r.authorization_consumed_at ?? null,
    missionId: r.mission_id ?? null,
    missionStatus: r.mission_status ?? null,
    missionStage: r.mission_stage ?? null,
    createdAt: r.created_at,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res, getSupabase(), { permission: 'actions:view', routeName: 'proposals-list' });
  if (!auth.ok) return;

  try {
    const { recommended, history } = await listProposals(getProposalPool());
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({
      recommended: recommended.map(shape),
      history: history.map(shape),
    });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'unknown' });
  }
}
