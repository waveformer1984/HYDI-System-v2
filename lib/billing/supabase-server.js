'use strict';

const { createServerClient } = require('@supabase/ssr');

function parseCookieHeader(header) {
  if (!header || typeof header !== 'string') return [];
  return header.split(';').map((part) => {
    const idx = part.indexOf('=');
    if (idx < 0) return null;
    const name = part.slice(0, idx).trim();
    const value = part.slice(idx + 1).trim();
    return name ? { name, value } : null;
  }).filter(Boolean);
}

/**
 * Supabase client for billing auth (cookie session). Uses anon key only.
 */
function createBillingSupabaseServer(req, res) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;

  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return parseCookieHeader(req.headers.cookie);
      },
      setAll(cookiesToSet) {
        if (!res || !cookiesToSet?.length) return;
        const existing = res.getHeader('Set-Cookie');
        const prior = Array.isArray(existing) ? existing : existing ? [existing] : [];
        const next = cookiesToSet.map(({ name, value, options }) => {
          const parts = [`${name}=${value}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
          if (options?.maxAge) parts.push(`Max-Age=${options.maxAge}`);
          if (options?.secure) parts.push('Secure');
          return parts.join('; ');
        });
        res.setHeader('Set-Cookie', [...prior, ...next]);
      },
    },
  });
}

function createBillingSupabaseAdmin() {
  const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  const { createClient } = require('@supabase/supabase-js');
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

module.exports = { createBillingSupabaseServer, createBillingSupabaseAdmin, parseCookieHeader };
