import { isLocalRequest, coreUrl, coreHeaders, forbidden, coreDown } from '@/lib/heidi-relay';

export const dynamic = 'force-dynamic';

/**
 * POST { message, conversation_id?, request_id? } → heidi-core /chat-tools,
 * streamed back as-is (server-sent events: { t } chunks, then { done, ... }).
 * The same conversation, memory, task and trace commands as the phone chat.
 */
export async function POST(req: Request): Promise<Response> {
  if (!isLocalRequest(req.headers)) return forbidden();
  let body: { message?: unknown; conversation_id?: unknown; request_id?: unknown };
  try { body = await req.json(); } catch { return Response.json({ error: 'invalid JSON' }, { status: 400 }); }
  const message = typeof body.message === 'string' ? body.message.trim() : '';
  if (!message) return Response.json({ error: 'message required' }, { status: 400 });
  if (message.length > 8000) return Response.json({ error: 'message too long (8000 max)' }, { status: 413 });

  let upstream: Response;
  try {
    upstream = await fetch(coreUrl('/chat-tools'), {
      method: 'POST',
      headers: coreHeaders(),
      body: JSON.stringify({
        input: message,
        conversation_id: typeof body.conversation_id === 'string' ? body.conversation_id : undefined,
        request_id: typeof body.request_id === 'string' ? body.request_id : undefined,
      }),
      signal: AbortSignal.timeout(300000),
    });
  } catch (error) {
    return coreDown(error);
  }
  if (!upstream.ok || !upstream.body) {
    const text = await upstream.text().catch(() => '');
    return Response.json({ error: 'heidi_core_error', status: upstream.status, detail: text.slice(0, 300) }, { status: 502 });
  }
  return new Response(upstream.body, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'X-Accel-Buffering': 'no' },
  });
}
