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
  if (!token || token !== serviceRoleKey) {
    return json({ error: 'Unauthorized' }, 401);
  }
  return null;
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

export function rateLimit(req: Request, opts: { name: string; windowMs: number; max: number }): Response | null {
  const ip = (req.headers.get('x-forwarded-for') ?? '').split(',')[0].trim() || 'unknown';
  const key = `${opts.name}:${ip}`;
  const now = Date.now();
  const bucket = buckets.get(key);

  if (!bucket || now >= bucket.resetAt) {
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
}
