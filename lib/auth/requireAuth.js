'use strict';

/**
 * Shared request guard for the mobile-ops API surface
 * (api/agent-manager/control.js, api/devices/*, api/status/system.js,
 * api/heartbeat.js, api/notifications/*, api/memory/search.js,
 * api/voice/command.js, api/work-sessions/*).
 *
 * Two accepted credentials:
 *   1. x-hydi-service-token — the existing global HMAC token
 *      (lib/auth/verifyServiceToken.js, HYDI_SERVICE_SECRET). Treated as
 *      role 'owner' for backward compatibility: every internal caller
 *      that predates device registration (api/chat, termux, hardware
 *      agents) keeps working unchanged.
 *   2. x-hydi-device-token — a per-device token (lib/auth/deviceAuth.js),
 *      resolved to that device's registered role.
 *
 * Every call — success or failure — is written to auth_audit_log so
 * Phase 4's "failed authentication tracking" and "audit trail"
 * requirements are met from one choke point rather than scattered across
 * routes.
 */

const { verifyServiceToken } = require('./verifyServiceToken');
const { verifyDeviceRequest } = require('./deviceAuth');
const { hasPermission } = require('./rbac');
const { rateLimit } = require('../rate-limit');

async function logAuditEvent(supabase, event) {
  try {
    await supabase.from('auth_audit_log').insert({
      event_type: event.event_type,
      device_id: event.device_id || null,
      role: event.role || null,
      ip_address: event.ip_address || null,
      reason: event.reason || null,
      metadata: event.metadata || {},
    });
  } catch (_) {
    // Audit logging must never break the request it's observing.
  }
}

function getClientIp(req) {
  const xff = req.headers && req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return (req.socket && req.socket.remoteAddress) || 'unknown';
}

/**
 * @param {object} req
 * @param {object} res
 * @param {object} supabase
 * @param {object} opts
 * @param {string} opts.permission   RBAC permission required (see lib/auth/rbac.js)
 * @param {string} opts.routeName    used to namespace the rate-limit bucket
 * @param {number} [opts.rateMax]    requests per minute per IP (default 60)
 * @returns {Promise<{ok: true, role: string, deviceId?: string}|{ok: false}>}
 *   On failure, this function has already written the HTTP response —
 *   the caller must return immediately.
 */
async function requireAuth(req, res, supabase, { permission, routeName, rateMax = 60 }) {
  const ip = getClientIp(req);

  if (!rateLimit(req, res, { name: routeName, windowMs: 60 * 1000, max: rateMax })) {
    await logAuditEvent(supabase, { event_type: 'rate_limited', ip_address: ip, metadata: { route: routeName } });
    return { ok: false };
  }

  const serviceToken = req.headers['x-hydi-service-token'];
  const deviceToken = req.headers['x-hydi-device-token'];

  let role = null;
  let deviceId = null;
  let reason = 'missing credentials';

  if (serviceToken) {
    const result = verifyServiceToken(serviceToken);
    if (result.valid) {
      role = 'owner';
    } else {
      reason = result.reason;
    }
  } else if (deviceToken) {
    const result = await verifyDeviceRequest(supabase, deviceToken);
    if (result.valid) {
      role = result.role;
      deviceId = result.deviceId;
    } else {
      reason = result.reason;
      deviceId = result.deviceId || null;
    }
  }

  if (!role) {
    await logAuditEvent(supabase, {
      event_type: 'auth_failure', device_id: deviceId, ip_address: ip, reason, metadata: { route: routeName },
    });
    res.status(401).json({ error: 'Unauthorized', reason });
    return { ok: false };
  }

  if (permission && !hasPermission(role, permission)) {
    await logAuditEvent(supabase, {
      event_type: 'permission_denied', device_id: deviceId, role, ip_address: ip,
      reason: `missing permission: ${permission}`, metadata: { route: routeName },
    });
    res.status(403).json({ error: 'Forbidden', reason: `role '${role}' lacks permission '${permission}'` });
    return { ok: false };
  }

  await logAuditEvent(supabase, {
    event_type: 'auth_success', device_id: deviceId, role, ip_address: ip, metadata: { route: routeName },
  });

  return { ok: true, role, deviceId };
}

module.exports = { requireAuth, logAuditEvent, getClientIp };
