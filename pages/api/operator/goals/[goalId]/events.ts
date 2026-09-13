/**
 * GET /api/operator/goals/:goalId/events
 *
 * Get the operational event stream for a goal.
 * Read-only — never executes actions.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { authenticate, getControlPlane, sanitizeResponse } from '../../../../../lib/operator-api-shared';

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
    const events = cp.getGoalEvents(goalId as string);

    res.status(200).json(sanitizeResponse({
      goalId,
      events,
      count: events.length,
      timestamp: new Date().toISOString(),
    }));
  } catch (error) {
    console.error('[/api/operator/goals/:goalId/events] Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'unknown',
      timestamp: new Date().toISOString(),
    });
  }
}
