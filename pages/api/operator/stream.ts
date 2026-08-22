/**
 * GET /api/operator/stream
 *
 * Server-Sent Events (SSE) stream for real-time operational updates.
 * Pushes operational events as they occur.
 *
 * Read-only — never executes actions.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { authenticate, getControlPlane, sanitizeResponse } from '../../../lib/operator-api-shared';

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await authenticate(req, res, 'status:view');
  if (!auth || !auth.ok) return;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  // Send initial connection event
  res.write(`data: ${JSON.stringify({ type: 'connected', timestamp: new Date().toISOString() })}\n\n`);

  // Track last event count to detect new events
  const cp = getControlPlane();
  let lastEventCount = 0;
  let lastInterventionCount = 0;

  // Poll for changes every 2 seconds (simplest reliable mechanism)
  const interval = setInterval(() => {
    try {
      const summary = cp.getOperationalSummary();
      const pendingInterventions = cp.listPendingInterventions();

      // Check for new events
      if (summary.recentEvents.length > 0) {
        const latestEvent = summary.recentEvents[0];
        const currentEventCount = summary.totalActions + summary.totalReplans + summary.totalRecoveries;
        if (currentEventCount !== lastEventCount) {
          res.write(`data: ${JSON.stringify(sanitizeResponse({
            type: 'event',
            event: latestEvent,
            timestamp: new Date().toISOString(),
          }))}\n\n`);
          lastEventCount = currentEventCount;
        }
      }

      // Check for intervention changes
      if (pendingInterventions.length !== lastInterventionCount) {
        res.write(`data: ${JSON.stringify(sanitizeResponse({
          type: 'interventions_changed',
          count: pendingInterventions.length,
          interventions: pendingInterventions.map((i: any) => ({
            interventionId: i.requestId,
            goalId: i.goalId,
            type: i.interventionType,
            reason: i.blocker,
            status: i.status,
          })),
          timestamp: new Date().toISOString(),
        }))}\n\n`);
        lastInterventionCount = pendingInterventions.length;
      }
    } catch {
      // Best effort — don't break the stream
    }
  }, 2000);

  // Heartbeat every 15 seconds
  const heartbeat = setInterval(() => {
    try {
      res.write(`data: ${JSON.stringify({ type: 'heartbeat', timestamp: new Date().toISOString() })}\n\n`);
    } catch {
      // Connection closed
    }
  }, 15000);

  // Clean up on connection close
  req.on('close', () => {
    clearInterval(interval);
    clearInterval(heartbeat);
  });

  req.on('error', () => {
    clearInterval(interval);
    clearInterval(heartbeat);
  });
}
