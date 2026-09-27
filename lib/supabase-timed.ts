/**
 * Supabase client factory with a hard per-request timeout and a
 * lightweight circuit breaker. supabase-js has no fetch timeout by
 * default — when Kong/PostgREST degrades (accepts the connection,
 * trickles or stalls the response) a single .from().select() can hang
 * for minutes, which is exactly what froze /api/chat for ~90s while
 * direct pg queries to the same Postgres answered in <1s.
 *
 * Behavior:
 *  - every HTTP call is wrapped in AbortSignal.timeout(SUPABASE_TIMEOUT_MS)
 *  - after CB_THRESHOLD consecutive abort/timeout errors the circuit
 *    opens for CB_OPEN_MS: calls reject instantly with a typed error
 *    instead of queuing more doomed requests behind the dead service
 *  - a single success half-closes the circuit again
 *
 * RLS, realtime auth headers, storage — all unchanged; this only adds
 * timeouts around transport. Callers that already handle errors get a
 * fast error instead of a hang. $0, no new infra.
 */
import { createClient, type SupabaseClient, type SupabaseClientOptions } from '@supabase/supabase-js';

const TIMEOUT_MS = Number(process.env.SUPABASE_REST_TIMEOUT_MS ?? 5000);
const CB_THRESHOLD = 3;
const CB_OPEN_MS = 15_000;

let consecutiveFailures = 0;
let openUntil = 0;

export class SupabaseDegradedError extends Error {
  constructor() {
    super('SUPABASE_REST_DEGRADED: circuit breaker open — REST layer failing');
    this.name = 'SupabaseDegradedError';
  }
}

export function supabaseRestHealth(): { circuit: 'closed' | 'open'; failures: number } {
  return { circuit: Date.now() < openUntil ? 'open' : 'closed', failures: consecutiveFailures };
}

/** test hook — force the breaker state */
export function _resetBreaker(): void { consecutiveFailures = 0; openUntil = 0; }

function timedFetch(url: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (Date.now() < openUntil) {
    return Promise.reject(new SupabaseDegradedError());
  }
  return fetch(url, { ...init, signal: AbortSignal.timeout(TIMEOUT_MS) })
    .then(r => {
      consecutiveFailures = 0;
      return r;
    })
    .catch(e => {
      // Only real transport failures trip the breaker — a fast HTTP 500
      // from PostgREST is a healthy REST layer answering honestly.
      if (e instanceof Error && (e.name === 'TimeoutError' || e.name === 'AbortError'
        || e.message.includes('ECONNREFUSED') || e.message.includes('ECONNRESET')
        || e.message.includes('fetch failed'))) {
        consecutiveFailures++;
        if (consecutiveFailures >= CB_THRESHOLD) openUntil = Date.now() + CB_OPEN_MS;
      }
      throw e;
    });
}

/**
 * Drop-in replacement for createClient — same generics/signature, so
 * callers that typed clients as ReturnType<typeof createClient> keep
 * working. Adds only the timed circuit-broken fetch transport.
 */
export const createTimedClient: (
  url: string | undefined,
  key: string | undefined,
  options?: SupabaseClientOptions<string>,
) => SupabaseClient = (url, key, options) => {
  if (!url || !key) throw new Error('Supabase env vars not configured');
  return createClient(url, key, {
    ...options,
    global: { ...(options?.global ?? {}), fetch: timedFetch },
  } as SupabaseClientOptions<string>) as SupabaseClient;
};

export type { SupabaseClient };
