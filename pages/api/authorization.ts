import type { NextApiRequest, NextApiResponse } from 'next';

/**
 * GET  /api/authorization          — list all authorization requests
 * GET  /api/authorization?status=pending — list pending requests only
 * POST /api/authorization          — create a new authorization request
 * POST /api/authorization?action=approve&id=XXX  — approve a request
 * POST /api/authorization?action=deny&id=XXX     — deny a request
 * POST /api/authorization?action=revoke&id=XXX   — revoke a request
 *
 * Authorization is scoped, persistent, auditable, revocable.
 * HEIDI can create PENDING requests but cannot self-approve them.
 * Only the owner (via this API) can approve/deny/revoke.
 */

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    const { getOwnerAuthorizationStore } = await import('../../lib/operational/OwnerAuthorizationStore');

    const store = getOwnerAuthorizationStore();

    if (req.method === 'GET') {
      const status = req.query.status as string | undefined;
      const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;

      // Clean up expired authorizations first
      store.cleanupExpired();

      if (status === 'pending') {
        const pending = store.getPendingRequests();
        return res.status(200).json({
          summary: { pending: pending.length },
          requests: pending,
        });
      }

      const all = store.getAllRequests(limit);
      const summary = {
        total: all.length,
        pending: all.filter((r) => r.status === 'PENDING').length,
        authorized: all.filter((r) => r.status === 'AUTHORIZED').length,
        denied: all.filter((r) => r.status === 'DENIED').length,
        revoked: all.filter((r) => r.status === 'REVOKED').length,
        expired: all.filter((r) => r.status === 'EXPIRED').length,
      };

      return res.status(200).json({ summary, requests: all });
    }

    if (req.method === 'POST') {
      const action = req.query.action as string | undefined;
      const id = req.query.id as string | undefined;

      // ─── Approve ─────────────────────────────────────
      if (action === 'approve' && id) {
        const decidedBy = (req.body?.decidedBy as string) || 'owner';
        const expiresAt = req.body?.expiresAt as string | undefined;
        const approved = store.approve(id, decidedBy, expiresAt);
        if (!approved) {
          return res.status(404).json({ error: 'Authorization request not found', id });
        }
        return res.status(200).json({
          status: 'AUTHORIZED',
          request: approved,
          message: `Authorization approved for ${approved.provider} — ${approved.requestedCommitments.join(', ')}`,
        });
      }

      // ─── Deny ────────────────────────────────────────
      if (action === 'deny' && id) {
        const decidedBy = (req.body?.decidedBy as string) || 'owner';
        const reason = (req.body?.reason as string) || 'Denied by owner';
        const denied = store.deny(id, decidedBy, reason);
        if (!denied) {
          return res.status(404).json({ error: 'Authorization request not found', id });
        }
        return res.status(200).json({
          status: 'DENIED',
          request: denied,
          message: `Authorization denied for ${denied.provider}`,
        });
      }

      // ─── Revoke ──────────────────────────────────────
      if (action === 'revoke' && id) {
        const decidedBy = (req.body?.decidedBy as string) || 'owner';
        const revoked = store.revoke(id, decidedBy);
        if (!revoked) {
          return res.status(404).json({ error: 'Authorization request not found or not revokable', id });
        }
        return res.status(200).json({
          status: 'REVOKED',
          request: revoked,
          message: `Authorization revoked for ${revoked.provider}`,
        });
      }

      // ─── Create new request ──────────────────────────
      if (!action) {
        const {
          provider,
          capabilityId,
          requestedCommitments,
          estimatedFinancialExposureCents,
          currency,
          requiresLegalAcceptance,
          requiresIdentityVerification,
          reason,
          expiresAt,
        } = req.body || {};

        if (!provider || !capabilityId || !requestedCommitments || !reason) {
          return res.status(400).json({
            error: 'Missing required fields: provider, capabilityId, requestedCommitments, reason',
          });
        }

        const request = store.createRequest({
          provider,
          capabilityId,
          requestedCommitments,
          estimatedFinancialExposureCents,
          currency: currency || 'USD',
          requiresLegalAcceptance: !!requiresLegalAcceptance,
          requiresIdentityVerification: !!requiresIdentityVerification,
          reason,
          expiresAt: expiresAt || null,
        });

        return res.status(201).json({
          status: 'PENDING',
          request,
          message: `Authorization request created for ${provider} — awaiting owner approval`,
        });
      }

      return res.status(400).json({ error: `Unknown action: ${action}` });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (error) {
    console.error('[/api/authorization] Error:', error);
    res.status(500).json({
      error: 'Authorization operation failed',
      message: error instanceof Error ? error.message : 'unknown',
    });
  }
}
