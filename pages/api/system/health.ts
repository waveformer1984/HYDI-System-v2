import type { NextApiRequest, NextApiResponse } from 'next';
import { createHealthService, HealthPoller } from '../../../lib/health';

const POLL_INTERVAL_MS = 30000;

const healthService = createHealthService();
const healthPoller = new HealthPoller(healthService, {
  intervalMs: POLL_INTERVAL_MS,
  historyLimit: 120,
});

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (!healthPoller.isActive()) {
      void healthPoller.start();
    }

    if (req.query.history !== undefined) {
      const limit = typeof req.query.history === 'string' ? parseInt(req.query.history, 10) : 20;
      return res.status(200).json({
        status: 'ok',
        polling: healthPoller.isActive(),
        intervalMs: POLL_INTERVAL_MS,
        history: healthPoller.getHistory(Number.isFinite(limit) && limit > 0 ? limit : 20),
      });
    }

    const snapshot = await healthService.collect();
    const statusCode = snapshot.status === 'unavailable' ? 503 : 200;

    res.status(statusCode).json(snapshot);
  } catch (error) {
    console.error('[api/system/health] Failed to collect health:', error instanceof Error ? error.message : 'Unknown error');
    res.status(500).json({
      status: 'error',
      message: error instanceof Error ? error.message : 'Health collection failed',
      timestamp: new Date().toISOString(),
    });
  }
}
