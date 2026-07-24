import type { NextApiRequest, NextApiResponse } from 'next';
import { getEventBus } from '../../../lib/event-bus';
import type { EventHistoryQuery } from '../../../lib/event-bus';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const bus = getEventBus();

    if (req.method === 'POST') {
      const { type, payload, priority, source } = req.body;
      if (!type || typeof type !== 'string') {
        return res.status(400).json({ error: 'Missing event type' });
      }

      const event = await bus.publish(type, payload ?? null, { priority, source });
      return res.status(201).json({ success: true, event });
    }

    if (req.method === 'GET') {
      const query: EventHistoryQuery = {};

      if (req.query.type && typeof req.query.type === 'string') {
        query.type = req.query.type;
      }
      if (req.query.source && typeof req.query.source === 'string') {
        query.source = req.query.source;
      }
      if (req.query.priority && typeof req.query.priority === 'string') {
        query.priority = req.query.priority as 'high' | 'normal' | 'low';
      }
      if (req.query.since && typeof req.query.since === 'string') {
        query.since = req.query.since;
      }
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
      if (limit && Number.isFinite(limit) && limit > 0) {
        query.limit = limit;
      }

      const history = bus.getHistory(query);
      return res.status(200).json({ count: history.length, history });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[api/system/events] Failed:', error instanceof Error ? error.message : 'Unknown error');
    return res.status(500).json({ error: 'Event bus operation failed' });
  }
}
