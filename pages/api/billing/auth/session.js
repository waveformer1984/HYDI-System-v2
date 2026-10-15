/**
 * GET /api/billing/auth/session — safe session probe (no secrets).
 */
import { sendError, allowMethods, getBillingService } from '../../../../lib/billing/http';
import { createBillingSupabaseServer } from '../../../../lib/billing/supabase-server';
import { getActiveMembershipForUser } from '../../../../lib/billing/identity-service';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['GET'])) return;
  try {
    const supabase = createBillingSupabaseServer(req, res);
    if (!supabase) return res.status(200).json({ authenticated: false, reason: 'auth_not_configured' });
    const { data, error } = await supabase.auth.getUser();
    if (error || !data?.user) return res.status(200).json({ authenticated: false });
    const membership = await getActiveMembershipForUser(getBillingService().store, data.user.id);
    return res.status(200).json({
      authenticated: true,
      user_id: data.user.id,
      tenant_id: membership?.tenant_id || null,
      role: membership?.role || null,
    });
  } catch (err) {
    sendError(res, err);
  }
}
