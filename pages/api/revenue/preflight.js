// Live Transaction Preflight
// GET /api/revenue/preflight
//
// Returns a deterministic preflight result:
//   READY   — all checks pass, live transaction may proceed
//   BLOCKED — one or more checks failed
//   FAILED  — preflight itself encountered an error
//
// Auth: requires revenue:view permission.

import { runPreflight } from '../../../scripts/live-transaction-preflight.js';
import { requireAuth } from '../../../lib/auth/requireAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res, supabase, {
    permission: 'revenue:view',
    routeName: 'revenue-preflight',
  });
  if (!auth.ok) return;

  try {
    const result = await runPreflight();
    const httpStatus = result.state === 'READY' ? 200 : 200; // always 200, the state field carries the result
    return res.status(httpStatus).json(result);
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ state: 'FAILED', error: msg });
  }
}
