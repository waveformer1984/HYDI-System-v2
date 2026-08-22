import { NextApiRequest, NextApiResponse } from 'next';
import { getKeyManagementService } from '../../../lib/operational/KeyManagementService';

/**
 * POST /api/keys/reconcile — Reconcile inventory with environment
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const kms = getKeyManagementService();
    const result = await kms.discover();

    return res.status(200).json({
      added: result.added.length,
      updated: result.updated.length,
      removed: result.removed.length,
      details: {
        added: result.added.map(k => ({ id: k.id, envVar: k.envVar, provider: k.provider })),
        updated: result.updated.map(k => ({ id: k.id, envVar: k.envVar, provider: k.provider })),
        removed: result.removed.map(k => ({ id: k.id, envVar: k.envVar, provider: k.provider })),
      },
    });
  } catch (error) {
    console.error('Key reconcile API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}
