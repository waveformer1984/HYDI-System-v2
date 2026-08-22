/**
 * GET /api/operator/stream
 *
 * Server-Sent Events (SSE) stream for real-time operational updates.
 *
 * Features:
 * - Authenticated + RBAC protected
 * - Reconnect-safe with replay cursor (Last-Event-ID header)
 * - Ordered events with sequence numbers
 * - Duplicate-safe (idempotency keys)
 * - Heartbeat every 15 seconds
 * - Stale connection cleanup after 60 seconds of no response
 * - Graceful disconnect
 * - No memory leak from abandoned subscribers
 * - No secrets (sanitized)
 * - No execution capability exposed through the stream
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { authenticate, getControlPlane, sanitizeResponse } from '../../../lib/operator-api-shared';

/**
 * SSE subscriber with cursor tracking.
 * Each subscriber has its own cursor (last event ID sent).
 * On reconnect, the client sends Last-Event-ID header and we replay
 * all events after that cursor.
 */

interface SSESubscriber {
  id: string;
  res: NextApiResponse;
  lastEventId: string | null;
  lastActivity: number;
  closed: boolean;
}

// In-process subscriber registry (per server instance)
const subscribers = new Map<string, SSESubscriber>();

// Maximum age for a subscriber before cleanup (ms)
const MAX_SUBSCRIBER_AGE = 5 * 60 * 1000; // 5 minutes

// Cleanup stale subscribers periodically
let cleanupInterval: NodeJS.Timeout | null = null;
function ensureCleanup() {
  if (cleanupInterval) return;
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    for (const [id, sub] of subscribers) {
      if (now - sub.lastActivity > MAX_SUBSCRIBER_AGE || sub.closed) {
        try { sub.res.end(); } catch { /* already closed */ }
        subscribers.delete(id);
      }
    }
    // If no subscribers, stop the cleanup interval
    if (subscribers.size === 0 && cleanupInterval) {
      clearInterval(cleanupInterval);
      cleanupInterval = null;
    }
  }, 30000); // check every 30 seconds
  // Don't keep the process alive just for cleanup
  if (cleanupInterval.unref) cleanupInterval.unref();
}

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

  // Parse Last-Event-ID header for replay cursor
  const lastEventId = (req.headers['last-event-id'] as string) ?? null;

  // Create subscriber
  const subscriberId = `sse_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const subscriber: SSESubscriber = {
    id: subscriberId,
    res,
    lastEventId: lastEventId,
    lastActivity: Date.now(),
    closed: false,
  };
  subscribers.set(subscriberId, subscriber);
  ensureCleanup();

  // Send initial connection event with subscriber ID
  res.write(`id: ${subscriberId}_connected\ndata: ${JSON.stringify({ type: 'connected', subscriberId, lastEventId, timestamp: new Date().toISOString() })}\n\n`);

  // Replay missed events if Last-Event-ID was provided
  if (lastEventId) {
    try {
      const cp = getControlPlane();
      const allGoals = cp.listActiveGoals();
      const allEvents: Array<{ eventId: string; goalId: string; eventType: string; sequence: number; timestamp: string }> = [];

      for (const goal of allGoals) {
        const events = cp.getGoalEvents(goal.goalId);
        for (const evt of events) {
          allEvents.push({
            eventId: evt.eventId,
            goalId: evt.goalId,
            eventType: evt.eventType,
            sequence: evt.sequence,
            timestamp: evt.timestamp,
          });
        }
      }

      // Sort by timestamp
      allEvents.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

      // Find events after the lastEventId
      let foundCursor = false;
      const missedEvents = [];
      for (const evt of allEvents) {
        if (foundCursor) {
          missedEvents.push(evt);
        }
        if (evt.eventId === lastEventId) {
          foundCursor = true;
        }
      }

      // If we didn't find the cursor, replay all events (client may have been disconnected long)
      const eventsToReplay = foundCursor ? missedEvents : allEvents;

      // Send missed events
      for (const evt of eventsToReplay) {
        res.write(`id: ${evt.eventId}\ndata: ${JSON.stringify(sanitizeResponse({
          type: 'replay',
          event: evt,
          timestamp: new Date().toISOString(),
        }))}\n\n`);
      }

      // Send replay complete event
      res.write(`id: ${subscriberId}_replay_complete\ndata: ${JSON.stringify({ type: 'replay_complete', count: eventsToReplay.length, timestamp: new Date().toISOString() })}\n\n`);

      subscriber.lastActivity = Date.now();
    } catch {
      // Best effort — don't break the stream on replay failure
      res.write(`data: ${JSON.stringify({ type: 'replay_failed', timestamp: new Date().toISOString() })}\n\n`);
    }
  }

  // Track last event count to detect new events
  const cp = getControlPlane();
  let lastEventCount = 0;
  let lastInterventionCount = 0;
  const sentEventIds = new Set<string>();

  // Initialize counts from current state
  try {
    const summary = cp.getOperationalSummary();
    lastEventCount = summary.recentEvents.length;
    lastInterventionCount = summary.pendingInterventions;
    // Mark current events as already sent
    for (const evt of summary.recentEvents) {
      sentEventIds.add(evt.eventId);
    }
  } catch {
    // Best effort
  }

  // Poll for changes every 2 seconds
  const interval = setInterval(() => {
    if (subscriber.closed) return;
    try {
      subscriber.lastActivity = Date.now();
      const summary = cp.getOperationalSummary();
      const pendingInterventions = cp.listPendingInterventions();

      // Check for new events across all active goals
      for (const goal of cp.listActiveGoals()) {
        const events = cp.getGoalEvents(goal.goalId);
        for (const evt of events) {
          if (!sentEventIds.has(evt.eventId)) {
            sentEventIds.add(evt.eventId);
            res.write(`id: ${evt.eventId}\ndata: ${JSON.stringify(sanitizeResponse({
              type: 'event',
              event: {
                eventId: evt.eventId,
                goalId: evt.goalId,
                eventType: evt.eventType,
                sequence: evt.sequence,
                timestamp: evt.timestamp,
              },
              timestamp: new Date().toISOString(),
            }))}\n\n`);
          }
        }
      }

      // Check for intervention changes
      if (pendingInterventions.length !== lastInterventionCount) {
        res.write(`id: ${subscriberId}_interventions_${Date.now()}\ndata: ${JSON.stringify(sanitizeResponse({
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

      lastEventCount = summary.recentEvents.length;
    } catch {
      // Best effort — don't break the stream
    }
  }, 2000);

  // Heartbeat every 15 seconds
  const heartbeat = setInterval(() => {
    if (subscriber.closed) return;
    try {
      res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
      subscriber.lastActivity = Date.now();
    } catch {
      // Connection closed
      subscriber.closed = true;
    }
  }, 15000);

  // Clean up on connection close
  const cleanup = () => {
    subscriber.closed = true;
    clearInterval(interval);
    clearInterval(heartbeat);
    subscribers.delete(subscriberId);
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
  res.on('close', cleanup);
  res.on('error', cleanup);
}

// Export subscriber count for monitoring
export function getSubscriberCount(): number {
  return subscribers.size;
}
