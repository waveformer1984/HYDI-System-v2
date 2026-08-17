'use strict';

const { hasPermission, isValidRole, ROLES, PERMISSIONS } = require('../../lib/auth/rbac');

describe('rbac.hasPermission', () => {
  it('grants owner every permission via wildcard', () => {
    expect(hasPermission('owner', 'worker:control')).toBe(true);
    expect(hasPermission('owner', 'anything:not_even_a_real_permission')).toBe(true);
  });

  it('grants operator worker control but not device management', () => {
    expect(hasPermission('operator', 'worker:control')).toBe(true);
    expect(hasPermission('operator', 'device:approve')).toBe(false);
  });

  it('restricts agent to heartbeat and status/self-scoped permissions only', () => {
    expect(hasPermission('agent', 'heartbeat:post')).toBe(true);
    expect(hasPermission('agent', 'status:view')).toBe(true);
    expect(hasPermission('agent', 'worker:control')).toBe(false);
    expect(hasPermission('agent', 'work_sessions:view')).toBe(false);
  });

  it('restricts viewer to read-only permissions', () => {
    expect(hasPermission('viewer', 'status:view')).toBe(true);
    expect(hasPermission('viewer', 'memory:search')).toBe(true);
    expect(hasPermission('viewer', 'worker:control')).toBe(false);
    expect(hasPermission('viewer', 'notifications:manage_prefs')).toBe(false);
  });

  it('fails closed on unknown role', () => {
    expect(hasPermission('superadmin', 'worker:control')).toBe(false);
  });

  it('fails closed on missing role or permission', () => {
    expect(hasPermission(null, 'worker:control')).toBe(false);
    expect(hasPermission('owner', null)).toBe(false);
    expect(hasPermission(undefined, undefined)).toBe(false);
  });

  it('every non-owner role is a strict subset of a defined permission (no accidental wildcard)', () => {
    ROLES.filter((r) => r !== 'owner').forEach((role) => {
      expect(PERMISSIONS[role]).not.toContain('*');
    });
  });
});

describe('rbac.isValidRole', () => {
  it('accepts the four defined roles', () => {
    ['owner', 'operator', 'agent', 'viewer'].forEach((r) => expect(isValidRole(r)).toBe(true));
  });

  it('rejects anything else', () => {
    expect(isValidRole('admin')).toBe(false);
    expect(isValidRole('')).toBe(false);
    expect(isValidRole(undefined)).toBe(false);
  });
});
