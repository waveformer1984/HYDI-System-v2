/**
 * API LAYER - /api/execute
 *
 * SECURITY: This route previously allowed unauthenticated direct execution of
 * actions (send_email, create_task, update_database, etc.), bypassing
 * HumanActionEngine, AuthorityManager, AdaptiveOperator, and the entire
 * governed execution pipeline. This is a critical safety violation.
 *
 * The route now requires authentication and rejects all direct execution
 * attempts. Callers must use the proper governed execution path:
 *   POST /api/goals → AdaptiveOperator → HumanActionEngine
 *
 * This route is retained as a governance denial endpoint to ensure any
 * legacy callers receive a clear error directing them to the correct path.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '../../lib/auth/requireAuth.js';

let _supabase: ReturnType<typeof import('@supabase/supabase-js').createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase env vars not configured');
    }
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication — this was previously unauthenticated
  const auth = await requireAuth(req, res, getSupabase(), {
    permission: 'work_sessions:create',
    routeName: 'execute',
  });
  if (!auth.ok) return;

  // Reject all direct execution attempts — the governed path is /api/goals
  return res.status(403).json({
    error: 'Direct execution is forbidden',
    reason: 'This endpoint bypasses HumanActionEngine and the governed execution pipeline. Use POST /api/goals to create a goal that will be executed through the proper governed path: AdaptiveOperator → HumanActionEngine → AuthorityManager → VerificationContract.',
    governed_path: '/api/goals',
    timestamp: new Date().toISOString(),
  });
}
