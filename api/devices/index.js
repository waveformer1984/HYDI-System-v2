// Device registration, approval, and revocation — Phase 4. "Approved
// devices only": a freshly registered device is unusable (status='pending')
// until an owner explicitly approves it, except for the one-time bootstrap
// case (first device ever, registered with the master service token,
// requesting the owner role) — otherwise there would be no way to approve
// the very first device.
//
// All non-register actions require the 'owner' role (device management is
// full-control territory, not delegable to operator/agent/viewer).

import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth/requireAuth.js';
import { generateDeviceSecret, deriveSigningKey } from '../../lib/auth/deviceAuth.js';
import { isValidRole } from '../../lib/auth/rbac.js';
import { verifyServiceToken } from '../../lib/auth/verifyServiceToken.js';
import { rateLimit } from '../../lib/rate-limit.js';

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

async function handleRegister(req, res) {
  const { device_id, device_name, requested_role } = req.body || {};
  if (!device_id) return res.status(400).json({ error: 'device_id is required' });

  const role = requested_role && isValidRole(requested_role) ? requested_role : 'viewer';

  const { count } = await supabase.from('devices').select('id', { count: 'exact', head: true });
  const isFirstDevice = !count || count === 0;

  const serviceToken = req.headers['x-hydi-service-token'];
  let bootstrapOwner = false;
  if (isFirstDevice && role === 'owner' && serviceToken) {
    bootstrapOwner = verifyServiceToken(serviceToken).valid;
  }

  const rawSecret = generateDeviceSecret();
  const signingKey = deriveSigningKey(rawSecret);

  const { data, error } = await supabase
    .from('devices')
    .insert({
      device_id,
      device_name: device_name || null,
      role,
      secret_hash: signingKey,
      status: bootstrapOwner ? 'approved' : 'pending',
      approved_by: bootstrapOwner ? 'bootstrap' : null,
      approved_at: bootstrapOwner ? new Date().toISOString() : null,
    })
    .select('device_id, role, status, created_at')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('auth_audit_log').insert({
    event_type: 'device_registered',
    device_id,
    role,
    metadata: { bootstrap_owner: bootstrapOwner },
  }).catch(() => {});

  // The raw secret is returned exactly once. The server never persists it —
  // only sha256(rawSecret) (secret_hash) is stored. Losing this response
  // means re-registering (and, for an already-approved device, revoking
  // the old registration first).
  return res.status(201).json({ device: data, secret: rawSecret });
}

async function handleApprove(req, res, auth) {
  const { device_id, role } = req.body || {};
  if (!device_id) return res.status(400).json({ error: 'device_id is required' });
  if (role && !isValidRole(role)) return res.status(400).json({ error: 'invalid role' });

  const update = { status: 'approved', approved_by: auth.deviceId || 'owner', approved_at: new Date().toISOString() };
  if (role) update.role = role;

  const { data, error } = await supabase
    .from('devices')
    .update(update)
    .eq('device_id', device_id)
    .select('device_id, role, status')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('auth_audit_log').insert({
    event_type: 'device_approved', device_id, role: data.role, metadata: { approved_by: auth.deviceId || 'owner' },
  }).catch(() => {});

  return res.status(200).json({ device: data });
}

async function handleRevoke(req, res, auth) {
  const { device_id, reason } = req.body || {};
  if (!device_id) return res.status(400).json({ error: 'device_id is required' });

  const { data, error } = await supabase
    .from('devices')
    .update({ status: 'revoked', revoked_at: new Date().toISOString(), revoked_reason: reason || null })
    .eq('device_id', device_id)
    .select('device_id, role, status')
    .single();

  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('auth_audit_log').insert({
    event_type: 'device_revoked', device_id, metadata: { reason: reason || null, revoked_by: auth.deviceId || 'owner' },
  }).catch(() => {});

  return res.status(200).json({ device: data });
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.MOBILE_CHAT_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token');
  if (req.method === 'OPTIONS') return res.status(204).end();

  if (req.method === 'POST' && req.body && req.body.action === 'register') {
    if (!rateLimit(req, res, { name: 'device-register', windowMs: 60 * 1000, max: 10 })) return;
    return handleRegister(req, res);
  }

  // Every other action requires an authenticated owner. 'device:manage' is
  // not in any non-owner role's permission list (lib/auth/rbac.js), so this
  // gate is owner-only via the wildcard grant, not an operator/viewer path.
  const auth = await requireAuth(req, res, supabase, { permission: 'device:manage', routeName: 'devices-manage' });
  if (!auth.ok) return;

  if (req.method === 'GET') {
    const { data, error } = await supabase
      .from('devices')
      .select('device_id, device_name, role, status, last_seen_at, created_at')
      .order('created_at', { ascending: false });
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ devices: data || [] });
  }

  if (req.method === 'POST' && req.body && req.body.action === 'approve') {
    return handleApprove(req, res, auth);
  }

  if (req.method === 'POST' && req.body && req.body.action === 'revoke') {
    return handleRevoke(req, res, auth);
  }

  return res.status(400).json({ error: "unknown action; expected 'register' | 'approve' | 'revoke', or GET to list" });
}
