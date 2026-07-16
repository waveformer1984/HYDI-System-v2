/**
 * API LAYER - /api/actions/[id]
 *
 * Resolves a chat-originated action that ProtoForge escalated for human
 * review. See lib/action-approval.ts for the actual resolution logic —
 * this route is a thin HTTP wrapper around it.
 */

import { NextApiRequest, NextApiResponse } from 'next';
import { resolvePendingAction } from '../../../lib/action-approval';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { id } = req.query;
  if (typeof id !== 'string') {
    return res.status(400).json({ error: 'Missing action id' });
  }

  const { decision } = req.body as { decision?: string };
  if (decision !== 'approve' && decision !== 'reject') {
    return res.status(400).json({ error: 'Body must include decision: "approve" | "reject"' });
  }

  try {
    const result = await resolvePendingAction(id, decision);
    if (!result.ok) {
      return res.status(400).json({ error: result.error });
    }
    return res.status(200).json(result);
  } catch (error) {
    console.error('[api/actions] resolution failed:', error);
    return res.status(500).json({ error: error instanceof Error ? error.message : 'Unknown error' });
  }
}
