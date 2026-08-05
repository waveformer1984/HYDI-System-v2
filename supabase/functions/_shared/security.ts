// Shared Edge Function auth / CORS / rate-limit helpers.
//
// Factored out of duplicate ad hoc logic during the 2026-07-17 Edge
// Function security audit (see ISSUES_FOUND.md). Supabase's `verify_jwt`
// config only proves *a* validly-signed JWT was presented -- the public
// anon key satisfies that too -- so any function that performs a
// privileged, money-moving, or admin action must check the caller's role
// explicitly. Deno's edge runtime doesn't support bare relative imports
// across function boundaries without going through `_shared/`, which is
// the documented Supabase convention for code shared between functions.

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export function json(body: unknown, status = 200, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json', ...extraHeaders },
  });
}

/**
 * Require the caller to present the project's service-role key as a Bearer
 * token. Use this on any function that performs internal/privileged work
 * (queue processing, billing, payouts, state transitions) and is not meant
 * to be called directly by an end user's browser.
 *
 * Returns a Response to return immediately if unauthorized, or `null` if
 * the request may proceed.
 */
export function requireServiceRole(req: Request): Response | null {
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!serviceRoleKey) {
    return json({ error: 'Server misconfigured: missing SUPABASE_SERVICE_ROLE_KEY' }, 500);
  }
  const authHeader = req.headers.get('Authorization') ?? '';
  const token = authHeader.replace(/^Bearer\s+/i, '');
  if (!token || !timingSafeEquals(token, serviceRoleKey)) {
    return json({ error: 'Unauthorized' }, 401);
  }
  return null;
}

/**
 * Compare two strings without short-circuiting on the first differing
 * character, so the time taken doesn't reveal how long a shared prefix the
 * caller guessed.
 *
 * `===` on strings returns as soon as it finds a mismatched byte, which
 * leaks that prefix length through response timing. Remote timing attacks
 * across a network are noisy and this is defense-in-depth rather than a
 * known-exploitable hole, but the comparison guards the service-role key
 * for every privileged Edge Function, so the constant-time version is
 * worth its handful of instructions.
 *
 * Content is compared in constant time; length is not hidden (a JWT-shaped
 * secret's length is not itself sensitive).
 */
function timingSafeEquals(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    // charCodeAt past the end returns NaN; `| 0` normalises it to 0 so
    // every index still contributes a comparison.
    diff |= (a.charCodeAt(i) | 0) ^ (b.charCodeAt(i) | 0);
  }
  return diff === 0;
}

/**
 * In-memory fixed-window rate limiter, mirroring lib/rate-limit.js's
 * approach on the Next.js side. Best-effort: Supabase's edge runtime may
 * run multiple isolates, so this isn't a strictly global limit, but it
 * meaningfully blunts single-instance abuse (credential stuffing, cost
 * DoS against LLM/email/Stripe-adjacent calls) at zero infrastructure
 * cost, matching the caveat already documented for the Node-side limiter.
 *
 * Returns a 429 Response to return immediately if the caller is over
 * budget, or `null` if the request may proceed.
 */
const buckets = new Map<string, { count: number; resetAt: number }>();

// Bucket keys are derived from `x-forwarded-for`, which is caller-influenced,
// so the key space is effectively unbounded and an attacker can mint a fresh
// key per request. Without eviction the Map only ever grows -- turning the
// module whose job is absorbing floods into a memory-exhaustion vector of its
// own. lib/rate-limit.js (the Node-side twin this mirrors) guards the same
// hazard with a background `setInterval` sweep; a background timer is the
// wrong shape for an edge isolate, so eviction here is driven by the request
// path instead:
//
//   1. a sweep of expired buckets, triggered either by SWEEP_INTERVAL_MS having
//      elapsed or by the Map crossing SWEEP_SIZE_WATERMARK. The size trigger
//      matters: a purely time-based sweep lets a burst accumulate a full
//      interval's worth of garbage before reclaiming any of it, so reclamation
//      needs to respond to pressure as well as to the clock.
//   2. a hard MAX_BUCKETS ceiling as a backstop for a burst of unique keys
//      arriving faster than entries expire
//
// All of this runs only when a *new* bucket is about to be created, so the
// steady-state path (an existing bucket being incremented) stays O(1).
const SWEEP_INTERVAL_MS = 60_000;
const MAX_BUCKETS = 10_000;
const SWEEP_SIZE_WATERMARK = MAX_BUCKETS / 2;
let lastSweepAt = 0;

function evictExpired(now: number): void {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
  lastSweepAt = now;
}

function admitNewBucket(now: number): void {
  if (now - lastSweepAt >= SWEEP_INTERVAL_MS || buckets.size >= SWEEP_SIZE_WATERMARK) {
    evictExpired(now);
  }

  if (buckets.size >= MAX_BUCKETS) {
    // Sweeping didn't free anything, so these are all live windows: shed the
    // oldest entries (Map iterates in insertion order, and with a fixed window
    // the oldest-inserted expire soonest) until back under the ceiling.
    //
    // Evicting a live bucket resets that key's count, so a caller flooding
    // unique keys could win back some budget. That is the deliberate trade:
    // a bounded, self-healing limiter that degrades under a key-flood beats an
    // exact one that OOMs the isolate and takes every route down with it.
    const overBy = buckets.size - MAX_BUCKETS + 1;
    let shed = 0;
    for (const key of buckets.keys()) {
      if (shed >= overBy) break;
      buckets.delete(key);
      shed++;
    }
  }
}

export function rateLimit(req: Request, opts: { name: string; windowMs: number; max: number }): Response | null {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const key = `${opts.name}:${ip}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
    admitNewBucket(now);
    buckets.set(key, { count: 1, resetAt: now + opts.windowMs });
    return null;
  }

  if (bucket.count >= opts.max) {
    const retryAfterSeconds = Math.ceil((bucket.resetAt - now) / 1000);
    return json({ error: 'Too many requests', retryAfterSeconds }, 429, { 'Retry-After': String(retryAfterSeconds) });
  }

  bucket.count += 1;
  return null;
}

/** Test-only: clear all rate-limit bucket state between test cases. */
export function __resetRateLimit(): void {
  buckets.clear();
  lastSweepAt = 0;
}

/** Test-only: number of live rate-limit buckets, for eviction assertions. */
export function __bucketCount(): number {
  return buckets.size;
}

/** Test-only: the ceiling enforced by admitNewBucket(). */
export const __MAX_BUCKETS = MAX_BUCKETS;
