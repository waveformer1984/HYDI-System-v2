/**
 * GET /api/operator/goals/:goalId
 *
 * Get the operational state for a specific goal.
 * Read-only — never executes actions.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { authenticate, getControlPlane, sanitizeResponse } from '../../../../lib/operator-api-shared';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authenticate(req, res, 'work_sessions:view');
  if (!auth || !auth.ok) return;

  const { goalId } = req.query;
  if (!goalId || typeof goalId !== 'string') {
    return res.status(400).json({ error: 'Missing goalId' });
  }

  try {
    const cp = getControlPlane();
    const state = cp.getGoalState(goalId as string);

    if (!state) {
      return res.status(404).json({ error: 'Goal not found' });
    }

    res.status(200).json(sanitizeResponse(state));
  } catch (error) {
    console.error('[/api/operator/goals/:goalId] Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'unknown',
      timestamp: new Date().toISOString(),
    });
  }
}
