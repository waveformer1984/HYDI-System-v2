/**
 * Same-origin Tailscale / ingress probe for the phone.
 *
 * When the Heidi Mobile BFF reports offline or stale upstream, this hits the
 * public `GET /api/health` on the same host the PWA loaded from — not
 * HYDI_API_URL on the server. Distinguishes "Frank ingress + heidi-web up"
 * from "BFF upstream or stale cache only".
 */

export type IngressProbeResult =
  | { ok: true; status: string; latencyMs: number }
  | { ok: false; kind: 'offline' | 'network' | 'timeout' | 'malformed' | 'unhealthy'; message: string; latencyMs: number };

const PROBE_PATH = '/api/health';
const DEFAULT_TIMEOUT_MS = 8000;

function isBrowserOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

/** Guidance text only — no hostnames or secrets. */
export function ingressGuidance(result: IngressProbeResult): { title: string; detail: string; docPath: string } {
  if (result.ok) {
    return {
      title: 'Public health answered on this URL',
      detail:
        'Heidi-web is reachable from your phone, but the mobile BFF check failed or is stale. Clear this site’s data (browser app settings → storage), reopen /heidi, then Status → Refresh. If chat still fails, Frank should check the server session secret and Ollama — not Tailscale serve.',
      docPath: 'docs/HEIDI_MOBILE.md',
    };
  }
  if (result.kind === 'offline') {
    return {
      title: 'Phone is offline',
      detail: 'Reconnect to Wi‑Fi or mobile data, then try again.',
      docPath: 'docs/HEIDI_MOBILE.md',
    };
  }
  return {
    title: 'Public health did not answer on this URL',
    detail:
      'This URL is not forwarding to heidi-web on port 3000, or heidi-web is down. On Frank: run tailscale serve for port 3000 (see docs/TAILSCALE.md and scripts/tailscale/serve-heidi-web.ps1). Jordan cannot fix this from the phone.',
    docPath: 'docs/TAILSCALE.md',
  };
}

export function shouldRunIngressProbe(input: {
  online: boolean;
  statusErrorKind?: string;
  connectionState?: string;
  upstreamValid?: boolean | null;
  statusUntrusted?: boolean;
}): boolean {
  if (!input.online || isBrowserOffline()) return false;
  if (input.statusUntrusted) return true;
  if (input.statusErrorKind && ['network', 'timeout', 'offline'].includes(input.statusErrorKind)) return true;
  if (input.connectionState && ['offline', 'unconfigured'].includes(input.connectionState)) return true;
  if (input.upstreamValid === false) return true;
  return false;
}

export async function probePublicHealth(opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<IngressProbeResult> {
  if (isBrowserOffline()) {
    return { ok: false, kind: 'offline', message: 'Phone offline', latencyMs: 0 };
  }
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  const onAbort = () => controller.abort();
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort();
    else opts.signal.addEventListener('abort', onAbort, { once: true });
  }
  const started = Date.now();
  try {
    const res = await fetch(PROBE_PATH, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      credentials: 'same-origin',
      cache: 'no-store',
      signal: controller.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    let parsed = true;
    if (text) {
      try { data = JSON.parse(text); } catch { parsed = false; }
    }
    const latencyMs = Date.now() - started;
    if (!parsed || !data || typeof data !== 'object') {
      return { ok: false, kind: 'malformed', message: 'Health response was not JSON', latencyMs };
    }
    const status = typeof (data as Record<string, unknown>).status === 'string' ? (data as Record<string, string>).status : null;
    if (!res.ok) {
      return { ok: false, kind: 'unhealthy', message: status ? `HTTP ${res.status} (${status})` : `HTTP ${res.status}`, latencyMs };
    }
    if (!status) {
      return { ok: false, kind: 'malformed', message: 'Health response missing status', latencyMs };
    }
    return { ok: true, status, latencyMs };
  } catch {
    const latencyMs = Date.now() - started;
    const kind = timedOut ? 'timeout' : opts.signal?.aborted ? 'network' : isBrowserOffline() ? 'offline' : 'network';
    return {
      ok: false,
      kind,
      message: kind === 'timeout' ? 'Health check timed out' : kind === 'offline' ? 'Phone offline' : 'Could not reach /api/health on this host',
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
    if (opts.signal) opts.signal.removeEventListener('abort', onAbort);
  }
}
