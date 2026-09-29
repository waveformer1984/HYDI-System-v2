/**
 * Browser-side client for the Heidi Mobile BFF (pages/api/heidi-mobile/*).
 *
 * Holds no credentials: authentication is the HttpOnly session cookie the
 * browser attaches on its own. Every call has a timeout, can be cancelled,
 * and resolves to a discriminated result instead of throwing, so each
 * screen is forced to render the failure it actually got.
 */

import { createSseParser, parseJsonData } from '../sseParser';

export type ErrorKind =
  | 'offline' | 'network' | 'timeout' | 'aborted'
  | 'not_paired' | 'unauthorized' | 'forbidden' | 'rate_limited'
  | 'server' | 'malformed' | 'client' | 'unconfigured';

export interface ApiError {
  kind: ErrorKind;
  message: string;
  status?: number;
  reason?: string;
}

export type ApiResult<T> = { ok: true; data: T; status: number } | { ok: false; error: ApiError };

const BASE = '/api/heidi-mobile';
const DEFAULT_TIMEOUT_MS = 15000;

interface RequestOptions {
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  timeoutMs?: number;
  signal?: AbortSignal;
}

function isOffline(): boolean {
  return typeof navigator !== 'undefined' && navigator.onLine === false;
}

export function kindForStatus(status: number, code?: string): ErrorKind {
  if (status === 401) return code === 'not_paired' ? 'not_paired' : 'unauthorized';
  if (status === 403) return 'forbidden';
  if (status === 429) return 'rate_limited';
  if (status === 503) return 'unconfigured';
  if (status === 504) return 'timeout';
  if (status === 502) return code === 'network' ? 'network' : code === 'timeout' ? 'timeout' : code === 'malformed' ? 'malformed' : 'server';
  if (status >= 500) return 'server';
  return 'client';
}

/** Human wording for an error kind, used when the server gave no message. */
export function describeError(error: ApiError): string {
  switch (error.kind) {
    case 'offline': return 'Your phone is offline.';
    case 'network': return 'HYDI unavailable — the server could not be reached.';
    case 'timeout': return 'HYDI took too long to respond.';
    case 'aborted': return 'Cancelled.';
    case 'not_paired': return 'This phone is not paired with HYDI.';
    case 'unauthorized': return 'HYDI rejected this phone’s credentials.';
    case 'forbidden': return 'This device’s role is not allowed to do that.';
    case 'rate_limited': return 'Too many requests — wait a moment and retry.';
    case 'unconfigured': return 'The Heidi server is missing configuration.';
    case 'malformed': return 'HYDI sent a response Heidi could not read.';
    case 'server': return 'HYDI hit an internal error.';
    default: return 'Request failed.';
  }
}

function withTimeout(timeoutMs: number, outer?: AbortSignal) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const onAbort = () => controller.abort();
  if (outer) {
    if (outer.aborted) controller.abort();
    else outer.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    done: () => {
      clearTimeout(timer);
      if (outer) outer.removeEventListener('abort', onAbort);
    },
  };
}

export async function heidiRequest<T>(path: string, opts: RequestOptions = {}): Promise<ApiResult<T>> {
  if (isOffline()) return { ok: false, error: { kind: 'offline', message: describeError({ kind: 'offline', message: '' }) } };
  const method = opts.method || 'GET';
  const t = withTimeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, opts.signal);
  try {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (method !== 'GET') headers['x-heidi-request'] = '1';
    if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetch(`${BASE}${path}`, {
      method,
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      credentials: 'same-origin',
      cache: 'no-store',
      signal: t.signal,
    });
    const text = await res.text();
    let data: unknown = null;
    let parsed = true;
    if (text) {
      try { data = JSON.parse(text); } catch { parsed = false; }
    }
    if (!res.ok) {
      const body = (parsed && data && typeof data === 'object' ? data : {}) as Record<string, unknown>;
      const code = typeof body.error === 'string' ? body.error : undefined;
      const error: ApiError = {
        kind: kindForStatus(res.status, code),
        status: res.status,
        message: typeof body.message === 'string' ? body.message : '',
        reason: typeof body.reason === 'string' ? body.reason : undefined,
      };
      if (!error.message) error.message = describeError(error);
      return { ok: false, error };
    }
    if (!parsed || data === null || typeof data !== 'object') {
      return { ok: false, error: { kind: 'malformed', status: res.status, message: describeError({ kind: 'malformed', message: '' }) } };
    }
    return { ok: true, data: data as T, status: res.status };
  } catch {
    const kind: ErrorKind = t.timedOut() ? 'timeout' : opts.signal?.aborted ? 'aborted' : isOffline() ? 'offline' : 'network';
    return { ok: false, error: { kind, message: describeError({ kind, message: '' }) } };
  } finally {
    t.done();
  }
}

