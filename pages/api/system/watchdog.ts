import type { NextApiRequest, NextApiResponse } from 'next';
import { getWatchdogService } from '../../../lib/watchdog';

const watchdog = getWatchdogService();

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  try {
    if (req.method === 'POST') {
      const { action } = req.body;
      if (action === 'start') {
        watchdog.start();
        return res.status(200).json({ status: 'started', service: watchdog.getStatus() });
      }
      if (action === 'stop') {
        watchdog.stop();
        return res.status(200).json({ status: 'stopped', service: watchdog.getStatus() });
      }
      return res.status(400).json({ error: 'Invalid action; use start or stop' });
    }

    if (req.method === 'GET') {
      return res.status(200).json({
        status: watchdog.isRunning() ? 'running' : 'stopped',
        service: watchdog.getStatus(),
        findings: watchdog.getFindings(),
        escalations: watchdog.getEscalations(),
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[api/system/watchdog] Failed:', error instanceof Error ? error.message : 'Unknown error');
    return res.status(500).json({ error: 'Watchdog operation failed' });
  }
}
