/**
 * API LAYER - /api/actions/[id]
 *
 * Resolves a chat-originated action that ProtoForge escalated for human
 * review. See lib/action-approval.ts for the actual resolution logic —
 * this route is a thin HTTP wrapper around it.
 */

import { createClient } from '@supabase/supabase-js';
import { NextApiRequest, NextApiResponse } from 'next';
import { resolvePendingAction } from '../../../lib/action-approval';
import { requireAuth } from '../../../lib/auth/requireAuth.js';
import structuredLogger from '../../../lib/structured-logger';

const logger = structuredLogger.child({ component: 'api/actions' });

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
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // This approves/rejects a ProtoForge-escalated action -- i.e. one that
  // was specifically flagged as needing human review before it runs.
  // Was previously reachable by anyone with zero authentication, which
  // defeated the point of the escalation gate entirely. See
  // ISSUES_FOUND.md. NOTE: this means the dashboard's approve/reject
  // buttons (pages/index.tsx) now need a credential wired up client-side
  // before they'll work again -- tracked as the top follow-up priority.
  const auth = await requireAuth(req, res, getSupabase(), { permission: 'actions:approve', routeName: 'actions-resolve' });
  if (!auth.ok) return;

  const { id } = req.query;
  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing action id' });
  }

  const { decision } = req.body as { decision?: string };
  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({ error: 'Body must include decision: "approve" | "reject"' });
  }

  try {
    const result = await resolvePendingAction(id, decision);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    return res.status(200).json(result);
  } catch (error) {
    logger.error('resolution failed', { error: error instanceof Error ? error.message : 'Unknown error' });
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}
