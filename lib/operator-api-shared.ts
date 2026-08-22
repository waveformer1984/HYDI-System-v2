/**
 * Shared helper for operator API routes.
 * Initializes Supabase client and the HumanProxyControlPlane.
 */

import type { NextApiRequest, NextApiResponse } from 'next';

let _supabase: ReturnType<typeof import('@supabase/supabase-js').createClient> | null = null;

export function getSupabase() {
  if (!_supabase) {
    const { createClient } = require('@supabase/supabase-js') as typeof import('@supabase/supabase-js');
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase env vars not configured');
    }
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}

export function getControlPlane() {
  const { getHumanProxyControlPlane } = require('./delegated-operator/HumanProxyControlPlane');
  const cp = getHumanProxyControlPlane();
  const supabase = getSupabase();
  // Initialize if not already
  try { cp.initialize(supabase); } catch { /* already initialized */ }
  return cp;
}

export function getInterventionController() {
  const { getInterventionController } = require('./delegated-operator/InterventionController');
  const controller = getInterventionController();
  const supabase = getSupabase();
  try { controller.initialize(supabase); } catch { /* already initialized */ }
  return controller;
}

export async function authenticate(req: NextApiRequest, res: NextApiResponse, permission: string) {
  const { requireAuth } = require('./auth/requireAuth.js');
  const supabase = getSupabase();
  const auth = await requireAuth(req, res, supabase, {
    permission,
    routeName: 'operator',
  });
  return auth;
}

/**
 * Sanitize any response body to ensure no secret material is present.
 * Defense in depth — the control plane already sanitizes, but this
 * catches anything that might slip through.
 */
export function sanitizeResponse(body: unknown): unknown {
  const json = JSON.stringify(body);
  const patterns: RegExp[] = [
    /sk_live_[A-Za-z0-9]+/gi,
    /rk_live_[A-Za-z0-9]+/gi,
    /whsec_[A-Za-z0-9]+/gi,
    /AKIA[A-Z0-9]{16}/g,
    /-----BEGIN[A-Z ]*PRIVATE KEY-----/g,
    /Bearer\s+[A-Za-z0-9._\-]+/gi,
    /password\s*=\s*[^\s;]+/gi,
    /secret\s*=\s*[^\s;]+/gi,
    /token\s*=\s*[^\s;]+/gi,
    /api_key\s*=\s*[^\s;]+/gi,
    /session_cookie\s*=\s*[^\s;]+/gi,
    /cookie\s*=\s*[^\s;]+/gi,
    /mfa_secret\s*=\s*[^\s;]+/gi,
    /otp\s*=\s*[^\s;]+/gi,
    /authorization\s*=\s*[^\s;]+/gi,
  ];
  let sanitized = json;
  for (const pattern of patterns) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return JSON.parse(sanitized);
}
