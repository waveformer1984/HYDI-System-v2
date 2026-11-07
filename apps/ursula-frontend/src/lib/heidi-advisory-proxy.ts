/**
 * Server-only proxy to heidi-agent advisory API. Browser code must call
 * /api/heidi-advisory/* on Ursula — never heidi-agent directly with a token.
 */

const DEFAULT_BASE = 'http://127.0.0.1:3461';
const ADVISORY_PATH =
  /^\/api\/(decisions\/(pending|[A-Za-z0-9_-]{1,128}\/(approve|reject))|feedback\/[A-Za-z0-9_-]{1,128})$/;

function assertAdvisoryUpstreamPath(upstreamPath: string): string | null {
  const path = upstreamPath.startsWith('/') ? upstreamPath : `/${upstreamPath}`;
  if (/[\r\n\u0000]/.test(path) || path.includes('..')) return null;
  return ADVISORY_PATH.test(path) ? path : null;
}

export function heidiAdvisoryBaseUrl(): string {
  return (process.env.HEIDI_ADVISORY_URL || DEFAULT_BASE).replace(/\/+$/, '');
}

export async function proxyHeidiAdvisory(
  upstreamPath: string,
  init?: RequestInit,
): Promise<Response> {
  const token = process.env.HEIDI_ADMIN_TOKEN;
  if (!token) {
    return new Response(JSON.stringify({ error: 'admin_token_not_configured' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const path = assertAdvisoryUpstreamPath(upstreamPath);
  if (!path) {
    return new Response(JSON.stringify({ error: 'invalid_upstream_path' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  const headers = new Headers(init?.headers);
  headers.set('Authorization', `Bearer ${token}`);
  if (init?.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  try {
    const upstream = await fetch(`${heidiAdvisoryBaseUrl()}${path}`, {
      ...init,
      headers,
      cache: 'no-store',
    });
    const text = await upstream.text();
    return new Response(text, {
      status: upstream.status,
      headers: { 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'upstream_failed';
    return new Response(JSON.stringify({ error: message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
