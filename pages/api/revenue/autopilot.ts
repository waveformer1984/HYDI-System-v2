/**
 * API LAYER — GET/POST /api/revenue/autopilot
 *
 * The revenue autopilot's read/advance surface. GET returns the durable
 * objective state (stage, opportunity, offer, waiting prerequisites).
 * POST {op:'advance'} runs one idempotent pass of the stage machine —
 * every autonomous step it can take, then parks on genuine human
 * boundaries. No endpoint here performs external financial actions:
 * checkout creation stays behind LiveTransactionAuthorization, exactly
 * as the rest of the system enforces it.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../../lib/auth/requireAuth.js';
import { verifyServiceToken } from '../../../lib/auth/verifyServiceToken.js';
import { getGoalSystem } from '../../../lib/heidi/GoalSystem';
import { advance, brief } from '../../../lib/revenue/revenue-autopilot.js';

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function authed(req: NextApiRequest, res: NextApiResponse, permission: string) {
  const sb = getSupabase();
  if (sb) return requireAuth(req, res, sb, { permission, routeName: 'revenue-autopilot' });
  const result = verifyServiceToken(req.headers['x-hydi-service-token'] as string | undefined, process.env.HYDI_SERVICE_SECRET as string);
  if (!result.valid) { res.status(401).json({ error: 'Unauthorized', reason: result.reason }); return { ok: false as const }; }
  return { ok: true as const, role: 'owner' };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const goals = getGoalSystem();

  if (req.method === 'GET') {
    const auth = await authed(req, res, 'actions:view');
    if (!auth.ok) return;
    const { report, text } = await brief({ goals, actor: 'api-read' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ report, briefing: text });
  }

  if (req.method === 'POST') {
    const auth = await authed(req, res, 'actions:approve');
    if (!auth.ok) return;
    const { op } = (req.body || {}) as { op?: string };
    if (op !== 'advance') return res.status(400).json({ ok: false, error: `unknown op '${op}'` });
    const report = await advance({ goals, actor: 'api' });
    return res.status(200).json({ ok: true, report });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
