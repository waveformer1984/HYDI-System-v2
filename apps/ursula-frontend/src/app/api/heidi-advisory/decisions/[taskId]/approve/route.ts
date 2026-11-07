import { proxyHeidiAdvisory } from '@/lib/heidi-advisory-proxy';

export async function POST(
  _req: Request,
  ctx: { params: Promise<{ taskId: string }> },
) {
  const { taskId } = await ctx.params;
  return proxyHeidiAdvisory(`/api/decisions/${encodeURIComponent(taskId)}/approve`, {
    method: 'POST',
  });
}
