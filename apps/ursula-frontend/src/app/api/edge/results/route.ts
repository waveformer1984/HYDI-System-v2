import { NextRequest, NextResponse } from 'next/server';
import { getStreamConsumer } from '@/lib/queue/stream-consumer';

// GET /api/edge/results — poll recent results from the hydi:edge-results stream
// Query params: ?task_id=<id>&count=<n>
export async function GET(request: NextRequest): Promise<NextResponse> {
  const taskId = request.nextUrl.searchParams.get('task_id');
  const count = Math.min(parseInt(request.nextUrl.searchParams.get('count') ?? '20', 10), 100);

  const stream = getStreamConsumer();
  const messages = await stream.peek('hydi:edge-results', count);

  const results = taskId
    ? messages.filter(m => m.data.taskId === taskId || m.data.task_id === taskId)
    : messages;

  return NextResponse.json({
    success: true,
    count: results.length,
    results: results.map(m => ({
      message_id: m.id,
      ...m.data,
    })),
  });
}

// POST /api/edge/results — Termux bridge posts a completed task result here
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const taskId = typeof body.task_id === 'string' ? body.task_id : (typeof body.taskId === 'string' ? body.taskId : null);
  if (!taskId) {
    return NextResponse.json({ error: 'task_id is required' }, { status: 400 });
  }

  const payload = {
    taskId,
    success: body.success !== false,
    output: body.output ?? null,
    error: typeof body.error === 'string' ? body.error : null,
    swarmId: typeof body.swarm_id === 'string' ? body.swarm_id : (typeof body.swarmId === 'string' ? body.swarmId : null),
    completedAt: new Date().toISOString(),
    source: 'termux-edge',
  };

  const stream = getStreamConsumer();
  const msgId = await stream.publish('hydi:edge-results', payload);

  return NextResponse.json({
    success: true,
    task_id: taskId,
    stream_message_id: msgId,
  });
}
