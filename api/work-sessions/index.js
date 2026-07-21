// Mobile "Agent view" (Phase 8) — current goal, current task, queue depth,
// last action, and completion history. Reads the existing autonomous-work
// kernel (lib/work-sessions.ts's `work_sessions` table + the `actions`
// log) rather than building a parallel goal engine — see
// HYDI_KERNEL_ARCHITECTURE_ROADMAP.md's non-goal: "No new orchestrator
// class... until Phase 0's triage is done." Goal execution itself still
// only happens via HeidiOrchestrator.runWorkSession(); this route is
// read-only.

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth/requireAuth.js';

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.MOBILE_CHAT_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const permission = req.query && req.query.own === 'true' ? 'work_sessions:view_own' : 'work_sessions:view';
  const auth = await requireAuth(req, res, supabase, { permission, routeName: 'work-sessions' });
  if (!auth.ok) return;

  let sessionQuery = supabase.from('work_sessions').select('*').order('created_at', { ascending: false }).limit(25);
  if (permission === 'work_sessions:view_own') {
    // NOTE: user_id is a free-text field on work_sessions with no
    // cryptographic link to the caller's device identity (same unresolved
    // gap as api/rezonate/route.js's x-user-id trust model — see
    // ROADMAP.md's identity-verification item). Requiring it here at least
    // closes the full-bypass case where omitting it returned every user's
    // sessions unfiltered to a low-trust 'agent'-role caller.
    if (!req.query.user_id) {
      return res.status(400).json({ error: 'user_id is required when own=true' });
    }
    sessionQuery = sessionQuery.eq('user_id', req.query.user_id);
  }

  const [sessionsResult, queueResult] = await Promise.all([
    sessionQuery,
    supabase.from('actions').select('status').eq('status', 'pending'),
  ]);

  if (sessionsResult.error) return res.status(500).json({ error: sessionsResult.error.message });

  const sessions = (sessionsResult.data || []).map((s) => {
    const steps = Array.isArray(s.steps) ? s.steps : [];
    const currentStep = steps.find((st) => st.status === 'in_progress' || st.status === 'pending');
    return {
      id: s.id,
      goal: s.goal,
      status: s.status,
      current_task: currentStep ? currentStep.description || currentStep.type : null,
      completed_steps: steps.filter((st) => st.status === 'completed').length,
      total_steps: steps.length,
      created_at: s.created_at,
      completed_at: s.completed_at,
    };
  });

  return res.status(200).json({
    sessions,
    active_goal: sessions.find((s) => s.status === 'in_progress') || null,
    queue_depth: (queueResult.data || []).length,
  });
}
