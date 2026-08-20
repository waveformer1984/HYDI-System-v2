import type { NextApiRequest, NextApiResponse } from 'next';
import { HeidiOrchestrator } from '../../lib/orchestrator';
import type { SystemStatus } from '../../types/index';

const DEGRADED_STATUS: SystemStatus = {
  model_status: { consecutiveFailures: 0, circuitBreakerActive: false, circuitBreakerCooldown: 0 },
  memory_connected: false,
  allowed_actions: [],
};

export default async function handler(_req: NextApiRequest, res: NextApiResponse<SystemStatus & { cognitiveCore?: unknown; cognitiveLoop?: unknown; revenueDashboard?: unknown; commercialState?: unknown; capabilityHealth?: unknown }>) {
  try {
    const orchestrator = new HeidiOrchestrator();
    const status = await orchestrator.getSystemStatus();
    // Include CognitiveCore + loop status — does NOT throw
    const cognitiveStatus = orchestrator.getCognitiveStatus();
    const loopStatus = orchestrator.getCognitiveLoopStatus();
    // Include revenue dashboard — does NOT throw
    const revenueDashboard = await orchestrator.getRevenueDashboard();
    // Include commercial capability state — does NOT throw
    const commercialState = await orchestrator.getCommercialState();
    // Include capability health — does NOT throw, never exposes secrets
    const capabilityHealth = await orchestrator.getCapabilityHealth();
    res.status(200).json({
      ...status,
      cognitiveCore: cognitiveStatus,
      cognitiveLoop: loopStatus,
      revenueDashboard,
      commercialState,
      capabilityHealth,
    });
  } catch (error) {
    console.error('[api/status] Failed to get system status:', error instanceof Error ? error.message : 'Unknown error');
    res.status(200).json(DEGRADED_STATUS);
  }
}
