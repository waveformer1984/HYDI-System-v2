/**
 * GET /api/operator/status
 *
 * Returns the overall operational summary of the human proxy control plane.
 * Read-only — never executes actions.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { authenticate, getControlPlane, sanitizeResponse } from '../../../lib/operator-api-shared';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authenticate(req, res, 'status:view');
  if (!auth || !auth.ok) return;

  try {
    const cp = getControlPlane();
    const summary = cp.getOperationalSummary();
    const pendingInterventions = cp.listPendingInterventions();

    const status = {
      controlPlane: 'online',
      activeGoals: summary.activeGoals,
      pendingInterventions: summary.pendingInterventions,
      completedGoals: summary.completedGoals,
      failedGoals: summary.failedGoals,
      totalActions: summary.totalActions,
      totalReplans: summary.totalReplans,
      totalRecoveries: summary.totalRecoveries,
      interventions: pendingInterventions.map((i: any) => ({
        interventionId: i.requestId,
        goalId: i.goalId,
        type: i.interventionType,
        reason: i.blocker,
        requiredAction: i.requiredHumanAction,
        status: i.status,
        createdAt: i.requestedAt,
        expiresAt: i.expiresAt,
      })),
      recentEvents: summary.recentEvents.slice(0, 10).map((e: any) => ({
        eventId: e.eventId,
        goalId: e.goalId,
        eventType: e.eventType,
        timestamp: e.timestamp,
      })),
      timestamp: new Date().toISOString(),
    };

    res.status(200).json(sanitizeResponse(status));
  } catch (error) {
    console.error('[/api/operator/status] Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'unknown',
      timestamp: new Date().toISOString(),
    });
  }
}
