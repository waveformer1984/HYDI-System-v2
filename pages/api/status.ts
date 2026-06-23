import type { NextApiRequest, NextApiResponse } from 'next';
import { HeidiOrchestrator } from '../../lib/orchestrator';
import type { SystemStatus } from '../../types/index';

const DEGRADED_STATUS: SystemStatus = {
  model_status: { consecutiveFailures: 0, circuitBreakerActive: false, circuitBreakerCooldown: 0 },
  memory_connected: false,
  allowed_actions: [],
};

export default async function handler(_req: NextApiRequest, res: NextApiResponse<SystemStatus>) {
  try {
    const orchestrator = new HeidiOrchestrator();
    const status = await orchestrator.getSystemStatus();
    res.status(200).json(status);
  } catch (error) {
    console.error('[api/status] Failed to get system status:', error instanceof Error ? error.message : 'Unknown error');
    res.status(200).json(DEGRADED_STATUS);
  }
}
