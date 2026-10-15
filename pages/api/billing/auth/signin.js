/**
 * POST /api/billing/auth/signin — Supabase password sign-in (sets session cookies).
 */
import { sendError, allowMethods, body } from '../../../../lib/billing/http';
import { createBillingSupabaseServer } from '../../../../lib/billing/supabase-server';
import { BillingError } from '../../../../lib/billing/errors';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  if (process.env.BILLING_SUPABASE_AUTH === 'false') {
    return res.status(503).json({ error: 'auth_disabled', message: 'Supabase customer auth is disabled' });
  }
  try {
    const b = body(req);
    const email = typeof b.email === 'string' ? b.email.trim().toLowerCase() : '';
    const password = typeof b.password === 'string' ? b.password : '';
    if (!email || !password) throw new BillingError('invalid_request', 'email and password required', 400);
    const supabase = createBillingSupabaseServer(req, res);
    if (!supabase) throw new BillingError('auth_not_configured', 'Supabase auth is not configured', 503);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new BillingError('signin_failed', error.message, 401);
    res.status(200).json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
}
