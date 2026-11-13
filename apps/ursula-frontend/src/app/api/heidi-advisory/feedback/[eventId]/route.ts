import { proxyHeidiAdvisory } from '@/lib/heidi-advisory-proxy';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ eventId: string }> },
) {
  const { eventId } = await ctx.params;
  const body = await req.text();
  return proxyHeidiAdvisory(`/api/feedback/${encodeURIComponent(eventId)}`, {
    method: 'POST',
    body: body || '{}',
  });
}
