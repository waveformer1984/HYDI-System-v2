/**
 * GET /api/workspace/chat?agent=<id>&limit=<n> — durable chat history.
 *
 * The Command Center chat path writes every message into heidi_events
 * (division='chat', event_type='chat_message', conversationId =
 * `${userId}:${agentId}`) via persistChatMessage in pages/api/chat.ts.
 * Until now that division was write-only — nothing could reconstruct a
 * conversation after a restart. This is the reader. Read-only; no
 * mutation surface here.
 */
import { NextApiRequest, NextApiResponse } from 'next';
import pg from 'pg';

const pool = new pg.Pool({ host: '127.0.0.1', port: 54322, database: 'postgres', user: 'postgres', password: 'postgres' });

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  const agent = typeof req.query.agent === 'string' && req.query.agent.length ? req.query.agent : 'heidi';
  const userId = typeof req.query.user === 'string' && req.query.user.length ? req.query.user : 'j';
  const limit = Math.min(parseInt(String(req.query.limit ?? '50'), 10) || 50, 200);
  const conversationId = `${userId}:${agent}`;

  try {
    const { rows } = await pool.query(
      `SELECT payload, created_at FROM heidi_events
         WHERE division='chat' AND event_type='chat_message'
           AND payload->>'conversationId' = $1
         ORDER BY created_at DESC LIMIT $2`,
      [conversationId, limit],
    );
    const messages = rows.map(r => {
      const p = r.payload as Record<string, unknown>;
      return {
        role: String(p.role ?? 'unknown'),
        content: String(p.content ?? '').slice(0, 4000),
        at: r.created_at,
      };
    }).reverse(); // oldest-first for display
    return res.status(200).json({ conversationId, messages });
  } catch (e) {
    return res.status(500).json({ error: e instanceof Error ? e.message : 'chat history read failed' });
  }
}
