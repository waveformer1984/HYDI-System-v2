import { NextRequest, NextResponse } from 'next/server';
import { randomUUID } from 'crypto';
import { getStreamConsumer } from '@/lib/queue/stream-consumer';

// POST /api/edge/dispatch — publish a task to the hydi:edge-tasks stream
// The Termux bridge polls this stream and executes the task locally.
export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const instruction = typeof body.instruction === 'string' ? body.instruction.trim() : '';
  if (!instruction) {
    return NextResponse.json({ error: 'instruction is required' }, { status: 400 });
  }

  const taskId = typeof body.task_id === 'string' ? body.task_id : `edge_${randomUUID().slice(0, 8)}`;
  const taskType = typeof body.type === 'string' ? body.type : 'shell';
  const priority = typeof body.priority === 'string' ? body.priority : 'normal';

  const payload = {
    taskId,
    type: taskType,
    instruction,
    priority,
    timestamp: new Date().toISOString(),
    source: 'ursula',
  };

  const stream = getStreamConsumer();
  const msgId = await stream.publish('hydi:edge-tasks', payload);

  if (!msgId) {
    return NextResponse.json(
      { error: 'Redis stream unavailable — edge dispatch failed' },
      { status: 503 }
    );
  }

  return NextResponse.json({
    success: true,
    task_id: taskId,
    stream_message_id: msgId,
    stream: 'hydi:edge-tasks',
  });
}
