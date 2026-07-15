import { NextRequest, NextResponse } from 'next/server';
import { proxyJson } from '../_upstream';

export async function GET(request: NextRequest): Promise<NextResponse> {
  const taskId = request.nextUrl.searchParams.get('task_id') || request.nextUrl.searchParams.get('taskId');
  if (!taskId) {
    return NextResponse.json(
      { success: false, error: 'task_id query param is required' },
      { status: 400 }
    );
  }

  return proxyJson(`/api/hydi/tasks/status/${encodeURIComponent(taskId)}`, {
    method: 'GET',
  });
}
