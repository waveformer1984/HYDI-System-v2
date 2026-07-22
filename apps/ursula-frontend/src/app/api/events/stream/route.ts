import { NextResponse } from 'next/server';
import { getEventBus, setEventRecorder } from '@repo/lib/event-bus';
import { getDashboardPublisher } from '@/lib/dashboard/services/publisher';
import type { BusEvent, EventBus } from '@repo/lib/event-bus';

export const dynamic = 'force-dynamic';

async function ensureRecorder(bus: EventBus) {
  const { EventRecorder } = await import('@repo/lib/event-bus/recorder');
  const recorder = new EventRecorder(bus, { path: 'logs/event-fabric' });
  setEventRecorder(recorder);
  return recorder;
}

function sseEvent(type: string, data: unknown): string {
  return `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(): Promise<NextResponse> {
  const bus = getEventBus();
  await ensureRecorder(bus);
  const publisher = getDashboardPublisher(bus);
  publisher.start();

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(sseEvent('connected', { type: 'connected', timestamp: new Date().toISOString() })));

      const subscriptionId = bus.subscribe<BusEvent>('*', (event) => {
        try {
          const payload: BusEvent = {
            id: event.id,
            version: event.version,
            type: event.type,
            payload: event.payload,
            priority: event.priority,
            timestamp: event.timestamp,
            source: event.source,
            handlerCount: event.handlerCount,
            correlationId: event.correlationId,
            traceId: event.traceId,
            causationId: event.causationId,
          };
          controller.enqueue(encoder.encode(sseEvent('message', payload)));
        } catch (error) {
          console.error('[SSE] Failed to forward event:', error);
        }
      });

      const heartbeat = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(sseEvent('heartbeat', { type: 'heartbeat', timestamp: new Date().toISOString() })));
        } catch {
          clearInterval(heartbeat);
          bus.unsubscribe(subscriptionId);
        }
      }, 30000);

      // Clean up when the client disconnects
      const cleanup = () => {
        clearInterval(heartbeat);
        bus.unsubscribe(subscriptionId);
      };

      // AbortSignal support for modern runtimes
      if ((controller as any).signal) {
        (controller as any).signal.addEventListener('abort', cleanup, { once: true });
      }
    },
  });

  return new NextResponse(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
