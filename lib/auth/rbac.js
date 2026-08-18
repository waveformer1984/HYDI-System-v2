'use strict';

/**
 * RBAC permission matrix for the mobile-ops control surface (Phase 4).
 *
 * Four roles, per the task brief:
 *   owner    — full HYDI control
 *   operator — manage workers, run approved commands
 *   agent    — execute assigned tasks only (machine role: worker/agent
 *              processes reporting heartbeats, not a human operator)
 *   viewer   — read-only access
 *
 * This is a permission *check*, not an auth mechanism — callers first
 * resolve a role via lib/auth/deviceAuth.js (or the legacy service token,
 * which is treated as 'owner' for backward compatibility with existing
 * internal callers), then call hasPermission(role, permission) before
 * acting. Fail-closed: an unknown role or permission is always denied.
 */

const PERMISSIONS = Object.freeze({
  owner: ['*'],
  operator: [
    'worker:control',
    'worker:view',
    'status:view',
    'heartbeat:post',
    'notifications:view',
    'notifications:manage_prefs',
    'memory:view',
    'memory:search',
    'voice:command',
    'work_sessions:view',
    'song_composer:view',
    'song_composer:manage',
    'rezonate:manage',
    'apex:manage',
    'life_flow:manage',
    'hydi_sync:trigger',
    'revenue:view',
    'revenue:manage',
    'traces:view',
    'actions:approve',
  ],
  agent: [
    'heartbeat:post',
    'status:view',
    'work_sessions:view_own',
  ],
  viewer: [
    'worker:view',
    'status:view',
    'notifications:view',
    'memory:view',
    'memory:search',
    'work_sessions:view',
    'song_composer:view',
    'revenue:view',
    'traces:view',
  ],
});

const ROLES = Object.freeze(['owner', 'operator', 'agent', 'viewer']);

function hasPermission(role, permission) {
  if (!role || !permission) return false;
  const grants = PERMISSIONS[role];
  if (!grants) return false;
  return grants.includes('*') || grants.includes(permission);
}

function isValidRole(role) {
  return ROLES.includes(role);
}

module.exports = { PERMISSIONS, ROLES, hasPermission, isValidRole };
