/**
 * API LAYER - GET /api/actions
 *
 * Lists chat-originated actions that ProtoForge escalated for human review
 * and that are still awaiting a decision — the read-side counterpart of
 * POST /api/actions/[id]. Before this route existed a pending approval was
 * only discoverable in the chat reply that created it, so a phone that
 * missed that reply had no way to find (and therefore approve or reject)
 * the action.
 *
 * Selection mirrors lib/action-approval.ts's own guard exactly: status
 * 'pending' AND payload.protoforge_pending_approval === true. The raw
 * action payload is not returned — only the type, ProtoForge's reasoning
 * and confidence, and a short parameter summary — so listing approvals
 * never exposes more than the approver needs to decide.
 */

import { createClient } from '@supabase/supabase-js';
import { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '../../../lib/auth/requireAuth.js';

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

interface ActionRow {
  id: string;
  session_id: string | null;
  task_name: string | null;
  status: string;
  payload: Record<string, unknown> | null;
  created_at: string | null;
}

function summarize(payload: Record<string, unknown>): string {
  const parts: string[] = [];
  const reasoning = payload.protoforge_reasoning;
  if (typeof reasoning === 'string' && reasoning) parts.push(reasoning);
  const params = payload.protoforge_action_payload;
  if (params && typeof params === 'object') {
    const keys = Object.keys(params as Record<string, unknown>).slice(0, 5);
    if (keys.length) parts.push(`params: ${keys.join(', ')}`);
  }
  const text = parts.join(' — ');
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res, getSupabase(), { permission: 'actions:view', routeName: 'actions-list' });
  if (!auth.ok) return;

  const { data, error } = await getSupabase()
    .from('actions')
    .select('id, session_id, task_name, status, payload, created_at')
    .eq('status', 'pending')
    .eq('payload->>protoforge_pending_approval', 'true')
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const actions = ((data || []) as ActionRow[])
    .filter((row) => row.payload && row.payload.protoforge_pending_approval === true)
    .map((row) => {
      const payload = row.payload || {};
      return {
        id: row.id,
        action_type: (payload.protoforge_action_type as string) || row.task_name || 'unknown',
        summary: summarize(payload),
        confidence: typeof payload.protoforge_confidence === 'number' ? payload.protoforge_confidence : null,
        session_id: row.session_id,
        created_at: row.created_at,
      };
    });

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({ actions });
}
