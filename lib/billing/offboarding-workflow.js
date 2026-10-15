'use strict';

const fs = require('fs');
const path = require('path');
const { randomBytes } = require('crypto');
const { BillingError } = require('./errors');
const {
  getActiveMembershipForUser,
  getWalkieBinding,
  setMembershipStatus,
  revokeWalkieBinding,
} = require('./identity-service');
const {
  revokeLegacyTokenNonce,
  revokeAllLegacyTokensForTenant,
  resolveLegacyBearerClaims,
} = require('./legacy-token-revocation');
const { invalidateSupabaseUserSessions } = require('./supabase-session-admin');
const { runHermeticBillingSecurityChecks } = require('./hermetic-security-checks');

function correlationId() {
  return randomBytes(12).toString('hex');
}

function taskDir(root) {
  return path.join(root, '.hydi', 'billing-offboard');
}

function taskPath(root, id) {
  return path.join(taskDir(root), `${id}.json`);
}

function loadTask(root, id) {
  const p = taskPath(root, id);
  if (!fs.existsSync(p)) return null;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function saveTask(root, task) {
  fs.mkdirSync(taskDir(root), { recursive: true });
  fs.writeFileSync(taskPath(root, task.correlation_id), JSON.stringify(task, null, 2));
}

/**
 * Resolve scope server-side. Client may hint auth_user_id / device_id / bearer preview only.
 */
async function resolveOffboardingTarget(store, scope) {
  const out = { tenant_id: null, auth_user_id: null, device_id: null, legacy: null, warnings: [] };
  if (scope.auth_user_id) {
    const membership = await store.findOne('billing_tenant_members', { auth_user_id: scope.auth_user_id, status: 'active' });
    if (!membership && scope.tenant_id) {
      const any = await store.findOne('billing_tenant_members', { auth_user_id: scope.auth_user_id, tenant_id: scope.tenant_id });
      if (any) out.warnings.push('membership_not_active');
    }
    if (membership) {
      out.tenant_id = membership.tenant_id;
      out.auth_user_id = scope.auth_user_id;
    } else if (scope.tenant_id) {
      const row = await store.findOne('billing_tenant_members', { auth_user_id: scope.auth_user_id, tenant_id: scope.tenant_id });
      if (row) {
        out.tenant_id = row.tenant_id;
        out.auth_user_id = scope.auth_user_id;
      }
    }
  }
  if (scope.device_id) {
    const binding = await getWalkieBinding(store, scope.device_id);
    if (binding) {
      if (out.tenant_id && out.tenant_id !== binding.tenant_id) {
        throw new BillingError('conflict', 'device binding tenant does not match membership tenant', 409);
      }
      out.tenant_id = out.tenant_id || binding.tenant_id;
      out.device_id = scope.device_id;
    }
  }
  if (scope.legacy_bearer_preview) {
    out.legacy = resolveLegacyBearerClaims(scope.legacy_bearer_preview);
    if (out.legacy?.tenant_id) {
      if (out.tenant_id && out.tenant_id !== out.legacy.tenant_id) {
        throw new BillingError('conflict', 'legacy token tenant does not match resolved tenant', 409);
      }
      out.tenant_id = out.tenant_id || out.legacy.tenant_id;
    }
  }
  if (scope.tenant_id && !out.tenant_id) {
    const tenant = await store.findOne('billing_tenants', { tenant_id: scope.tenant_id, status: 'active' });
    if (tenant) out.tenant_id = scope.tenant_id;
  }
  if (!out.tenant_id) throw new BillingError('not_found', 'could not resolve tenant scope from server records', 404);
  return out;
}

async function previewOffboarding(store, scope) {
  const resolved = await resolveOffboardingTarget(store, scope);
  const steps = [];
  if (scope.revoke_membership && resolved.auth_user_id) {
    steps.push({ id: 'membership.revoke', target: resolved.auth_user_id, tenant_id: resolved.tenant_id });
  }
  if (scope.revoke_walkie_binding && resolved.device_id) {
    steps.push({ id: 'walkie.revoke', device_id: resolved.device_id, tenant_id: resolved.tenant_id });
  }
  if (scope.revoke_legacy_nonce && resolved.legacy?.token_nonce) {
    steps.push({ id: 'legacy.revoke_nonce', token_nonce: resolved.legacy.token_nonce, tenant_id: resolved.tenant_id });
  }
  if (scope.revoke_all_legacy_tokens) {
    steps.push({ id: 'legacy.revoke_all', tenant_id: resolved.tenant_id });
  }
  if (scope.invalidate_supabase_sessions && resolved.auth_user_id) {
    steps.push({ id: 'supabase.signout_global', auth_user_id: resolved.auth_user_id });
  }
  return { resolved, steps, step_count: steps.length };
}

async function verifyBillingDeniedHermetic() {
  const hermetic = await runHermeticBillingSecurityChecks();
  return {
    ok: hermetic.revocation.ok && hermetic.crossTenant.ok,
    checks: hermetic,
  };
}

async function executeOffboarding(store, { actor, reason, scope, correlation_id, root, verify = true }) {
  if (!reason || reason.trim().length < 5) throw new BillingError('reason_required', 'reason required (min 5 chars)', 400);
  const id = correlation_id || correlationId();
  let task = loadTask(root, id) || {
    correlation_id: id,
    status: 'started',
    created_at: new Date().toISOString(),
    steps: [],
  };
  const preview = await previewOffboarding(store, scope);
  if (!preview.steps.length) {
    throw new BillingError('invalid_request', 'no offboarding steps selected for resolved scope', 400);
  }
  const results = [];
  let partial = false;
  let blocked = false;

  for (const step of preview.steps) {
    const started = new Date().toISOString();
    try {
      if (step.id === 'membership.revoke') {
        await setMembershipStatus(store, {
          tenantId: step.tenant_id,
          authUserId: preview.resolved.auth_user_id,
          status: 'revoked',
          actor,
          reason,
        });
        results.push({ step: step.id, status: 'PASS', started_at: started, completed_at: new Date().toISOString() });
      } else if (step.id === 'walkie.revoke') {
        await revokeWalkieBinding(store, {
          deviceId: step.device_id,
          tenantId: step.tenant_id,
          actor,
          reason,
        });
        results.push({ step: step.id, status: 'PASS', started_at: started, completed_at: new Date().toISOString() });
      } else if (step.id === 'legacy.revoke_nonce') {
        await revokeLegacyTokenNonce(store, {
          tenantId: step.tenant_id,
          tokenNonce: step.token_nonce,
          actor,
          reason,
        });
        results.push({ step: step.id, status: 'PASS', started_at: started, completed_at: new Date().toISOString() });
      } else if (step.id === 'legacy.revoke_all') {
        await revokeAllLegacyTokensForTenant(store, { tenantId: step.tenant_id, actor, reason });
        results.push({ step: step.id, status: 'PASS', started_at: started, completed_at: new Date().toISOString() });
      } else if (step.id === 'supabase.signout_global') {
        const signOut = await invalidateSupabaseUserSessions(preview.resolved.auth_user_id);
        results.push({
          step: step.id,
          status: signOut.ok ? 'PASS' : 'BLOCKED',
          detail: signOut.reason || 'ok',
          started_at: started,
          completed_at: new Date().toISOString(),
        });
        if (!signOut.ok) blocked = true;
      }
    } catch (err) {
      partial = true;
      results.push({
        step: step.id,
        status: 'FAIL',
        error: err instanceof BillingError ? err.code : 'error',
        started_at: started,
        completed_at: new Date().toISOString(),
      });
    }
  }

  let verification = { status: 'NOT_RUN' };
  if (verify) {
    const v = await verifyBillingDeniedHermetic();
    verification = { status: v.ok ? 'PASS' : 'FAIL', scope: 'hermetic' };
    if (!v.ok) partial = true;
  }

  const allPass = results.every((r) => r.status === 'PASS') && verification.status !== 'FAIL';
  const disposition = blocked ? 'blocked' : partial ? 'partial' : allPass ? 'success' : 'failed';
  task = {
    ...task,
    status: disposition,
    updated_at: new Date().toISOString(),
    preview,
    results,
    verification,
    disposition,
  };
  saveTask(root, task);
  return task;
}

async function executeRecovery(store, { actor, reason, scope, root }) {
  if (!reason || reason.trim().length < 5) throw new BillingError('reason_required', 'reason required (min 5 chars)', 400);
  const resolved = await resolveOffboardingTarget(store, scope);
  const results = [];
  if (scope.reactivate_membership && resolved.auth_user_id) {
    await setMembershipStatus(store, {
      tenantId: resolved.tenant_id,
      authUserId: resolved.auth_user_id,
      status: 'active',
      actor,
      reason,
    });
    results.push({ step: 'membership.reactivate', status: 'PASS' });
  }
  if (scope.rebind_walkie && resolved.device_id) {
    const { bindWalkieOwner } = require('./identity-service');
    await bindWalkieOwner(store, {
      deviceId: resolved.device_id,
      tenantId: resolved.tenant_id,
      actor,
      reason,
    });
    results.push({ step: 'walkie.rebind', status: 'PASS' });
  }
  if (scope.issue_legacy_token) {
    throw new BillingError('not_implemented', 'use POST /api/billing/admin/tenants op issue_token after recovery review', 501);
  }
  const active = resolved.auth_user_id ? await getActiveMembershipForUser(store, resolved.auth_user_id) : null;
  return {
    disposition: results.every((r) => r.status === 'PASS') ? 'success' : 'partial',
    resolved,
    results,
    membership_active: Boolean(active),
  };
}

function credentialInventorySummary() {
  return {
    doc: 'docs/billing/CREDENTIAL_INVENTORY.md',
    credentials: ['supabase_session', 'legacy_hbc1', 'walkie_device', 'walkie_billing_binding', 'membership', 'operator_service_token'],
  };
}

module.exports = {
  correlationId,
  previewOffboarding,
  executeOffboarding,
  executeRecovery,
  resolveOffboardingTarget,
  loadTask,
  taskDir,
  credentialInventorySummary,
  verifyBillingDeniedHermetic,
};
