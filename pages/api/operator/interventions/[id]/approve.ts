/**
 * POST /api/operator/interventions/:id/approve
 *
 * Approve a pending intervention. The goal will resume from its checkpoint.
 * Mutation endpoint — requires operator authority.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { authenticate, getInterventionController, sanitizeResponse } from '../../../../../lib/operator-api-shared';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authenticate(req, res, 'actions:approve');
  if (!auth || !auth.ok) return;

  const { id } = req.query;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing intervention id' });
  }

  const { note } = req.body ?? {};

  try {
    const controller = getInterventionController();
    const result = await controller.approve(
      id as string,
      auth.role ?? 'unknown',
      typeof note === 'string' ? note.slice(0, 500) : undefined,
    );

    if (result.resolution === 'approved' && !result.resumed) {
      return res.status(200).json(sanitizeResponse({
        ok: true,
        result,
        message: result.reason,
      }));
    }

    res.status(200).json(sanitizeResponse({
      ok: true,
      result,
      message: result.reason,
    }));
  } catch (error) {
    console.error('[/api/operator/interventions/:id/approve] Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'unknown',
      timestamp: new Date().toISOString(),
    });
  }
}
