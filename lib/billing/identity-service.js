'use strict';

const { randomUUID } = require('crypto');
const { BillingError } = require('./errors');

const MEMBER_ROLES = new Set(['owner', 'billing_admin', 'member']);

async function auditMembership(store, { action, tenantId, actor, before, after, reason }) {
  await store.insert('billing_audit_events', {
    audit_id: randomUUID(),
    tenant_id: tenantId,
    actor_type: actor?.type === 'operator' ? 'operator' : actor?.type === 'customer' ? 'customer' : 'system',
    actor_id: String(actor?.id || 'system'),
    action,
    target_type: 'billing_tenant_member',
    target_id: String(after?.member_id || before?.member_id || 'unknown'),
    reason: reason || null,
    before: before || null,
    after: after || null,
  });
}

async function getActiveMembershipForUser(store, authUserId) {
  const rows = await store.findMany('billing_tenant_members', { auth_user_id: authUserId, status: 'active' }, { limit: 2 });
  if (!rows.length) return null;
  if (rows.length > 1) {
    throw new BillingError('membership_ambiguous', 'user belongs to multiple active tenants; contact support', 409);
  }
  return rows[0];
}

async function getWalkieBinding(store, deviceId) {
  if (!deviceId) return null;
  const rows = await store.findMany('billing_walkie_tenant_bindings', { device_id: deviceId }, { limit: 1 });
  return rows[0] || null;
}

async function registerTenantOwner(store, { tenantId, authUserId, actor, reason }) {
  const row = await store.insert('billing_tenant_members', {
    tenant_id: tenantId,
    auth_user_id: authUserId,
    role: 'owner',
    status: 'active',
  });
  await auditMembership(store, {
    action: 'membership.created',
    tenantId,
    actor,
    after: row,
    reason: reason || 'self-serve signup',
  });
  return row;
}

async function revokeWalkieBinding(store, { deviceId, tenantId, actor, reason }) {
  const existing = await getWalkieBinding(store, deviceId);
  if (!existing) throw new BillingError('not_found', 'no walkie binding for device', 404);
  if (tenantId && existing.tenant_id !== tenantId) {
    throw new BillingError('conflict', 'device bound to a different tenant', 409);
  }
  await store.deleteWhere('billing_walkie_tenant_bindings', { device_id: deviceId });
  await store.insert('billing_audit_events', {
    audit_id: randomUUID(),
    tenant_id: existing.tenant_id,
    actor_type: actor?.type || 'operator',
    actor_id: actor?.id || null,
    action: 'walkie.binding.revoked',
    target_type: 'billing_walkie_tenant_binding',
    target_id: String(existing.binding_id || deviceId),
    reason: reason || 'operator revoke',
    before: existing,
    after: null,
  });
  return { revoked: true, device_id: deviceId, tenant_id: existing.tenant_id };
}

async function setMembershipStatus(store, { tenantId, authUserId, status, actor, reason }) {
  if (status !== 'active' && status !== 'revoked') {
    throw new BillingError('invalid_request', 'status must be active or revoked', 400);
  }
  const row = await store.findOne('billing_tenant_members', { tenant_id: tenantId, auth_user_id: authUserId });
  if (!row) throw new BillingError('not_found', 'membership not found', 404);
  const [updated] = await store.update('billing_tenant_members', { member_id: row.member_id }, { status, updated_at: new Date() });
  await auditMembership(store, {
    action: status === 'active' ? 'membership.reactivated' : 'membership.revoked',
    tenantId,
    actor,
    before: row,
    after: updated,
    reason: reason || status,
  });
  return updated;
}

async function bindWalkieOwner(store, { deviceId, tenantId, actor, reason }) {
  const existing = await getWalkieBinding(store, deviceId);
  if (existing && existing.tenant_id !== tenantId) {
    throw new BillingError('conflict', 'device already bound to another tenant', 409);
  }
  const row = await store.insert(
    'billing_walkie_tenant_bindings',
    {
      device_id: deviceId,
      tenant_id: tenantId,
      role: 'owner',
      created_by: actor?.id || null,
    },
    { ignoreConflict: true },
  );
  await store.insert('billing_audit_events', {
    audit_id: randomUUID(),
    tenant_id: tenantId,
    actor_type: actor?.type || 'operator',
    actor_id: actor?.id || null,
    action: 'walkie.binding.created',
    target_type: 'billing_walkie_tenant_binding',
    target_id: String(row?.binding_id || deviceId),
    reason: reason || 'operator bind',
    before: existing || null,
    after: row || { device_id: deviceId, tenant_id: tenantId },
  });
  return row || existing;
}

module.exports = {
  MEMBER_ROLES,
  getActiveMembershipForUser,
  getWalkieBinding,
  registerTenantOwner,
  bindWalkieOwner,
  revokeWalkieBinding,
  setMembershipStatus,
  auditMembership,
};
