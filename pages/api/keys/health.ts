import { NextApiRequest, NextApiResponse } from 'next';
import { getKeyManagementService } from '../../../lib/operational/KeyManagementService';
import { KeyHealthMonitor } from '../../../lib/operational/KeyHealthMonitor';
import { SecretScanner } from '../../../lib/operational/SecretScanner';

/**
 * GET /api/keys/health — Key health summary
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const kms = getKeyManagementService();
    const scanner = new SecretScanner(process.cwd());
    const monitor = new KeyHealthMonitor(kms, scanner);
    const result = await monitor.checkAll();

    return res.status(200).json(result);
  } catch (error) {
    console.error('Key health API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}
