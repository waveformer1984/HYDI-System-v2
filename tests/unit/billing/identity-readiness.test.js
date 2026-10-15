'use strict';

const { summarizeBillingIdentityReadiness } = require('../../../lib/billing/identity-readiness');

describe('billing identity readiness summary', () => {
  it('reports blocked member auth when public config missing', () => {
    const prevUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const prevAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    process.env.BILLING_SUPABASE_AUTH = 'true';
    const summary = summarizeBillingIdentityReadiness({ missing: ['billing_tenant_members'] });
    expect(summary.walkie_tenant_binding.pairing_alone_grants_billing).toBe(false);
    expect(summary.supabase_member_auth.verification).toBe('BLOCKED');
    expect(summary.database.billing_tenant_members).toBe('BLOCKED');
    process.env.NEXT_PUBLIC_SUPABASE_URL = prevUrl;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = prevAnon;
  });
});
