// Live Transaction Authorization
// POST /api/operations/authorize-transaction
//
// Issues an explicit, scoped, single-use, time-bounded authorization
// for one controlled live Stripe qualification transaction.
//
// This must ONLY be called after an explicit human instruction
// equivalent to "proceed with Stage 1".
//
// ALLOW_LIVE_STRIPE=true is NOT sufficient to call this endpoint.
// The caller must have 'revenue:manage' permission.
//
// POST body:
//   {
//     "action": "issue" | "revoke",
//     "customer": "<email>",
//     "amountCents": 2900,  // optional, defaults to 2900 ($29)
//     "authorizationId": "<id>",  // for revoke
//     "authorizedBy": "<operator identity>"
//   }

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
    routeName: 'authorize-transaction',
  });
  if (!auth.ok) return;

  const { action, customer, amountCents, authorizationId, authorizedBy } = req.body;

  if (!action || !['issue', 'revoke'].includes(action)) {
    return res.status(400).json({ error: 'action must be "issue" or "revoke"' });
  }

  if (!authorizedBy) {
    return res.status(400).json({ error: 'authorizedBy is required' });
  }

  const controlPlane = getProductionOperationsControlPlane();

  if (action === 'issue') {
    if (!customer) {
      return res.status(400).json({ error: 'customer is required for issuance' });
    }

    const result = controlPlane.issueTransactionAuthorization({
      authorizedBy,
      customer,
      amountCents: amountCents || 2900,
    });

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    return res.status(200).json({
      success: true,
      authorization: result.authorization,
      message: 'Authorization issued. This is single-use and time-bounded.',
    });
  }

  if (action === 'revoke') {
    if (!authorizationId) {
      return res.status(400).json({ error: 'authorizationId is required for revocation' });
    }

    const result = controlPlane.revokeTransactionAuthorization(authorizationId, authorizedBy);

    if (!result.success) {
      return res.status(400).json({ success: false, error: result.error });
    }

    return res.status(200).json({
      success: true,
      message: 'Authorization revoked.',
    });
  }
}
