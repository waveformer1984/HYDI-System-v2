// Vercel serverless function — multi-step goal execution entry point.
// Mirrors pages/api/goals/route.ts for Express-style deployments.
//
// When ADAPTIVE_OPERATOR_ENABLED=true, goals are delegated to
// AdaptiveOperator (observes environment, plans from reality, replans
// on deviations). When false, the legacy LLM-decompose path is used.

import { HeidiOrchestrator } from '../../lib/orchestrator.js';
import { requireAuth } from '../../lib/auth/requireAuth.js';
import { isAdaptiveOperatorEnabled } from '../../lib/adaptive-operator/ProductionBounds.js';

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }
    const { createClient } = require('@supabase/supabase-js');
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.MOBILE_CHAT_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireAuth(req, res, supabase, { permission: 'work_sessions:create', routeName: 'goals' });
  if (!auth.ok) return;

  const { goal, session_id, user_id, maxSteps } = req.body || {};
  if (!goal || typeof goal !== 'string') return res.status(400).json({ error: 'Missing required field: goal (string)' });
  if (!session_id || typeof session_id !== 'string') return res.status(400).json({ error: 'Missing required field: session_id (string)' });
  if (!user_id || typeof user_id !== 'string') return res.status(400).json({ error: 'Missing required field: user_id (string)' });

  try {
    const orchestrator = new HeidiOrchestrator();
    const adaptiveEnabled = isAdaptiveOperatorEnabled();
    console.log(`[api/goals] Goal: "${goal}" | AdaptiveOperator: ${adaptiveEnabled ? 'ENABLED' : 'disabled (legacy path)'}`);

    const session = await orchestrator.startWorkSession(goal, session_id, user_id, maxSteps ?? 5);
    if (!session) return res.status(500).json({ error: 'Failed to create work session' });

    return res.status(200).json({ session, adaptive_operator_enabled: adaptiveEnabled });
  } catch (error) {
    console.error('[api/goals] Goal execution failed:', error instanceof Error ? error.message : 'Unknown error');
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}
