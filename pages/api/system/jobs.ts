import type { NextApiRequest, NextApiResponse } from 'next';
import { MemoryJobQueue, SupabaseJobQueue } from '../../../lib/jobs';
import type { JobQueue, JobStatus } from '../../../lib/jobs';

function getQueue(): JobQueue {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_ANON_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (url && key) {
    return new SupabaseJobQueue();
  }

  return new MemoryJobQueue();
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    const queue = getQueue();

    if (req.method === 'POST') {
      const { queueName, payload, priority, maxAttempts } = req.body;
      if (!queueName || typeof queueName !== 'string') {
        return res.status(400).json({ error: 'Missing queueName' });
      }

      const id = await queue.enqueue(queueName, payload ?? {}, {
        priority,
        maxAttempts,
      });
      return res.status(201).json({ id });
    }

    if (req.method === 'GET') {
      const query: { queueName?: string; status?: JobStatus; limit?: number } = {};
      if (req.query.queueName && typeof req.query.queueName === 'string') {
        query.queueName = req.query.queueName;
      }
      if (req.query.status && typeof req.query.status === 'string') {
        query.status = req.query.status as JobStatus;
      }
      const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
      if (limit && Number.isFinite(limit) && limit > 0) {
        query.limit = limit;
      }

      const jobs = await queue.get(query);
      return res.status(200).json({ count: jobs.length, jobs });
    }

    if (req.method === 'PATCH') {
      const { id } = req.body;
      if (!id) return res.status(400).json({ error: 'Missing id' });
      const ok = await queue.retry(id);
      return res.status(ok ? 200 : 404).json({ ok });
    }

    if (req.method === 'DELETE') {
      const { status, olderThanMs } = req.body;
      if (!status) return res.status(400).json({ error: 'Missing status' });
      const removed = await queue.purge(status as JobStatus, olderThanMs ?? 0);
      return res.status(200).json({ removed });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[api/system/jobs] Failed:', error instanceof Error ? error.message : 'Unknown error');
    return res.status(500).json({ error: 'Job queue operation failed' });
  }
}
