import { NextApiRequest, NextApiResponse } from 'next';
import { getKeyManagementService } from '../../../lib/operational/KeyManagementService';
import { KeyCompromiseResponse } from '../../../lib/operational/KeyCompromiseResponse';

/**
 * GET /api/keys/:id — Get key metadata (never the value)
 * POST /api/keys/:id/validate — Validate the key against the provider
 * POST /api/keys/:id/rotate — Rotate the key
 * POST /api/keys/:id/revoke — Revoke the key
 * POST /api/keys/:id/recover — Recover from credential failure
 * DELETE /api/keys/:id — Destroy the key
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  const { id } = req.query;
  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'Key ID required' });
  }

  const kms = getKeyManagementService();

  try {
    if (req.method === 'GET') {
      const key = kms.getKey(id);
      if (!key) return res.status(404).json({ error: 'Key not found' });
      return res.status(200).json(key);
    }

    if (req.method === 'POST') {
      const action = req.query.action;

      if (action === 'validate') {
        const result = await kms.validate(id);
        return res.status(200).json(result);
      }

      if (action === 'rotate') {
        const result = await kms.rotate(id);
        return res.status(200).json(result);
      }

      if (action === 'revoke') {
        const result = await kms.revoke(id);
        return res.status(200).json(result);
      }

      if (action === 'recover') {
        const result = await kms.recover(id);
        return res.status(200).json(result);
      }

      if (action === 'compromise') {
        const { suspicion } = req.body;
        if (!suspicion) return res.status(400).json({ error: 'suspicion required' });
        const compromiseResponse = new KeyCompromiseResponse(kms);
        const result = await compromiseResponse.respond(id, suspicion);
        return res.status(200).json(result);
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    if (req.method === 'DELETE') {
      const result = await kms.destroy(id);
      return res.status(200).json(result);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('Key operation error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}
