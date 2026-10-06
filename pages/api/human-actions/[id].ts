/**
 * API LAYER — GET/POST /api/human-actions/[id]
 *
 * GET returns one action. POST performs an operation:
 *   { op: 'claim' }   — human takes ownership (open → claimed)
 *   { op: 'verify' }  — re-run the action's verifier against the real world;
 *                       success resolves it as auto_verified, failure keeps
 *                       it open with the recorded reason
 *   { op: 'resolve', note } — human attestation; only valid for manual
 *                       actions or after a passing verify (the audit trail
 *                       distinguishes human_attested from auto_verified)
 *   { op: 'reject', reason } — close as rejected
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { HumanActionService } from '../../../lib/human-actions/index.js';
import { requireAuth } from '../../../lib/auth/requireAuth.js';
import { verifyServiceToken } from '../../../lib/auth/verifyServiceToken.js';

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function authed(req: NextApiRequest, res: NextApiResponse, permission: string) {
  const sb = getSupabase();
  if (sb) return requireAuth(req, res, sb, { permission, routeName: 'human-actions-id' });
  const result = verifyServiceToken(req.headers['x-hydi-service-token'] as string | undefined, process.env.HYDI_SERVICE_SECRET as string);
  if (!result.valid) { res.status(401).json({ error: 'Unauthorized', reason: result.reason }); return { ok: false as const }; }
  return { ok: true as const, role: 'owner' };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const id = req.query.id as string;
  const svc = new HumanActionService({});

  if (req.method === 'GET') {
    const auth = await authed(req, res, 'actions:view');
    if (!auth.ok) return;
    const action = svc.get(id);
    if (!action) return res.status(404).json({ error: 'human action not found' });
    return res.status(200).json({ action });
  }

  if (req.method === 'POST') {
    const auth = await authed(req, res, 'actions:approve');
    if (!auth.ok) return;
    const { op, note, reason } = (req.body || {}) as { op?: string; note?: string; reason?: string };
    try {
      switch (op) {
        case 'claim': return res.status(200).json({ ok: true, ...svc.claim(id) });
        case 'verify': return res.status(200).json({ ok: true, ...(await svc.verify(id)) });
        case 'resolve': return res.status(200).json({ ok: true, ...svc.resolve(id, { note }) });
        case 'reject': return res.status(200).json({ ok: true, ...svc.reject(id, { reason }) });
        default: return res.status(400).json({ ok: false, error: `unknown op '${op}'` });
      }
    } catch (e) {
      return res.status(409).json({ ok: false, error: e instanceof Error ? e.message : 'failed' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
