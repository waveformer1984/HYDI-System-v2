/**
 * POST /api/billing/auth/signup — self-serve customer sign-up (Supabase Auth + tenant + owner membership).
 * Body: { email, password, tenant_name }
 */
import { getBillingService, sendError, allowMethods, body } from '../../../../lib/billing/http';
import { createBillingSupabaseServer, createBillingSupabaseAdmin } from '../../../../lib/billing/supabase-server';
import { registerTenantOwner } from '../../../../lib/billing/identity-service';
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
    const tenantName = typeof b.tenant_name === 'string' ? b.tenant_name.trim() : '';
    if (!email || !password || password.length < 8 || !tenantName) {
      throw new BillingError('invalid_request', 'email, password (>=8), and tenant_name are required', 400);
    }
    const admin = createBillingSupabaseAdmin();
    if (!admin) throw new BillingError('auth_not_configured', 'Supabase auth is not configured', 503);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
    });
    if (createErr || !created?.user?.id) {
      throw new BillingError('signup_failed', createErr?.message || 'could not create user', 400);
    }

    const service = getBillingService();
    const tenant = await service.createTenant({ name: tenantName, email }, { type: 'customer', id: created.user.id });
    await registerTenantOwner(service.store, {
      tenantId: tenant.tenant_id,
      authUserId: created.user.id,
      actor: { type: 'customer', id: created.user.id },
      reason: 'self-serve signup',
    });

    const supabase = createBillingSupabaseServer(req, res);
    if (supabase) {
      await supabase.auth.signInWithPassword({ email, password });
    }

    res.status(201).json({ ok: true, tenant_id: tenant.tenant_id, user_id: created.user.id });
  } catch (err) {
    sendError(res, err);
  }
}
