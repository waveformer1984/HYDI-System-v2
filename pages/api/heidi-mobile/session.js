// Heidi Mobile pairing/session — GET (state), POST (pair | request), DELETE (unpair).
//
// Pairing reuses HYDI's existing device registry (api/devices/index.js):
//   - "pair": the operator types a device_id + the one-time secret that
//     POST /api/devices {action:'register'} returned. We derive the signing
//     key exactly like lib/auth/deviceAuth.js and prove it against HYDI
//     before sealing it into the HttpOnly session cookie.
//   - "request": Heidi registers a fresh device on the phone's behalf and
//     seals the returned secret immediately, so the raw secret never reaches
//     the browser at all. The device stays 'pending' until an owner approves
//     it — this route cannot approve anything.
//
// Neither path ever returns a secret or signing key in a response body.

import { randomBytes } from 'crypto';
import { guard, sendUpstreamFailure } from '../../../lib/heidi-mobile/guard.js';
import { createHydiClient } from '../../../lib/heidi-mobile/hydiClient.js';
import { setSessionCookie, clearSessionCookie } from '../../../lib/heidi-mobile/session.js';
import { deriveSigningKey } from '../../../lib/auth/deviceAuth.js';

const DEVICE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{2,63}$/;
const SECRET_RE = /^[0-9a-f]{64}$/;

function sessionUnavailable(res) {
  return res.status(503).json({
    error: 'session_unavailable',
    message: 'HYDI_SERVICE_SECRET is not configured on the Heidi server, so a secure session cannot be issued.',
  });
}

async function handlePair(req, res) {
  const { device_id: deviceId, secret } = req.body || {};
  if (typeof deviceId !== 'string' || !DEVICE_ID_RE.test(deviceId)) {
    return res.status(400).json({ error: 'invalid_device_id', message: 'Device ID must be 3–64 letters, digits, dots, dashes or underscores.' });
  }
  if (typeof secret !== 'string' || !SECRET_RE.test(secret.trim().toLowerCase())) {
    return res.status(400).json({ error: 'invalid_secret', message: 'The device secret is the 64-character hex value returned at registration.' });
  }
  if (!process.env.HYDI_SERVICE_SECRET) return sessionUnavailable(res);

  const signingKey = deriveSigningKey(secret.trim().toLowerCase());
  const client = createHydiClient({ deviceId, signingKey });
  const probe = await client.request('/api/status/system', { timeoutMs: 8000 });

  if (probe.ok) {
    setSessionCookie(req, res, { deviceId, signingKey, pending: false });
    return res.status(200).json({ paired: true, approved: true, device_id: deviceId });
  }
  if (probe.kind === 'unauthorized' && probe.reason === 'device not approved') {
    setSessionCookie(req, res, { deviceId, signingKey, pending: true });
    return res.status(200).json({ paired: true, approved: false, device_id: deviceId });
  }
  if (probe.kind === 'unauthorized') {
    return res.status(401).json({ error: 'pairing_rejected', message: 'HYDI rejected these device credentials.', reason: probe.reason });
  }
  return sendUpstreamFailure(res, probe);
}

async function handleRequest(req, res) {
  if (!process.env.HYDI_SERVICE_SECRET) return sessionUnavailable(res);

  const rawName = req.body && typeof req.body.device_name === 'string' ? req.body.device_name : '';
  const deviceName = rawName.replace(/[^\w .-]/g, '').trim().slice(0, 48) || 'Heidi Mobile';
  const deviceId = `heidi-${randomBytes(4).toString('hex')}`;

  const client = createHydiClient({});
  const result = await client.request('/api/devices', {
    method: 'POST',
    body: { action: 'register', device_id: deviceId, device_name: deviceName, requested_role: 'operator' },
    timeoutMs: 10000,
  });
  if (!result.ok) return sendUpstreamFailure(res, result);

  const secret = result.data && result.data.secret;
  if (typeof secret !== 'string' || !SECRET_RE.test(secret)) {
    return res.status(502).json({ error: 'malformed', message: 'HYDI registered the device but did not return a usable secret.' });
  }

  setSessionCookie(req, res, { deviceId, signingKey: deriveSigningKey(secret), pending: true });
  return res.status(201).json({ paired: true, approved: false, device_id: deviceId, device_name: deviceName });
}

export default async function handler(req, res) {
  const g = guard(req, res, {
    methods: ['GET', 'POST', 'DELETE'],
    routeName: req.method === 'GET' ? 'session-get' : 'session-write',
    rateMax: req.method === 'GET' ? 60 : 10,
    requireSession: false,
  });
  if (!g.ok) return;

  if (req.method === 'GET') {
    if (!g.session) {
      return res.status(200).json({ paired: false, session_available: Boolean(process.env.HYDI_SERVICE_SECRET) });
    }
    return res.status(200).json({
      paired: true,
      device_id: g.session.deviceId,
      pending_at_pairing: g.session.pending,
      expires_at: new Date(g.session.expiresAt).toISOString(),
    });
  }

  if (req.method === 'DELETE') {
    clearSessionCookie(req, res);
    return res.status(200).json({ paired: false });
  }

  const action = req.body && req.body.action;
  if (action === 'pair') return handlePair(req, res);
  if (action === 'request') return handleRequest(req, res);
  return res.status(400).json({ error: 'invalid_action', message: "action must be 'pair' or 'request'" });
}
