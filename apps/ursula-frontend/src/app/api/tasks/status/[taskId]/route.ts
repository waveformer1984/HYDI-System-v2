import { NextResponse } from 'next/server';
import { proxyJson } from '../../_upstream';

type Params = { params: Promise<{ taskId: string }> };

export async function GET(_: Request, { params }: Params): Promise<NextResponse> {
  const { taskId } = await params;
  if (!taskId) {
    return NextResponse.json(
      { success: false, error: 'taskId is required' },
      { status: 400 }
    );
  }

  return proxyJson(`/api/hydi/tasks/status/${encodeURIComponent(taskId)}`, {
    method: 'GET',
  });
}
