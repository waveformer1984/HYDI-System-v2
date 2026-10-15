'use strict';

const { verifyCustomerToken, bearerFrom } = require('./customer-auth');
const { createBillingSupabaseServer } = require('./supabase-server');
const { getActiveMembershipForUser, getWalkieBinding } = require('./identity-service');
const { verifyDeviceRequest } = require('../auth/deviceAuth');

function legacyTokensEnabled() {
  return process.env.BILLING_LEGACY_CUSTOMER_TOKEN !== 'false';
}

function supabaseAuthEnabled() {
  return process.env.BILLING_SUPABASE_AUTH !== 'false';
}

/**
 * Resolve customer principal → tenant id (never from request body/query).
 *
 * @returns {Promise<null | { tenantId: string, mode: string, role?: string, userId?: string, deviceId?: string }>}
 */
async function resolveCustomerIdentity(req, res, { store, supabaseLookupDevice }) {
  if (supabaseAuthEnabled()) {
    const supabase = createBillingSupabaseServer(req, res);
    if (supabase) {
      const { data, error } = await supabase.auth.getUser();
      if (!error && data?.user?.id) {
        const membership = await getActiveMembershipForUser(store, data.user.id);
        if (membership) {
          return {
            tenantId: membership.tenant_id,
            mode: 'supabase_session',
            role: membership.role,
            userId: data.user.id,
          };
        }
      }
    }
  }

  const deviceToken = req.headers['x-hydi-device-token'];
  if (typeof deviceToken === 'string' && deviceToken.length > 0 && supabaseLookupDevice) {
    const verified = await verifyDeviceRequest(supabaseLookupDevice, deviceToken);
    if (verified.valid && verified.deviceId) {
      const binding = await getWalkieBinding(store, verified.deviceId);
      if (binding) {
        return {
          tenantId: binding.tenant_id,
          mode: 'walkie_owner_binding',
          role: binding.role,
          deviceId: verified.deviceId,
        };
      }
    }
  }

  if (legacyTokensEnabled()) {
    const legacy = verifyCustomerToken(bearerFrom(req));
    if (legacy.valid) {
      return { tenantId: legacy.tenantId, mode: 'legacy_customer_token' };
    }
  }

  return null;
}

module.exports = {
  resolveCustomerIdentity,
  legacyTokensEnabled,
  supabaseAuthEnabled,
};
