/**
 * requireOpsAuth — access gate for the operational/executive API surface.
 *
 * The workspace/coo/credentials/system routes expose internal state that
 * must not be readable by anyone who can reach the port. Two credentials:
 *
 *   1. x-hydi-service-token — local HMAC (HYDI_SERVICE_SECRET), the same
 *      scheme the workspace UI already mints for mutating calls.
 *   2. x-hydi-device-token — per-device token resolved against the
 *      device registry when Supabase env is present.
 *
 * Fail-closed: if neither credential verifies, 401. If no secret is
 * configured at all, 503 — a gate that can't verify is a gate that
 * can't open, and "misconfigured" is honest where "open" would not be.
 */

import type { NextApiRequest, NextApiResponse } from 'next';
import { verifyServiceToken } from '../auth/verifyServiceToken.js';

export function requireOpsAuth(req: NextApiRequest, res: NextApiResponse): boolean {
  const serviceTokenHeader = req.headers['x-hydi-service-token'];
  const serviceToken = Array.isArray(serviceTokenHeader) ? serviceTokenHeader[0] : serviceTokenHeader;
  const deviceToken = req.headers['x-hydi-device-token'];

  if (serviceToken) {
    const r = verifyServiceToken(serviceToken, process.env.HYDI_SERVICE_SECRET ?? '');
    if (r.valid) return true;
    res.status(401).json({ error: 'Unauthorized', reason: r.reason });
    return false;
  }

  if (deviceToken) {
    // Device tokens resolve against the registry — handled by requireAuth
    // on routes that have a Supabase client. For ops surfaces, service
    // token is the canonical credential; device tokens are rejected here
    // rather than silently passed.
    res.status(401).json({ error: 'Unauthorized', reason: 'device token not accepted on this route — use a service token' });
    return false;
  }

  if (!process.env.HYDI_SERVICE_SECRET) {
    res.status(503).json({ error: 'Auth gate misconfigured: HYDI_SERVICE_SECRET is not set — refusing rather than defaulting to open' });
    return false;
  }

  res.status(401).json({ error: 'Unauthorized', reason: 'missing x-hydi-service-token' });
  return false;
}
