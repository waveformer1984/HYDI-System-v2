import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * GET /api/acquisition
 *
 * Returns the current state of all capability acquisition lifecycles.
 * This is the API the operational UI uses to show acquisition status.
 *
 * Never exposes secret values — only fingerprints and metadata.
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'Method not allowed' });
    return;
  }

  try {
    const { getAcquisitionEngine } = await import('../../lib/operational/ExternalCapabilityAcquisitionEngine');
    const { getProviderAdapterRegistry } = await import('../../lib/operational/ProviderAdapters');
    const { getSecretManager } = await import('../../lib/operational/SecretManager');

    const engine = getAcquisitionEngine();
    const registry = getProviderAdapterRegistry();
    const secretManager = getSecretManager();

    const adapters = registry.getAllAdapters();
    const lifecycles = engine.getAllLifecycles();

    const capabilities = adapters.map((adapter) => {
      const lifecycle = engine.getLifecycle(adapter.capabilityId);
      const missing = adapter.discoverMissingCredentials();
      const credentialMetadata = adapter.requiredEnvVars.map((envVar) =>
        secretManager.getCredentialMetadata(envVar),
      );

      return {
        capabilityId: adapter.capabilityId,
        provider: adapter.providerId,
        displayName: adapter.displayName,
        state: lifecycle?.currentState || (missing.length > 0 ? 'BLOCKED' : 'UNKNOWN'),
        blocker: lifecycle?.blocker || (missing.length > 0 ? 'MISSING_CREDENTIAL' : 'UNKNOWN'),
        missingEnvVars: missing,
        credentials: credentialMetadata.map((m) => ({
          envVar: m.envVar,
          present: m.present,
          state: m.state,
          fingerprint: m.fingerprint, // hash only, never the value
          lastVerified: m.lastVerified,
        })),
        lifecycle: lifecycle ? {
          id: lifecycle.id,
          startedAt: lifecycle.startedAt,
          completedAt: lifecycle.completedAt,
          retryCount: lifecycle.retryCount,
          lastError: lifecycle.lastError,
          policyDecision: lifecycle.policyDecision,
          transitions: lifecycle.transitions,
          auditEventCount: lifecycle.auditRecords.length,
        } : null,
      };
    });

    const summary = {
      total: capabilities.length,
      ready: capabilities.filter((c) => c.state === 'READY').length,
      blocked: capabilities.filter((c) => c.state === 'BLOCKED').length,
      policyBlocked: capabilities.filter((c) => c.state === 'POLICY_BLOCKED').length,
      failed: capabilities.filter((c) => c.state.includes('FAILED')).length,
      unknown: capabilities.filter((c) => c.state === 'UNKNOWN').length,
    };

    res.status(200).json({
      summary,
      capabilities,
      lifecycleCount: lifecycles.length,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    console.error('[/api/acquisition] Error:', error);
    res.status(500).json({
      error: 'Failed to get acquisition status',
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}
