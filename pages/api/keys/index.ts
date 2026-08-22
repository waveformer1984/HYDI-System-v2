import { NextApiRequest, NextApiResponse } from 'next';
import { getKeyManagementService } from '../../../lib/operational/KeyManagementService';
import { getKeyAuditService } from '../../../lib/operational/KeyAuditService';
import { SecretScanner } from '../../../lib/operational/SecretScanner';
import { KeyHealthMonitor } from '../../../lib/operational/KeyHealthMonitor';
import { KeyCompromiseResponse } from '../../../lib/operational/KeyCompromiseResponse';

/**
 * GET /api/keys
 *
 * Returns the key inventory with health summary.
 * Never returns secret values — only metadata, fingerprints, and lifecycle states.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const kms = getKeyManagementService();
    const inventory = kms.getInventory();

    return res.status(200).json({
      summary: inventory.summary,
      keys: inventory.keys,
      lastReconciledAt: inventory.lastReconciledAt,
    });
  } catch (error) {
    console.error('Keys API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}
