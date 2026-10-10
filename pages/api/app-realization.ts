/**
 * API LAYER — GET/POST /api/app-realization
 *
 * The app-realization mission's read/advance surface. GET returns the
 * durable mission state for an app (stage, evidence, waiting
 * prerequisites). POST {op:'advance', app:'proto-yi'} runs one
 * idempotent pass of the stage machine — every autonomous check it can
 * run, then parks on genuine human boundaries. Deploy/offer authority
 * stays human; nothing here registers processes or sets prices.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth/requireAuth.js';
import { verifyServiceToken } from '../../lib/auth/verifyServiceToken.js';
import { getGoalSystem } from '../../lib/heidi/GoalSystem';
import { advance, brief } from '../../lib/realization/app-realization.js';

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function authed(req: NextApiRequest, res: NextApiResponse, permission: string) {
  const sb = getSupabase();
  if (sb) return requireAuth(req, res, sb, { permission, routeName: 'app-realization' });
  const result = verifyServiceToken(req.headers['x-hydi-service-token'] as string | undefined, process.env.HYDI_SERVICE_SECRET as string);
  if (!result.valid) { res.status(401).json({ error: 'Unauthorized', reason: result.reason }); return { ok: false as const }; }
  return { ok: true as const, role: 'owner' };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const goals = getGoalSystem();
  const appId = ((req.query.app as string) || (req.body && (req.body as { app?: string }).app) || '').trim();
  if (!appId) return res.status(400).json({ ok: false, error: "missing 'app' (query ?app= or body {app:})" });

  if (req.method === 'GET') {
    const auth = await authed(req, res, 'actions:view');
    if (!auth.ok) return;
    const { report, text } = await brief({ goals, appId, actor: 'api-read' });
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ report, briefing: text });
  }

  if (req.method === 'POST') {
    const auth = await authed(req, res, 'actions:approve');
    if (!auth.ok) return;
    const { op } = (req.body || {}) as { op?: string };
    if (op !== 'advance') return res.status(400).json({ ok: false, error: `unknown op '${op}'` });
    const report = await advance({ goals, appId, actor: 'api' });
    return res.status(200).json({ ok: true, report });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
