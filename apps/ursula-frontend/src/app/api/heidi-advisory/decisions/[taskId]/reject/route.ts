import { proxyHeidiAdvisory } from '@/lib/heidi-advisory-proxy';

export async function POST(
  req: Request,
  ctx: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await ctx.params;
  const body = await req.text();
  return proxyHeidiAdvisory(`/api/decisions/${encodeURIComponent(taskId)}/reject`, {
    method: 'POST',
    body: body || '{}',
  });
}
