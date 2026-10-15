'use strict';

/**
 * Sanitized, read-only billing identity readiness for mobile ops / sandbox reports.
 * Never returns secrets, cookies, or tenant payloads.
 */

function hasPublicSupabaseConfig() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  return Boolean(url && anon && String(anon).length >= 8);
}

/**
 * @param {{ tablesFound?: Set<string> | string[], missing?: string[] }} [db]
 */
function summarizeBillingIdentityReadiness(db = {}) {
  const supabaseAuth = process.env.BILLING_SUPABASE_AUTH !== 'false';
  const legacy = process.env.BILLING_LEGACY_CUSTOMER_TOKEN !== 'false';
  const found = db.tablesFound instanceof Set ? db.tablesFound : new Set(db.tablesFound || []);
  const missing = db.missing || [];
  const membersOk = found.has('billing_tenant_members') || !missing.includes('billing_tenant_members');
  const walkieOk = found.has('billing_walkie_tenant_bindings') || !missing.includes('billing_walkie_tenant_bindings');

  return {
    identity_model: 'A+B',
    supabase_member_auth: {
      enabled: supabaseAuth,
      public_config_present: hasPublicSupabaseConfig(),
      verification: supabaseAuth && hasPublicSupabaseConfig() ? 'NOT_RUN' : supabaseAuth ? 'BLOCKED' : 'DISABLED',
    },
    walkie_tenant_binding: {
      requires_operator_approval: true,
      pairing_alone_grants_billing: false,
      schema_ready: walkieOk ? 'VERIFIED' : missing.length ? 'BLOCKED' : 'UNKNOWN',
    },
    legacy_hbc1_token: {
      enabled: legacy,
      verification: legacy ? 'NOT_RUN' : 'DISABLED',
    },
    database: {
      billing_tenant_members: membersOk ? 'VERIFIED' : 'BLOCKED',
      billing_walkie_tenant_bindings: walkieOk ? 'VERIFIED' : 'BLOCKED',
    },
    human_actions: [
      ...(supabaseAuth && !hasPublicSupabaseConfig() ? ['Set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY'] : []),
      ...(missing.length ? [`Apply billing migrations (missing tables: ${missing.join(', ')})`] : []),
      'Complete docs/billing/SANDBOX_RUN_OPERATOR.md browser + webhook evidence (Phase 1 §J)',
      'Operator-approve Walkie devices via POST /api/billing/admin/walkie-bindings before walkie billing access',
    ],
  };
}

module.exports = { summarizeBillingIdentityReadiness, hasPublicSupabaseConfig };
