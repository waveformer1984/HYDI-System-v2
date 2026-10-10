/**
 * Supabase client factory with a hard per-request timeout and a
 * lightweight circuit breaker. supabase-js has no fetch timeout by
 * default — when Kong/PostgREST degrades (accepts the connection,
 * trickles or stalls the response) a single .from().select() can hang
 * for minutes, which is exactly what froze /api/chat for ~90s while
 * direct pg queries to the same Postgres answered in <1s.
 *
 * Behavior:
 *  - every HTTP call is wrapped in a hard timeout (default 5s)
 *  - after a threshold of consecutive transport failures the circuit
 *    opens for a cooldown: calls reject instantly with a typed error
 *    instead of queuing more doomed requests behind the dead service
 *  - a single success half-closes the circuit again
 *
 * RLS, realtime auth headers, storage — all unchanged; this only adds
 * timeouts around transport. Callers that already handle errors get a
 * fast error instead of a hang. $0, no new infra.
 */
import { createClient, type SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js';

const DEFAULT_TIMEOUT_MS = Number(process.env.SUPABASE_REST_TIMEOUT_MS ?? 5000);
const DEFAULT_CB_THRESHOLD = 3;
const DEFAULT_CB_OPEN_MS = 15_000;

export class SupabaseDegradedError extends Error {
  constructor() {
    super('SUPABASE_REST_DEGRADED: circuit breaker open — REST layer failing');
    this.name = 'SupabaseDegradedError';
  }
}

export class SupabaseTimeoutError extends Error {
  readonly ms: number;
  constructor(ms: number) {
    super(`SUPABASE_REST_TIMEOUT: no response within ${ms}ms`);
    this.name = 'SupabaseTimeoutError';
    this.ms = ms;
  }
}

export interface TimedFetchOptions {
  timeoutMs?: number;
  cbThreshold?: number;
  cbOpenMs?: number;
}

type FetchImpl = (url: RequestInfo | URL, init?: RequestInit) => Promise<Response>;

export interface TimedFetchState {
  circuit: 'closed' | 'open';
  failures: number;
  openUntil: number;
}

/**
 * Build a fetch wrapper around a base fetch implementation. The base
 * defaults to global fetch; tests inject a controlled one (hang,
 * fast-fail, success) — no network, no monkey-patching required.
 * Returns the fetch impl and a live state view for assertions.
 */
export function createTimedFetch(
  baseFetch: FetchImpl = fetch,
  opts: TimedFetchOptions = {},
): { fetch: FetchImpl; state: TimedFetchState } {
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const cbThreshold = opts.cbThreshold ?? DEFAULT_CB_THRESHOLD;
  const cbOpenMs = opts.cbOpenMs ?? DEFAULT_CB_OPEN_MS;
  const state: TimedFetchState = { circuit: 'closed', failures: 0, openUntil: 0 };

  const wrapped: FetchImpl = (url, init) => {
    if (Date.now() < state.openUntil) {
      return Promise.reject(new SupabaseDegradedError());
    }
    const ac = new AbortController();
    const callerSignal = init?.signal;
    if (callerSignal) {
      if (callerSignal.aborted) ac.abort();
      else callerSignal.addEventListener('abort', () => ac.abort(), { once: true });
    }
    // Race against a hard timer — a stalled fetch that never settles
    // (e.g. hung PostgREST socket) ignores the abort signal, so the
    // timeout must reject on its own, not just abort the transport.
    return Promise.race<Response>([
      baseFetch(url, { ...init, signal: ac.signal }),
      new Promise<Response>((_, reject) =>
        setTimeout(() => { ac.abort(); reject(new SupabaseTimeoutError(timeoutMs)); }, timeoutMs)),
    ])
      .then(r => {
        state.failures = 0;
        state.circuit = 'closed';
        return r;
      })
      .catch(e => {
        const isTimeout = e instanceof SupabaseTimeoutError
          || (e instanceof Error && (e.name === 'AbortError' || e.name === 'TimeoutError' || ac.signal.aborted));
        const isTransport = e instanceof Error
          && (e.message.includes('ECONNREFUSED') || e.message.includes('ECONNRESET') || e.message.includes('fetch failed') || e.message.includes('socket hangup'));
        if (isTimeout || isTransport) {
          const err = ac.signal.aborted && !(callerSignal?.aborted) && !(e instanceof SupabaseTimeoutError) ? new SupabaseTimeoutError(timeoutMs) : e;
          state.failures++;
          if (state.failures >= cbThreshold) {
            state.openUntil = Date.now() + cbOpenMs;
            state.circuit = 'open';
          }
          throw err;
        }
        throw e;
      });
  };

  return { fetch: wrapped, state };
}

// Shared transport state for the default client — lets the REST probe
// in workspace/state report the live circuit.
const defaultTimed = createTimedFetch();

export function supabaseRestHealth(): { circuit: 'closed' | 'open'; failures: number } {
  return { circuit: Date.now() < defaultTimed.state.openUntil ? 'open' : 'closed', failures: defaultTimed.state.failures };
}

/** test hook — force the shared breaker's state */
export function _resetBreaker(): void {
  defaultTimed.state.failures = 0;
  defaultTimed.state.openUntil = 0;
  defaultTimed.state.circuit = 'closed';
}

/**
 * Drop-in replacement for createClient — same generics/signature, so
 * callers that typed clients as ReturnType<typeof createClient> keep
 * working. Adds only the timed circuit-broken fetch transport.
 *
 * A caller-supplied options.global.fetch is used as the BASE transport
 * (wrapped with the timeout) — which is also how fault-injection tests
 * inject a hanging/failing transport without touching global fetch.
 */
export const createTimedClient: (
  url: string | undefined,
  key: string | undefined,
  options?: SupabaseClientOptions<string>,
) => SupabaseClient = (url, key, options) => {
  if (!url || !key) throw new Error('Supabase env vars not configured');
  const callerFetch = options?.global?.fetch as FetchImpl | undefined;
  const timed = callerFetch ? createTimedFetch(callerFetch) : defaultTimed;
  return createClient(url, key, {
    ...options,
    global: { ...(options?.global ?? {}), fetch: timed.fetch },
  } as SupabaseClientOptions<string>) as SupabaseClient;
};

export type { SupabaseClient };
