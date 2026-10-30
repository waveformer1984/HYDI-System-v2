import { isLocalRequest, coreUrl, coreHeaders, forbidden } from '@/lib/heidi-relay';

export const dynamic = 'force-dynamic';

/** Is heidi-core answering? Drives the panel's status dot. */
export async function GET(req: Request): Promise<Response> {
  if (!isLocalRequest(req.headers)) return forbidden();
  try {
    const r = await fetch(coreUrl('/health'), { headers: coreHeaders(), signal: AbortSignal.timeout(3000) });
    return Response.json({ ok: r.ok, status: r.status });
  } catch (error) {
    return Response.json({ ok: false, error: error instanceof Error ? error.message : 'Unknown error' });
  }
}
