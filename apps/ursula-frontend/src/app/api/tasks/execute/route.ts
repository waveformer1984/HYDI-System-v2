import { NextRequest, NextResponse } from 'next/server';
import { proxyJson } from '../_upstream';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const taskId = body.task_id || body.taskId;
  if (!taskId || typeof taskId !== 'string') {
    return NextResponse.json(
      { success: false, error: 'task_id is required' },
      { status: 400 }
    );
  }

  return proxyJson('/api/hydi/tasks/execute', {
    method: 'POST',
    body: JSON.stringify({ task_id: taskId }),
  });
}
