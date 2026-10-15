'use strict';

const { createBillingSupabaseAdmin } = require('./supabase-server');

/**
 * Invalidate Supabase Auth sessions for a user (best-effort).
 * Does not guarantee immediate JWT invalidation on all edge paths; billing still
 * re-checks membership on every customer route.
 */
async function invalidateSupabaseUserSessions(authUserId) {
  if (!authUserId) return { ok: false, reason: 'auth_user_id_required' };
  const admin = createBillingSupabaseAdmin();
  if (!admin) return { ok: false, reason: 'auth_not_configured' };
  try {
    const { error } = await admin.auth.admin.signOut(authUserId, 'global');
    if (error) return { ok: false, reason: error.message || 'signout_failed' };
    return { ok: true, scope: 'global' };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'signout_failed' };
  }
}

module.exports = { invalidateSupabaseUserSessions };
