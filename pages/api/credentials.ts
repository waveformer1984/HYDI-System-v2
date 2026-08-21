import { NextApiRequest, NextApiResponse } from 'next';
import { getCredentialRunbookRegistry } from '../../lib/operational/CredentialRunbookRegistry';

/**
 * GET /api/credentials
 *
 * Returns the status of all external credentials with their runbooks.
 * This is the API backing for the Autonomy tab's credential section.
 *
 * Never returns credential values — only presence/absence and validity.
 */
export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const registry = getCredentialRunbookRegistry();
    const statuses = registry.getRunbookStatuses();

    const result = statuses.map((s) => ({
      key: s.key,
      capabilityId: s.runbook.capabilityId,
      service: s.runbook.service,
      provider: s.runbook.provider,
      gates: s.runbook.gates,
      priority: s.runbook.priority,
      estimatedTime: s.runbook.estimatedTime,
      cost: s.runbook.cost,
      requiresCard: s.runbook.requiresCard,
      usesExistingAccount: s.runbook.usesExistingAccount,
      signupUrl: s.runbook.signupUrl,
      status: s.status,
      missingVars: s.missingVars,
      setVars: s.setVars, // names only, not values
      firstSeenMissing: s.firstSeenMissing,
      resolvedAt: s.resolvedAt,
      steps: s.runbook.steps,
      verification: s.runbook.verification,
      alternatives: s.runbook.alternatives || [],
    }));

    const summary = {
      total: result.length,
      ready: result.filter((r) => r.status === 'ready').length,
      partial: result.filter((r) => r.status === 'partial').length,
      missing: result.filter((r) => r.status === 'missing').length,
      nextAction: result.find((r) => r.status !== 'ready')?.service || null,
    };

    return res.status(200).json({
      summary,
      credentials: result,
    });
  } catch (error) {
    console.error('Credentials API error:', error);
    return res.status(500).json({
      error: 'Internal server error',
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}
