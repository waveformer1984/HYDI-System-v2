/**
 * API LAYER — GET/POST /api/revenue/service-switch
 *
 * The durable, auditable ON/OFF control for a commercial service.
 * Three deliberately separate flags — one switch never grants everything:
 *
 *   serviceEnabled      — Heidi may run the service workflow: resolve
 *                         machine-executable blockers, research prospects,
 *                         prepare offers, dispatch eligible fulfillment.
 *   acquisitionEnabled  — Heidi may prospect/outreach under policy.
 *   livePaymentsEnabled — live payment surface (still requires live
 *                         credentials + per-transaction authorization —
 *                         this flag NEVER grants those).
 *
 *   GET              — read the switch state for ?serviceId= (default
 *                      checkpoint_audit). Read-only.
 *   POST {flags, reason} — flip flags; every change is appended to the
 *                      durable transitions[] audit log by the store.
 *
 * Fail-closed: unreadable config reads as all-OFF. POST accepts only the
 * three known flag fields — anything else is ignored, never persisted.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../../lib/auth/requireAuth.js';
import { verifyServiceToken } from '../../../lib/auth/verifyServiceToken.js';

const { getServiceSwitch, setServiceSwitch, SWITCH_FIELDS } = require('../../../lib/revenue/revenue-service-switch.js');

function getSupabase() {
  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) return null;
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
}

async function authed(req: NextApiRequest, res: NextApiResponse, permission: string) {
  const sb = getSupabase();
  if (sb) return requireAuth(req, res, sb, { permission, routeName: 'revenue-service-switch' });
  const result = verifyServiceToken(req.headers['x-hydi-service-token'] as string | undefined, process.env.HYDI_SERVICE_SECRET as string);
  if (!result.valid) { res.status(401).json({ error: 'Unauthorized', reason: result.reason }); return { ok: false as const }; }
  return { ok: true as const, role: 'owner' };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const serviceId = typeof req.query.serviceId === 'string' ? req.query.serviceId : 'checkpoint_audit';

  if (req.method === 'GET') {
    const auth = await authed(req, res, 'revenue:view');
    if (!auth.ok) return;
    const state = getServiceSwitch(serviceId);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ ok: true, serviceId, ...state });
  }

  if (req.method === 'POST') {
    const auth = await authed(req, res, 'revenue:manage');
    if (!auth.ok) return;
    const body = (req.body || {}) as Record<string, unknown>;
    const sid = typeof body.serviceId === 'string' ? body.serviceId : serviceId;
    const changes: Record<string, boolean> = {};
    for (const f of SWITCH_FIELDS as string[]) {
      if (typeof body[f] === 'boolean') changes[f] = body[f] as boolean;
    }
    // livePaymentsEnabled is intentionally honored — the flag alone moves
    // no money: LiveTransactionAuthorization still gates every transaction.
    const actor = typeof body.actor === 'string' ? body.actor : 'operator';
    const reason = typeof body.reason === 'string' ? body.reason : null;
    const result = setServiceSwitch(sid, changes, { actor, reason });
    return res.status(200).json({
      ok: true,
      serviceId: sid,
      changed: result.changed,
      applied: result.applied,
      state: result.state,
      note: 'serviceEnabled governs automatically initiated commercial work; acquisitionEnabled governs outreach; livePaymentsEnabled still requires live credentials + per-transaction authorization — this flag alone moves no money',
    });
  }

  res.setHeader('Allow', 'GET, POST');
  return res.status(405).json({ error: 'Method not allowed' });
}
