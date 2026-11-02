/**
 * GET /api/heidi-core/history?conversation_id=<id>&limit=<n>
 *
 * The dashboard's recent turns from heidi-core's conversation store, so a
 * reload shows what was said instead of a blank chat. Conversation history
 * is personal, so this answers only to this PC (a direct loopback request
 * with no forwarding headers) or a caller with a valid
 * x-hydi-service-token — never to a bare LAN or tailnet request.
 */
import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyServiceToken } from '../../../lib/auth/verifyServiceToken';
import { isLocal } from '../../../lib/mobile-chat/local-auth';
import { fetchHistory } from '../../../lib/heidi-core-chat';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const token = req.headers['x-hydi-service-token'];
  const authorized = isLocal(req) || verifyServiceToken(typeof token === 'string' ? token : undefined, null as unknown as string).valid;
  if (!authorized) return res.status(401).json({ error: 'history is available on this PC or with the service token' });

  const conversationId = typeof req.query.conversation_id === 'string' ? req.query.conversation_id : '';
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(conversationId)) {
    return res.status(400).json({ error: 'conversation_id required' });
  }
  res.setHeader('Cache-Control', 'no-store');
  try {
    const messages = await fetchHistory({ conversationId, limit: Number(req.query.limit) || 50 });
    if (messages === null) return res.status(404).json({ error: 'conversation not found' });
    return res.status(200).json({ conversation_id: conversationId, messages });
  } catch (error) {
    return res.status(503).json({ error: error instanceof Error ? error.message : 'heidi-core unavailable' });
  }
}
