// Production Operations Control Plane Status
// GET /api/operations/control-plane
//
// Returns a safe, redacted status report for the production operations
// control plane. NEVER includes secret values.
//
// Auth: requires service token with 'revenue:view' permission.

import { getProductionOperationsControlPlane } from '../../../lib/operational/ProductionOperationsControlPlane';
import { requireAuth } from '../../../lib/auth/requireAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
);

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res, supabase, {
    permission: 'revenue:view',
    routeName: 'control-plane-status',
  });
  if (!auth.ok) return;

  try {
    const controlPlane = getProductionOperationsControlPlane();
    const status = await controlPlane.getStatusReport();

    return res.status(200).json({
      timestamp: new Date().toISOString(),
      configuration: status.configuration,
      stripeCredential: status.stripeCredential,
      pendingAuthorization: status.pendingAuthorization,
      configAuditLog: status.configAuditLog,
      credentialAuditLog: status.credentialAuditLog,
      // Explicitly confirm no secrets are included
      secretsExposed: false,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ error: msg });
  }
}
