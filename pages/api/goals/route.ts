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
 * SECURITY: This is the first externally-reachable trigger for autonomous
 * multi-step action execution in a system doing Stripe Connect. It is
 * treated with the scrutiny of a payment endpoint, not a read API:
 *   - requireAuth (service token or device token + RBAC)
 *   - Rate limited (10 goals/min per IP — tighter than default 60)
 *   - Input validation: goal length, session_id format, user_id format
 *   - Injection protection: strips control chars, blocks prompt-injection
 *     patterns that could override the planner's goal-to-objective mapping
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

// --- Input validation constants ---
const MAX_GOAL_LENGTH = 2000;
const MAX_SESSION_ID_LENGTH = 128;
const MAX_USER_ID_LENGTH = 128;
const MAX_STEPS = 50;
const MIN_STEPS = 1;

// Session/user IDs must be alphanumeric + dash/underscore only — no shell
// injection, no path traversal, no SQL meta-characters.
const ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

// Control characters (0x00-0x1F, 0x7F) and Unicode line/paragraph
// separators — stripped from goal text to prevent terminal/log injection.
const CONTROL_CHARS = /[\x00-\x1F\x7F\u2028\u2029]/g;

// Prompt-injection patterns that could hijack the planner's goal
// classification. These are heuristic — not a complete defense, but they
// catch the obvious "ignore previous instructions" class.
const PROMPT_INJECTION_PATTERNS = [
  /ignore\s+(all\s+)?(previous\s+)?instructions/i,
  /disregard\s+(all\s+)?(previous\s+)?(instructions|directives)/i,
  /you\s+are\s+now\s+(in\s+)?(debug|admin|root|developer)\s+mode/i,
  /system\s+prompt\s*:/i,
  /\bACT\s+AS\s+(if\s+you\s+(are|have))?\s*(root|admin|sudo)/i,
];

interface GoalRequestBody {
  goal?: string;
  session_id?: string;
  user_id?: string;
  maxSteps?: number;
}

function validateGoalInput(body: GoalRequestBody): {
  ok: boolean;
  error?: string;
  goal?: string;
  sessionId?: string;
  userId?: string;
  maxSteps?: number;
} {
  const { goal, session_id, user_id, maxSteps } = body;

  // --- Required fields ---
  if (!goal || typeof goal !== 'string') {
    return { ok: false, error: 'Missing required field: goal (string)' };
  }
  if (!session_id || typeof session_id !== 'string') {
    return { ok: false, error: 'Missing required field: session_id (string)' };
  }
  if (!user_id || typeof user_id !== 'string') {
    return { ok: false, error: 'Missing required field: user_id (string)' };
  }

  // --- Length limits ---
  if (goal.length > MAX_GOAL_LENGTH) {
    return { ok: false, error: `Goal exceeds max length (${MAX_GOAL_LENGTH} chars)` };
  }
  if (session_id.length > MAX_SESSION_ID_LENGTH) {
    return { ok: false, error: `session_id exceeds max length (${MAX_SESSION_ID_LENGTH} chars)` };
  }
  if (user_id.length > MAX_USER_ID_LENGTH) {
    return { ok: false, error: `user_id exceeds max length (${MAX_USER_ID_LENGTH} chars)` };
  }

  // --- ID format (alphanumeric + dash/underscore) ---
  if (!ID_PATTERN.test(session_id)) {
    return { ok: false, error: 'session_id must be alphanumeric + dash/underscore only' };
  }
  if (!ID_PATTERN.test(user_id)) {
    return { ok: false, error: 'user_id must be alphanumeric + dash/underscore only' };
  }

  // --- Strip control characters from goal ---
  const cleanGoal = goal.replace(CONTROL_CHARS, '').trim();
  if (cleanGoal.length === 0) {
    return { ok: false, error: 'Goal is empty after sanitization' };
  }

  // --- Prompt-injection detection ---
  for (const pattern of PROMPT_INJECTION_PATTERNS) {
    if (pattern.test(cleanGoal)) {
      return { ok: false, error: 'Goal rejected: potential prompt injection detected' };
    }
  }

  // --- maxSteps validation ---
  let validatedMaxSteps: number | undefined;
  if (maxSteps !== undefined) {
    if (typeof maxSteps !== 'number' || !Number.isFinite(maxSteps)) {
      return { ok: false, error: 'maxSteps must be a finite number' };
    }
    if (maxSteps < MIN_STEPS || maxSteps > MAX_STEPS) {
      return { ok: false, error: `maxSteps must be between ${MIN_STEPS} and ${MAX_STEPS}` };
    }
    validatedMaxSteps = Math.floor(maxSteps);
  }

  return {
    ok: true,
    goal: cleanGoal,
    sessionId: session_id,
    userId: user_id,
    maxSteps: validatedMaxSteps,
  };
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // --- Auth + rate limiting ---
  // Rate limited to 10 goals/min per IP — tighter than the default 60
  // because each goal can trigger autonomous multi-step execution.
  const auth = await requireAuth(req, res, getSupabase(), {
    permission: 'work_sessions:create',
    routeName: 'goals',
    rateMax: 10,
  });
  if (!auth.ok) return;

  // --- Input validation ---
  const validated = validateGoalInput(req.body as GoalRequestBody);
  if (!validated.ok) {
    return res.status(400).json({ error: validated.error });
  }

  try {
    const orchestrator = new HeidiOrchestrator();
    const adaptiveEnabled = isAdaptiveOperatorEnabled();
    console.log(
      `[api/goals] Goal: "${validated.goal!.slice(0, 100)}" | `
      + `AdaptiveOperator: ${adaptiveEnabled ? 'ENABLED' : 'disabled (legacy path)'} | `
      + `user: ${validated.userId} | session: ${validated.sessionId}`,
    );

    const session = await orchestrator.startWorkSession(
      validated.goal!,
      validated.sessionId!,
      validated.userId!,
      validated.maxSteps ?? 5,
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
