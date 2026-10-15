/**
 * POST /api/billing/auth/signout
 */
import { sendError, allowMethods } from '../../../../lib/billing/http';
import { createBillingSupabaseServer } from '../../../../lib/billing/supabase-server';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  try {
    const supabase = createBillingSupabaseServer(req, res);
    if (supabase) await supabase.auth.signOut();
    res.status(200).json({ ok: true });
  } catch (err) {
    sendError(res, err);
  }
}
