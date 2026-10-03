/**
 * API LAYER - POST /api/proposals/[id]
 *
 * Resolves a governed action proposal. The body carries ONLY the decision
 * ('approve' | 'reject') — capability and parameters are resolved
 * server-side from the stored proposal row and re-validated inside the
 * consume transaction. An approval executes nothing in this process: it
 * atomically consumes the proposal and inserts a pending heidi_goals row
 * that the daemon's existing planner -> MissionRunner -> ledger path
 * picks up and durably settles.
 *
 * Guards enforced in resolveProposal():
 *   - consume-once: status must still be 'pending'
 *   - expiry: expires_at must be in the future (expired rows are settled
 *     non-executing)
 *   - binding: params_hash recomputed from stored row must match what was
 *     displayed, and the conditional UPDATE re-asserts it at write time
 *   - allowlist: capability re-validated at consume time
 *
 * Auth: requireAuth 'actions:approve' — the same permission that gates
 * the existing ProtoForge action-resolution surface.
 */

import { createClient } from '@supabase/supabase-js';
import { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '../../../lib/auth/requireAuth.js';
import { resolveProposal, getProposalPool } from '../../../lib/heidi/ActionProposals';

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

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res, getSupabase(), { permission: 'actions:approve', routeName: 'proposals-resolve' });
  if (!auth.ok) return;

  const { id } = req.query;
  if (typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) {
    return res.status(400).json({ error: 'Invalid proposal id' });
  }

  const { decision } = req.body as { decision?: string };
  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({ error: 'Body must include decision: "approve" | "reject"' });
  }

  const decidedBy = `user:${auth.role}${auth.deviceId ? `:${auth.deviceId}` : ''}`;

  try {
    const result = await resolveProposal(getProposalPool(), { id, decision, decidedBy });
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    return res.status(200).json({
      status: result.status,
      goalId: result.goalId ?? null,
      decidedBy,
    });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'unknown' });
  }
}
