// One-Click Live Authorization
// POST /api/operations/authorize-live
//
// Implements the one-click "Authorize" flow for going live.
//
// Actions:
//   - "stage": HYDI runs all autonomous steps and stages a LiveAuthorizationRequest
//   - "approve": The human clicks "Allow" — resolves the request, sets ALLOW_LIVE_STRIPE=true,
//                issues a single-use LiveTransactionAuthorization
//   - "deny": The human clicks "Deny" — resolves the request as denied
//   - "revoke": The operator cancels a pending request
//   - "status": Get the current pending request or a specific request by ID
//
// Auth: requires service token with 'revenue:manage' permission.
//
// This endpoint does NOT:
//   - execute a Stripe transaction
//   - display or re-enter the Stripe key
//   - create a global "live mode on forever" switch
//
// The "approve" action is scoped and single-use:
//   - tied to a specific request ID
//   - 15-minute expiry
//   - amount-bounded, customer-bounded
//   - not reusable for a second transaction

import { getProductionOperationsControlPlane } from '../../../lib/operational/ProductionOperationsControlPlane';
import { requireAuth } from '../../../lib/auth/requireAuth';
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

  const auth = await requireAuth(req, res, supabase, {
    permission: 'revenue:manage',
    routeName: 'authorize-live',
  });
  if (!auth.ok) return;

  const { action, requestId, resolvedBy, customer, amountCents, product } = req.body;

  if (!action || !['stage', 'approve', 'deny', 'revoke', 'status'].includes(action)) {
    return res.status(400).json({
      error: 'action must be "stage", "approve", "deny", "revoke", or "status"',
    });
  }

  const controlPlane = getProductionOperationsControlPlane();

  // ─── Stage: HYDI runs autonomous steps and creates a pending request ────
  if (action === 'stage') {
    try {
      const result = await controlPlane.stageLiveAuthorization({
        customer,
        amountCents,
        product,
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error,
          request: result.request, // may be non-null if a pending request already exists
        });
      }

      return res.status(200).json({
        success: true,
        request: result.request,
        message: 'Authorization request staged. Review the summary and click "Allow" to approve, or "Deny" to reject.',
        // The human reads request.summary to see what's about to happen
        // The human reviews request.evidence to see what was verified
        // The human clicks "Allow" by POSTing { action: "approve", requestId: request.id, resolvedBy: "..." }
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return res.status(500).json({ success: false, error: msg });
    }
  }

  // ─── Approve: The human clicks "Allow" ──────────────────────────────────
  if (action === 'approve') {
    if (!requestId) {
      return res.status(400).json({ error: 'requestId is required for approval' });
    }
    if (!resolvedBy) {
      return res.status(400).json({ error: 'resolvedBy is required (who is clicking Allow?)' });
    }

    try {
      const result = controlPlane.resolveLiveAuthorization({
        requestId,
        resolvedBy,
        resolution: 'approve',
        resolvedVia: 'POST /api/operations/authorize-live',
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error,
          request: result.request,
        });
      }

      return res.status(200).json({
        success: true,
        request: result.request,
        transactionAuthorization: result.transactionAuthorization,
        message: 'Authorization approved. ALLOW_LIVE_STRIPE is now true and a single-use transaction authorization has been issued. The authorization expires in 15 minutes.',
        auditRecord: result.request?.auditRecord,
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return res.status(500).json({ success: false, error: msg });
    }
  }

  // ─── Deny: The human clicks "Deny" ──────────────────────────────────────
  if (action === 'deny') {
    if (!requestId) {
      return res.status(400).json({ error: 'requestId is required for denial' });
    }
    if (!resolvedBy) {
      return res.status(400).json({ error: 'resolvedBy is required' });
    }

    try {
      const result = controlPlane.resolveLiveAuthorization({
        requestId,
        resolvedBy,
        resolution: 'deny',
      });

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error,
          request: result.request,
        });
      }

      return res.status(200).json({
        success: true,
        request: result.request,
        message: 'Authorization request denied. No transaction will proceed.',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return res.status(500).json({ success: false, error: msg });
    }
  }

  // ─── Revoke: The operator cancels a pending request ─────────────────────
  if (action === 'revoke') {
    if (!requestId) {
      return res.status(400).json({ error: 'requestId is required for revocation' });
    }
    if (!resolvedBy) {
      return res.status(400).json({ error: 'resolvedBy is required' });
    }

    try {
      const result = controlPlane.revokeLiveAuthorizationRequest(requestId, resolvedBy);

      if (!result.success) {
        return res.status(400).json({
          success: false,
          error: result.error,
          request: result.request,
        });
      }

      return res.status(200).json({
        success: true,
        request: result.request,
        message: 'Authorization request revoked.',
      });
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Unknown error';
      return res.status(500).json({ success: false, error: msg });
    }
  }

  // ─── Status: Get the current pending request or a specific request ──────
  if (action === 'status') {
    if (requestId) {
      const request = controlPlane.getLiveAuthorizationRequest(requestId);
      if (!request) {
        return res.status(404).json({ error: 'Request not found' });
      }
      return res.status(200).json({ request });
    }

    const pending = controlPlane.getPendingLiveAuthorizationRequest();
    const auditTrail = controlPlane.getLiveAuthorizationAuditTrail();

    return res.status(200).json({
      pendingRequest: pending,
      auditTrail,
      secretsExposed: false,
    });
  }
}
