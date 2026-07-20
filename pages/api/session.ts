import type { NextApiRequest, NextApiResponse } from 'next';
import { HeidiOrchestrator } from '../../lib/orchestrator';
import type { SessionState } from '../../types/index';
import structuredLogger from '../../lib/structured-logger';

const logger = structuredLogger.child({ component: 'api/session' });

export default async function handler(req: NextApiRequest, res: NextApiResponse<SessionState | null>) {
  const raw = req.query.session_id;
  const sessionId = Array.isArray(raw) ? raw[0] : raw;

  if (!sessionId) {
    res.status(400).json(null);
    return;
  }

  try {
    const orchestrator = new HeidiOrchestrator();
    const state = await orchestrator.getSessionState(sessionId);
    res.status(200).json(state);
  } catch (error) {
    logger.error('Failed to get session state', { error: error instanceof Error ? error.message : 'Unknown error' });
    res.status(200).json(null);
  }
}
