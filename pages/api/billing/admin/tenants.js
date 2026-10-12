/**
 * Tenant onboarding and customer access tokens.
 * Auth: operator, permission billing:tenants:manage (owner only).
 *
 * POST { op: 'create', name, email, customer_id?, ttl_seconds? } → 201 { tenant, token, expires_at }
 * POST { op: 'issue_token', tenant_id, ttl_seconds? }            → 200 { token, expires_at }
 *
 * The token is shown once in this response and never stored. Treat it as a
 * secret: deliver it to the customer over a private channel.
 */
import { getBillingService, sendError, allowMethods, requireBillingAdmin, body } from '../../../../lib/billing/http';
import { issueCustomerToken } from '../../../../lib/billing/customer-auth';
import { BillingError } from '../../../../lib/billing/errors';

export default async function handler(req, res) {
  if (!allowMethods(req, res, ['POST'])) return;
  const actor = await requireBillingAdmin(req, res, { permission: 'billing:tenants:manage', routeName: 'admin-tenants', rateMax: 10 });
  if (!actor) return;
  const service = getBillingService();
  try {
    const b = body(req);
    res.setHeader('Cache-Control', 'no-store');
    if (b.op === 'create') {
      const tenant = await service.createTenant({ name: b.name, email: b.email, customerId: b.customer_id }, actor);
      const tok = issueCustomerToken(tenant.tenant_id, { ttlSeconds: b.ttl_seconds });
      return res.status(201).json({ tenant, ...tok });
    }
    if (b.op === 'issue_token') {
      const tenant = await service.getTenant(b.tenant_id);
      if (!tenant) throw new BillingError('tenant_not_found', 'tenant not found', 404);
      const tok = issueCustomerToken(tenant.tenant_id, { ttlSeconds: b.ttl_seconds });
      await service.audit(actor, 'tenant.token_issued', { type: 'tenant', id: tenant.tenant_id }, { tenantId: tenant.tenant_id, after: { expires_at: tok.expires_at } });
      return res.status(200).json(tok);
    }
    throw new BillingError('invalid_request', "op must be 'create' or 'issue_token'", 400);
  } catch (err) {
    return sendError(res, err);
  }
}
