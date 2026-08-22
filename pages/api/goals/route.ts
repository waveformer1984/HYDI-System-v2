/**
 * API LAYER - /api/goals
 *
 * Entry point for multi-step goal execution. Accepts a natural-language
 * goal and routes it through HeidiOrchestrator.startWorkSession().
 *
 * When ADAPTIVE_OPERATOR_ENABLED=true (env flag, default false in
 * production), the goal is delegated to AdaptiveOperator which observes
 * the real environment, generates a reality-driven plan, executes through
 * the governed HumanActionEngine, verifies outcomes, and replans on
 * deviations. When false, the legacy LLM-decompose-then-run-step-by-step
 * path is used.
 *
 * See lib/adaptive-operator/AdaptiveOperatorIntegration.ts for the
 * integration bridge and lib/adaptive-operator/ProductionBounds.ts for
 * the production autonomy limits.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { HeidiOrchestrator } from '../../../lib/orchestrator';
import { requireAuth } from '../../../lib/auth/requireAuth.js';
import { isAdaptiveOperatorEnabled } from '../../../lib/adaptive-operator/ProductionBounds';

let _supabase: ReturnType<typeof import('@supabase/supabase-js').createClient> | null = null;
function getSupabase() {
  if (!_supabase) {
    const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
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

  const auth = await requireAuth(req, res, getSupabase(), { permission: 'work_sessions:create', routeName: 'goals' });
  if (!auth.ok) return;

  const { goal, session_id, user_id, maxSteps } = req.body as {
    goal?: string;
    session_id?: string;
    user_id?: string;
    maxSteps?: number;
  };

  if (!goal || typeof goal !== 'string') {
    return res.status(400).json({ error: 'Missing required field: goal (string)' });
  }
  if (!session_id || typeof session_id !== 'string') {
    return res.status(400).json({ error: 'Missing required field: session_id (string)' });
  }
  if (!user_id || typeof user_id !== 'string') {
    return res.status(400).json({ error: 'Missing required field: user_id (string)' });
  }

  try {
    const orchestrator = new HeidiOrchestrator();
    const adaptiveEnabled = isAdaptiveOperatorEnabled();
    console.log(`[api/goals] Goal: "${goal}" | AdaptiveOperator: ${adaptiveEnabled ? 'ENABLED' : 'disabled (legacy path)'}`);

    const session = await orchestrator.startWorkSession(
      goal,
      session_id,
      user_id,
      maxSteps ?? 5,
    );

    if (!session) {
      return res.status(500).json({ error: 'Failed to create work session' });
    }

    return res.status(200).json({
      session,
      adaptive_operator_enabled: adaptiveEnabled,
    });
  } catch (error) {
    console.error('[api/goals] Goal execution failed:', error instanceof Error ? error.message : 'Unknown error');
    return res.status(500).json({
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
