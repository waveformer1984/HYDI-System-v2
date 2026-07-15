import { NextRequest, NextResponse } from 'next/server';
import { proxyJson } from '../_upstream';

export async function POST(request: NextRequest): Promise<NextResponse> {
  let body: any = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }

  const payload = body.template_id
    ? body
    : {
        template_id: 'protoforge_workflow',
        variables: { objective: body.objective || body.message || 'run task' },
        priority: typeof body.priority === 'number' ? body.priority : 3,
        requested_by: body.requested_by || 'ursula-api',
        project_id: body.project_id,
      };

  return proxyJson('/api/hydi/tasks/generate', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
