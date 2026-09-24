/**
 * Client Dashboard API — compatibility adapter
 *
 * Thin HTTP wrapper around lib/dashboard/revenue-service.js.
 * All financial_ledger aggregation now lives in one shared module.
 *
 * Returns per-project ledger totals and fee breakdowns, so it requires a
 * service or device credential with 'revenue:view' (ISSUES_FOUND.md #54 —
 * previously unauthenticated with a wildcard CORS origin).
 */

const { createClient } = require('@supabase/supabase-js');
const { fetchClientDashboard } = require('../lib/dashboard/revenue-service');
const { requireAuth } = require('../lib/auth/requireAuth');

// Lazy client for requireAuth's device-token lookup and audit log. A missing
// env var must not crash the module at import time (ISSUES_FOUND.md #32).
let _supabase = null;
function getSupabase() {
  if (!_supabase && process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const auth = await requireAuth(req, res, getSupabase(), { permission: 'revenue:view', routeName: 'client-dashboard' });
  if (!auth.ok) return;

  const { project } = req.query;
  if (!project) {
    return res.status(400).json({ error: 'Project code required' });
  }

  try {
    const dashboard = await fetchClientDashboard(project);

    if (!dashboard) {
      return res.status(503).json({ error: 'Revenue service unavailable' });
    }

    res.status(200).json(dashboard);
  } catch (error) {
    console.error('Client dashboard error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
}
