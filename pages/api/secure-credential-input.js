// Secure Credential Input Endpoint
// POST /api/secure-credential-input
//
// Allows the operator to provide a secret directly to the trusted HYDI
// credential boundary WITHOUT the secret passing through the LLM.
//
// The secret value is received by this endpoint, stored securely via
// CredentialManager, and immediately discarded from request memory.
//
// The response contains ONLY metadata (fingerprint, prefix, mode) —
// never the raw value.
//
// Auth: requires service token with 'credentials:manage' permission.

import { getProductionOperationsControlPlane } from '../../lib/operational/ProductionOperationsControlPlane';
import { requireAuth } from '../../lib/auth/requireAuth';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL || 'http://127.0.0.1:54321',
  process.env.SUPABASE_SERVICE_ROLE_KEY || '',
);

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Require authentication with credential management permission
  const auth = await requireAuth(req, res, supabase, {
    permission: 'credentials:manage',
    routeName: 'secure-credential-input',
  });
  if (!auth.ok) return;

  const {
    provider,
    credentialType,
    environment,
    value,
    actor,
    role,
  } = req.body;

  // Validate required fields
  if (!provider) return res.status(400).json({ error: 'provider is required' });
  if (!credentialType) return res.status(400).json({ error: 'credentialType is required' });
  if (!value) return res.status(400).json({ error: 'value is required' });
  if (!actor) return res.status(400).json({ error: 'actor is required' });

  const validProviders = ['stripe', 'supabase', 'vercel', 'keeper', 'generic'];
  if (!validProviders.includes(provider)) {
    return res.status(400).json({ error: `Invalid provider. Must be one of: ${validProviders.join(', ')}` });
  }

  const validEnvironments = ['test', 'live', 'development', 'unknown'];
  const env = environment || 'unknown';
  if (!validEnvironments.includes(env)) {
    return res.status(400).json({ error: `Invalid environment. Must be one of: ${validEnvironments.join(', ')}` });
  }

  try {
    const controlPlane = getProductionOperationsControlPlane();
    const result = await controlPlane.storeCredentialSecurely(
      provider,
      credentialType,
      env,
      value,
      { actor, role: role || 'operator' }
    );

    if (!result.success) {
      return res.status(500).json({
        success: false,
        error: result.error,
        auditId: result.auditId,
      });
    }

    // Return ONLY metadata — never the raw value
    return res.status(200).json({
      success: true,
      message: 'Credential stored and validated.',
      auditId: result.auditId,
      // Metadata only
      metadata: {
        provider,
        credentialType,
        environment: env,
        // The actual fingerprint and prefix are available via the
        // credential status endpoint — we don't return them here to
        // avoid any information leakage in the input response.
      },
      // Explicitly confirm the value was not returned
      value: 'REDACTED',
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown error';
    // Never include the credential value in the error
    const safeMsg = msg
      .replace(/sk_[a-zA-Z0-9_]+/g, 'sk_***')
      .replace(/rk_[a-zA-Z0-9_]+/g, 'rk_***')
      .replace(/whsec_[a-zA-Z0-9_]+/g, 'whsec_***');
    return res.status(500).json({ success: false, error: safeMsg });
  }
}
