import { isLocalRequest, coreUrl, coreHeaders, forbidden, coreDown } from '@/lib/heidi-relay';

export const dynamic = 'force-dynamic';

/** Reload a conversation's history (heidi-core GET /conversations/:id/messages). */
export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }): Promise<Response> {
  if (!isLocalRequest(req.headers)) return forbidden();
  const { id } = await ctx.params;
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return Response.json({ error: 'bad conversation id' }, { status: 400 });
  try {
    const r = await fetch(coreUrl(`/conversations/${encodeURIComponent(id)}/messages?limit=50`), {
      headers: coreHeaders(), signal: AbortSignal.timeout(8000),
    });
    return new Response(await r.text(), { status: r.status, headers: { 'Content-Type': 'application/json' } });
  } catch (error) {
    return coreDown(error);
  }
}
