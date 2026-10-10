/**
 * API LAYER — GET/POST /api/human-actions
 *
 * The read/write surface for HYDI's Human Actions: durable tasks that only
 * a human operator can complete (credentials, funding, external approvals).
 * GET lists actions (default: all; ?status=open filters). POST creates one —
 * requests are dedupe-keyed on blocker_key so repeated requests for the same
 * blocker return the same open action instead of minting duplicates.
 * Secret values are never accepted or stored — verification specs name env
 * vars, never carry their contents.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { HumanActionService, syncHumanActions } from '../../../lib/human-actions/index.js';
import { getGoalSystem } from '../../../lib/heidi/GoalSystem';
import { requireAuth } from '../../../lib/auth/requireAuth.js';
import { verifyServiceToken } from '../../../lib/auth/verifyServiceToken.js';

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

// requireAuth needs a Supabase client for device-token resolution and audit
// logging. Without Supabase env we still require the service token — the
// surface stays closed, just unaudited (same as the pre-Phase-4 internal
// callers requireAuth documents).
async function authed(req: NextApiRequest, res: NextApiResponse, permission: string) {
  const sb = getSupabase();
  if (sb) return requireAuth(req, res, sb, { permission, routeName: 'human-actions' });
  const result = verifyServiceToken(req.headers['x-hydi-service-token'] as string | undefined, process.env.HYDI_SERVICE_SECRET as string);
  if (!result.valid) { res.status(401).json({ error: 'Unauthorized', reason: result.reason }); return { ok: false as const }; }
  return { ok: true as const, role: 'owner' };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const svc = new HumanActionService({});

  if (req.method === 'GET') {
    const auth = await authed(req, res, 'actions:view');
    if (!auth.ok) return;
    // Detection is the read-path cadence: every surface that lists actions
    // refreshes the known-blocker picture first. Idempotent — blockerKey
    // dedupe makes repeat scans free. Resolver execution is disabled on
    // this read path: a GET must never trigger an external mutation.
    await syncHumanActions(svc, getGoalSystem(), { resolve: { disabled: true } }).catch(() => null);
    const status = typeof req.query.status === 'string' ? req.query.status : undefined;
    const goalId = typeof req.query.goalId === 'string' ? req.query.goalId : undefined;
    const includeTerminal = req.query.all === '1';
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ actions: svc.list({ status, sourceGoalId: goalId, includeTerminal }) });
  }

  if (req.method === 'POST') {
    const auth = await authed(req, res, 'actions:approve');
    if (!auth.ok) return;
    const body = (req.body || {}) as Record<string, unknown>;
    try {
      const { action, created } = svc.request({
        blockerKey: body.blockerKey as string | undefined,
        type: body.type as string | undefined,
        title: body.title as string,
        description: body.description as string | undefined,
        instructions: Array.isArray(body.instructions) ? body.instructions : [],
        verifier: body.verifier as { name: string; spec: Record<string, unknown> } | undefined,
        source: 'api',
        sourceMissionId: body.sourceMissionId as string | undefined,
        sourceGoalId: body.sourceGoalId as string | undefined,
        sourceAgentId: body.sourceAgentId as string | undefined,
        expiresAt: body.expiresAt as string | undefined,
        resumePolicy: body.resumePolicy as 'auto' | 'none' | undefined,
        boundary: body.boundary as { category?: string; capability?: string; externalSystem?: string; externalObjectId?: string } | undefined,
        expectedOutcome: body.expectedOutcome as string | undefined,
        resumeCapability: body.resumeCapability as string | undefined,
        context: body.context as Record<string, unknown> | undefined,
        priority: body.priority as string | undefined,
      });
      return res.status(created ? 201 : 200).json({ ok: true, action, created });
    } catch (e) {
      return res.status(400).json({ ok: false, error: e instanceof Error ? e.message : 'invalid request' });
    }
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
