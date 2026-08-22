/**
 * GET /api/operator/goals
 *
 * List all active goals with their operational state.
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

  try {
    const cp = getControlPlane();
    const goals = cp.listActiveGoals();

    res.status(200).json(sanitizeResponse({
      goals,
      count: goals.length,
      timestamp: new Date().toISOString(),
    }));
  } catch (error) {
    console.error('[/api/operator/goals] Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'unknown',
      timestamp: new Date().toISOString(),
    });
  }
}
