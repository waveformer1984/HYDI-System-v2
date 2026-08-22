/**
 * Intervention Queue API
 *
 * GET  /api/interventions          — list pending interventions
 * GET  /api/interventions?id=xxx   — get a specific intervention
 * POST /api/interventions          — resolve an intervention { id, resolution }
 *
 * All routes require auth (owner or operator role).
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { requireAuth } from '../../../lib/auth/requireAuth.js';

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

// In-memory intervention queue (shared singleton)
// In production, this would be backed by Supabase
let _queue: any = null;
function getQueue() {
  if (!_queue) {
    try {
      const { InterventionQueue } = require('../../../lib/delegated-operator/InterventionQueue');
      _queue = new InterventionQueue();
    } catch {
      _queue = null;
    }
  }
  return _queue;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  // Only GET and POST allowed
  if (req.method !== 'GET' && req.method !== 'POST') {
    res.setHeader('Allow', 'GET, POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const supabase = getSupabase();
  const auth = await requireAuth(req, res, supabase, {
    permission: 'work_sessions:create',
    routeName: 'interventions',
  });
  if (!auth) return; // requireAuth already sent error response

  const queue = getQueue();
  if (!queue) {
    return res.status(503).json({ error: 'Intervention queue not available' });
  }

  // GET — list or get specific intervention
  if (req.method === 'GET') {
    const { id, goalId } = req.query;

    if (id && typeof id === 'string') {
      const entry = queue.get(id);
      if (!entry) {
        return res.status(404).json({ error: 'Intervention not found' });
      }
      return res.status(200).json({ intervention: entry });
    }

    if (goalId && typeof goalId === 'string') {
      const entries = queue.getByGoal(goalId);
      return res.status(200).json({ interventions: entries });
    }

    // List all pending
    const pending = queue.getPending();
    return res.status(200).json({
      interventions: pending,
      count: pending.length,
    });
  }

  // POST — resolve an intervention
  if (req.method === 'POST') {
    const { id, resolution, action } = req.body;

    if (!id || typeof id !== 'string') {
      return res.status(400).json({ error: 'Missing required field: id' });
    }

    if (action === 'cancel') {
      const cancelled = queue.cancel(id);
      if (!cancelled) {
        return res.status(404).json({ error: 'Intervention not found or not pending' });
      }
      return res.status(200).json({ ok: true, action: 'cancelled' });
    }

    if (!resolution || typeof resolution !== 'string') {
      return res.status(400).json({ error: 'Missing required field: resolution' });
    }

    if (resolution.length > 2000) {
      return res.status(400).json({ error: 'Resolution too long (max 2000 chars)' });
    }

    const resolved = queue.resolve(id, resolution);
    if (!resolved) {
      return res.status(404).json({ error: 'Intervention not found or not pending' });
    }

    return res.status(200).json({
      ok: true,
      action: 'resolved',
      message: 'Intervention resolved. HYDI will resume the goal.',
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