// ── Chat streaming ──────────────────────────────────────────────────────

export type ChatEvent =
  | { type: 'delta'; text: string }
  | { type: 'meta'; model: string | null }
  | { type: 'tool'; name: string | null; status: string | null; error?: string | null }
  | { type: 'actions'; actions: Array<{ type: string | null; status: string | null; actionId: string | null; error: string | null }> }
  | { type: 'error'; message: string; kind?: string }
  | { type: 'done' };

export type ChatOutcome = { ok: true } | { ok: false; error: ApiError; partial: boolean };

function isChatEvent(v: unknown): v is ChatEvent {
  if (!v || typeof v !== 'object') return false;
  const e = v as Record<string, unknown>;
  switch (e.type) {
    case 'delta': return typeof e.text === 'string';
    case 'error': return typeof e.message === 'string';
    case 'meta': case 'tool': case 'done': return true;
    case 'actions': return Array.isArray(e.actions);
    default: return false;
  }
}

/**
 * POST a message and stream the reply. `onEvent` receives validated events
 * only. Resolves once the stream ends; a stream that ends without `done` is
 * reported as a failure (with `partial` telling the UI whether any text
 * already arrived), never silently treated as a complete reply.
 */
export async function streamChat(
  params: { message: string; sessionId: string; signal?: AbortSignal; timeoutMs?: number },
  onEvent: (_event: ChatEvent) => void,
): Promise<ChatOutcome> {
  if (isOffline()) return { ok: false, partial: false, error: { kind: 'offline', message: describeError({ kind: 'offline', message: '' }) } };
  // The server enforces its own idle/overall limits; this is the client's backstop.
  const t = withTimeout(params.timeoutMs ?? 200000, params.signal);
  let partial = false;
  try {
    const res = await fetch(`${BASE}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'text/event-stream', 'x-heidi-request': '1' },
      body: JSON.stringify({ message: params.message, session_id: params.sessionId }),
      credentials: 'same-origin',
      cache: 'no-store',
      signal: t.signal,
    });
    if (!res.ok || !(res.headers.get('content-type') || '').includes('text/event-stream') || !res.body) {
      let body: Record<string, unknown> = {};
      try { body = JSON.parse(await res.text()); } catch { /* not JSON */ }
      const code = typeof body.error === 'string' ? body.error : undefined;
      const error: ApiError = res.ok
        ? { kind: 'malformed', status: res.status, message: describeError({ kind: 'malformed', message: '' }) }
        : { kind: kindForStatus(res.status, code), status: res.status, message: typeof body.message === 'string' ? body.message : '' };
      if (!error.message) error.message = describeError(error);
      return { ok: false, partial: false, error };
    }

    let terminal: ChatEvent | null = null;
    const parser = createSseParser(({ data }) => {
      if (terminal) return;
      const event = parseJsonData(data);
      if (!isChatEvent(event)) return;
      if (event.type === 'delta') partial = true;
      if (event.type === 'done' || event.type === 'error') terminal = event;
      onEvent(event);
    });
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      parser.push(decoder.decode(value, { stream: true }));
      if (terminal) break;
    }
    parser.flush();
    reader.cancel().catch(() => undefined);

    const end = terminal as ChatEvent | null;
    if (end && end.type === 'done') return { ok: true };
    if (end && end.type === 'error') {
      const kind: ErrorKind = end.kind === 'timeout' ? 'timeout' : end.kind === 'network' ? 'network' : 'server';
      return { ok: false, partial, error: { kind, message: end.message } };
    }
    return { ok: false, partial, error: { kind: 'network', message: 'The reply stream ended unexpectedly.' } };
  } catch {
    const kind: ErrorKind = t.timedOut() ? 'timeout' : params.signal?.aborted ? 'aborted' : isOffline() ? 'offline' : 'network';
    return { ok: false, partial, error: { kind, message: describeError({ kind, message: '' }) } };
  } finally {
    t.done();
  }
}
