/**
 * GET /api/operator/recovery
 *
 * Get recovery history across all goals, or for a specific goal.
 * Read-only — never executes actions.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { authenticate, getControlPlane, sanitizeResponse } from '../../../lib/operator-api-shared';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authenticate(req, res, 'work_sessions:view');
  if (!auth || !auth.ok) return;

  try {
    const cp = getControlPlane();
    const { goalId } = req.query;

    if (goalId && typeof goalId === 'string') {
      const history = cp.getRecoveryHistory(goalId as string);
      return res.status(200).json(sanitizeResponse({
        goalId,
        recoveryEvents: history,
        count: history.length,
        timestamp: new Date().toISOString(),
      }));
    }

    // Get recovery events across all active goals
    const goals = cp.listActiveGoals();
    const allRecovery: Array<{ goalId: string; events: typeof history }> = [];
    for (const goal of goals) {
      const history = cp.getRecoveryHistory(goal.goalId);
      if (history.length > 0) {
        allRecovery.push({ goalId: goal.goalId, events: history });
      }
    }

    res.status(200).json(sanitizeResponse({
      recoveryHistory: allRecovery,
      totalRecoveryEvents: allRecovery.reduce((sum, r) => sum + r.events.length, 0),
      timestamp: new Date().toISOString(),
    }));
  } catch (error) {
    console.error('[/api/operator/recovery] Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'unknown',
      timestamp: new Date().toISOString(),
    });
  }
}
