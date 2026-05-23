/**
 * api/rezonate/rights.js — Vercel Serverless Function (CJS)
 *
 * Rights and fingerprint management for Rezonate audio assets.
 *
 * POST body: { action, ...params }
 *   submit — { action: 'submit', audio_base64, project_id?, audio_file_id?, user_id? }
 *            Proxy to `rezonate-fingerprint` edge function.
 *   check  — { action: 'check', fingerprint_id }
 *            Query rezonate_ownership joined with rezonate_fingerprints.
 *            Returns ownership record, or { status: 'unverified' } if none exists.
 *   claim  — { action: 'claim', fingerprint_id, user_id, owner_name, claim_evidence? }
 *            Upsert into rezonate_ownership with status 'unverified'.
 *
 * GET ?fingerprint_id=xxx → returns fingerprint + ownership record.
 * GET ?hash=xxx           → finds fingerprint by hash, returns same.
 *
 * Response shape: { data, error }
 *
 * Pattern: CJS module.exports handler (internal service route, no auth middleware).
 */

const { createClient } = require('@supabase/supabase-js');

// Use global fetch (Node 18+) or fall back to node-fetch if available.
let fetchFn;
try {
  fetchFn = require('node-fetch');
} catch (_) {
  fetchFn = fetch; // global fetch (Node >= 18)
}

// Initialise Supabase client using service-role key (server-side only).
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/**
 * Build the base URL for a named Supabase Edge Function.
 *
 * @param {string} functionName
 * @returns {string}
 */
function edgeFunctionUrl(functionName) {
  return `${process.env.SUPABASE_URL}/functions/v1/${functionName}`;
}

/**
 * Common Authorization header for calling Edge Functions with service-role key.
 *
 * @returns {{ Authorization: string, 'Content-Type': string }}
 */
function edgeFunctionHeaders() {
  return {
    Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
    'Content-Type': 'application/json',
  };
}

/**
 * Retrieve a fingerprint record by its id and attach any ownership record.
 *
 * @param {string} fingerprint_id
 * @returns {Promise<{ status: number, json: object }>}
 */
async function getFingerprintWithOwnership(fingerprint_id) {
  const { data: fingerprint, error: fpError } = await supabase
    .from('rezonate_fingerprints')
    .select('*')
    .eq('id', fingerprint_id)
    .single();

  if (fpError) {
    return { status: 500, json: { data: null, error: fpError.message } };
  }

  const { data: ownership, error: owError } = await supabase
    .from('rezonate_ownership')
    .select('*')
    .eq('fingerprint_id', fingerprint_id)
    .maybeSingle();

  if (owError) {
    return { status: 500, json: { data: null, error: owError.message } };
  }

  return {
    status: 200,
    json: { data: { fingerprint, ownership: ownership || null }, error: null },
  };
}

/**
 * Main handler.
 *
 * @param {import('http').IncomingMessage & { body: any, query: any }} req
 * @param {import('http').ServerResponse} res
 */
async function handler(req, res) {
  // ── method gate ──────────────────────────────────────────────────────────────
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ data: null, error: 'Method not allowed' });
  }

  try {
    // ── GET ──────────────────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { fingerprint_id, hash } = req.query || {};

      // GET ?fingerprint_id=xxx
      if (fingerprint_id) {
        const { status, json } = await getFingerprintWithOwnership(fingerprint_id);
        return res.status(status).json(json);
      }

      // GET ?hash=xxx — look up fingerprint by hash first.
      if (hash) {
        const { data: fingerprint, error: fpError } = await supabase
          .from('rezonate_fingerprints')
          .select('*')
          .eq('hash', hash)
          .maybeSingle();

        if (fpError) {
          console.error('[Rezonate/Rights] hash lookup error:', fpError);
          return res.status(500).json({ data: null, error: fpError.message });
        }
        if (!fingerprint) {
          return res.status(404).json({ data: null, error: 'No fingerprint found for that hash' });
        }

        const { status, json } = await getFingerprintWithOwnership(fingerprint.id);
        return res.status(status).json(json);
      }

      return res.status(400).json({ data: null, error: 'fingerprint_id or hash query param is required' });
    }

    // ── POST ─────────────────────────────────────────────────────────────────────
    const body = req.body || {};
    const { action } = body;

    if (!action) {
      return res.status(400).json({ data: null, error: 'action is required' });
    }

    // ── submit: proxy to rezonate-fingerprint edge function ────────────────────
    if (action === 'submit') {
      const { audio_base64, project_id, audio_file_id, user_id } = body;

      if (!audio_base64) {
        return res.status(400).json({ data: null, error: 'audio_base64 is required' });
      }

      const response = await fetchFn(edgeFunctionUrl('rezonate-fingerprint'), {
        method: 'POST',
        headers: edgeFunctionHeaders(),
        body: JSON.stringify({ audio_base64, project_id, audio_file_id, user_id }),
      });
      const json = await response.json();
      return res.status(response.status).json(json);
    }

    // ── check: ownership lookup by fingerprint_id ──────────────────────────────
    if (action === 'check') {
      const { fingerprint_id } = body;

      if (!fingerprint_id) {
        return res.status(400).json({ data: null, error: 'fingerprint_id is required' });
      }

      // Join rezonate_ownership with rezonate_fingerprints via fingerprint_id.
      const { data: ownership, error: owError } = await supabase
        .from('rezonate_ownership')
        .select('*, rezonate_fingerprints(*)')
        .eq('fingerprint_id', fingerprint_id)
        .maybeSingle();

      if (owError) {
        console.error('[Rezonate/Rights] check error:', owError);
        return res.status(500).json({ data: null, error: owError.message });
      }

      if (!ownership) {
        return res.status(200).json({ data: { status: 'unverified' }, error: null });
      }
      return res.status(200).json({ data: ownership, error: null });
    }

    // ── claim: upsert ownership record with status 'unverified' ───────────────
    if (action === 'claim') {
      const { fingerprint_id, user_id, owner_name, claim_evidence } = body;

      if (!fingerprint_id) {
        return res.status(400).json({ data: null, error: 'fingerprint_id is required' });
      }
      if (!user_id) {
        return res.status(400).json({ data: null, error: 'user_id is required' });
      }
      if (!owner_name) {
        return res.status(400).json({ data: null, error: 'owner_name is required' });
      }

      const record = {
        fingerprint_id,
        user_id,
        owner_name,
        claim_evidence: claim_evidence || null,
        status: 'unverified',
        updated_at: new Date().toISOString(),
      };

      const { data, error } = await supabase
        .from('rezonate_ownership')
        .upsert(record, { onConflict: 'fingerprint_id' })
        .select()
        .single();

      if (error) {
        console.error('[Rezonate/Rights] claim error:', error);
        return res.status(500).json({ data: null, error: error.message });
      }
      return res.status(200).json({ data, error: null });
    }

    // ── unknown action ───────────────────────────────────────────────────────
    return res.status(400).json({ data: null, error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('[Rezonate/Rights] Unhandled error:', err);
    return res.status(500).json({ data: null, error: err.message || 'Internal server error' });
  }
}

module.exports = handler;
