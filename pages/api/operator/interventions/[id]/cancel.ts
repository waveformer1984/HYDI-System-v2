/**
 * POST /api/operator/interventions/:id/cancel
 *
 * Cancel a pending intervention. The goal will not resume.
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

  const { reason } = req.body ?? {};

  try {
    const controller = getInterventionController();
    const result = await controller.cancel(
      id as string,
      auth.role ?? 'unknown',
      typeof reason === 'string' ? reason.slice(0, 500) : undefined,
    );

    res.status(200).json(sanitizeResponse({
      ok: true,
      result,
      message: result.reason,
    }));
  } catch (error) {
    console.error('[/api/operator/interventions/:id/cancel] Error:', error);
    res.status(500).json({
      error: error instanceof Error ? error.message : 'unknown',
      timestamp: new Date().toISOString(),
    });
  }
}
