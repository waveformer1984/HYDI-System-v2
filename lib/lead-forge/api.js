'use strict';

const { listNiches } = require('../../lead-forge/lib/config');
const { validateRequest } = require('../../lead-forge/lib/pack');

function getSupabase() {
  const { createClient } = require('@supabase/supabase-js');
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    return {
      from: () => ({
        insert: async () => ({ error: null }),
      }),
    };
  }
  return createClient(url, key);
}

async function requireLeadForgeAuth(req, res, permission) {
  const { requireAuth } = require('../auth/requireAuth');
  return requireAuth(req, res, getSupabase(), {
    permission,
    routeName: 'lead-forge',
    rateMax: 30,
  });
}

function parsePackBody(body) {
  const payload = body && typeof body === 'object' ? body : {};
  const request = {
    niche: String(payload.niche || '').trim(),
    city: String(payload.city || '').trim(),
    radius: Number(payload.radius ?? 25),
    count: Number(payload.count ?? 50),
    outreach: Boolean(payload.outreach),
  };
  const validIds = new Set(listNiches().map((n) => n.id));
  if (!validIds.has(request.niche)) throw new Error(`unknown niche: ${request.niche}`);
  validateRequest(request);
  return request;
}

module.exports = { getSupabase, parsePackBody, requireLeadForgeAuth };