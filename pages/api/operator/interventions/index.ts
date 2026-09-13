/**
 * GET /api/operator/interventions
 *
 * List pending interventions across all goals.
 * Read-only — never executes actions.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { authenticate, getControlPlane, getInterventionController, sanitizeResponse } from '../../../../lib/operator-api-shared';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authenticate(req, res, 'work_sessions:view');
  if (!auth || !auth.ok) return;

  try {
    const cp = getControlPlane();
    const controller = getInterventionController();
    const pending = cp.listPendingInterventions();

    const interventions = pending.map((i: any) => {
      const detail = controller.getInterventionDetail(i.requestId);
      return detail ?? {
        interventionId: i.requestId,
        goalId: i.goalId,
        reason: i.blocker,
        requiredHumanAction: i.requiredHumanAction,
        status: i.status,
        createdAt: i.requestedAt,
        expiresAt: i.expiresAt,
        interventionType: i.interventionType,
      };
    });

    res.status(200).json(sanitizeResponse({
      interventions,
      count: interventions.length,
      timestamp: new Date().toISOString(),
    }));
  } catch (error) {
    console.error('[/api/operator/interventions] Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'unknown',
      timestamp: new Date().toISOString(),
    });
  }
}
