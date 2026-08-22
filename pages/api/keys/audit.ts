import { NextApiRequest, NextApiResponse } from 'next';
import { getKeyAuditService } from '../../../lib/operational/KeyAuditService';

/**
 * GET /api/keys/audit — Key lifecycle audit trail
 * Query params: ?limit=50&keyId=xxx&provider=xxx&operation=xxx
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const audit = getKeyAuditService();
    const limit = parseInt(req.query.limit as string, 10) || 50;

    let records;
    if (req.query.keyId) {
      records = audit.getByKeyId(req.query.keyId as string);
    } else if (req.query.provider) {
      records = audit.getByProvider(req.query.provider as string);
    } else if (req.query.operation) {
      records = audit.getByOperation(req.query.operation as never);
    } else {
      records = audit.getRecent(limit);
    }

    return res.status(200).json({
      records,
      count: records.length,
    });
  } catch (error) {
    console.error('Key audit API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}
