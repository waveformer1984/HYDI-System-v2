import { NextResponse } from 'next/server';
import { getStreamConsumer } from '@/lib/queue/stream-consumer';

const STREAMS = ['hydi:task-results', 'hydi:task-failures', 'hydi:edge-tasks', 'hydi:edge-results'] as const;

// GET /api/streams/status — peek the last 5 messages from each stream
export async function GET(): Promise<NextResponse> {
  const consumer = getStreamConsumer();
  const results: Record<string, { count: number; latest: unknown[] }> = {};

  await Promise.all(
    STREAMS.map(async (stream) => {
      const messages = await consumer.peek(stream, 5);
      results[stream] = {
        count: messages.length,
        latest: messages.map(m => ({ id: m.id, ...m.data })),
      };
    })
  );

  const redisConfigured = Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );

  return NextResponse.json({
    status: redisConfigured ? 'connected' : 'unconfigured',
    streams: results,
    checked_at: new Date().toISOString(),
  });
}
