/**
 * Ursula → heidi-core relay for the Heidi chat panel.
 *
 * heidi-core (:3459) trusts loopback callers, so anything that forwards to
 * it must not become a way in for other machines. Ursula's PM2 entry binds
 * `next start --hostname 127.0.0.1`, which is the real boundary; this check
 * is the second line for when Ursula runs another way (e.g. `next dev` on
 * all interfaces): the request must name a loopback host and carry no
 * proxy headers pointing anywhere else (tailscale serve, a tunnel, the LAN).
 */

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '[::1]']);
const LOOPBACK_ADDRS = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

function hostname(hostHeader: string | null): string {
  const h = String(hostHeader || '').trim().toLowerCase();
  if (h.startsWith('[')) return h.slice(0, h.indexOf(']') + 1);
  const colon = h.lastIndexOf(':');
  return colon > -1 && h.indexOf(':') === colon ? h.slice(0, colon) : h;
}

/** True only for a browser on this machine talking to Ursula directly. */
export function isLocalRequest(headers: Headers): boolean {
  if (!LOOPBACK_HOSTS.has(hostname(headers.get('host')))) return false;
  if (headers.get('tailscale-user-login') || headers.get('forwarded')) return false;
  const xfh = headers.get('x-forwarded-host');
  if (xfh && !LOOPBACK_HOSTS.has(hostname(xfh))) return false;
  const xff = headers.get('x-forwarded-for');
  if (xff && !xff.split(',').map((s) => s.trim()).every((a) => LOOPBACK_ADDRS.has(a))) return false;
  return true;
}

export function coreUrl(path: string): string {
  const base = (process.env.HEIDI_CORE_URL || 'http://127.0.0.1:3459').replace(/\/+$/, '');
  return `${base}${path}`;
}

export function coreHeaders(): Record<string, string> {
  const h: Record<string, string> = { 'Content-Type': 'application/json' };
  if (process.env.HEIDI_SECRET) h['x-heidi-secret'] = process.env.HEIDI_SECRET;
  return h;
}

export function forbidden(): Response {
  return Response.json(
    { error: 'local_only', hint: 'The Heidi panel only works from Ursula on this PC. From your phone, use the Heidi mobile chat.' },
    { status: 403 },
  );
}

export function coreDown(error: unknown): Response {
  const message = error instanceof Error ? error.message : 'Unknown error';
  return Response.json({ error: 'heidi_core_unreachable', detail: message }, { status: 503 });
}
