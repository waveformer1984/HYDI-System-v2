/**
 * api/rezonate/export.js — Vercel Serverless Function (CJS)
 *
 * Export pipeline trigger for Rezonate projects.
 *
 * POST body: { project_id, track_ids?, format, quality? }
 *   Validates that `format` is one of: wav, mp3, flac, stems.
 *   Proxies the request to the `rezonate-export` Supabase Edge Function.
 *   Returns { job_id, status } from the edge function response.
 *
 * GET ?job_id=xxx
 *   Queries the `actions` table by id and returns:
 *   { job_id, status, payload, created_at }
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

/** Accepted export format values. */
const VALID_FORMATS = ['wav', 'mp3', 'flac', 'stems'];

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
    // ── GET ?job_id=xxx ──────────────────────────────────────────────────────────
    if (req.method === 'GET') {
      const { job_id } = req.query || {};

      if (!job_id) {
        return res.status(400).json({ data: null, error: 'job_id query param is required' });
      }

      const { data: action, error } = await supabase
        .from('actions')
        .select('id, status, payload, created_at')
        .eq('id', job_id)
        .single();

      if (error) {
        console.error('[Rezonate/Export] job lookup error:', error);
        return res.status(500).json({ data: null, error: error.message });
      }

      return res.status(200).json({
        data: {
          job_id: action.id,
          status: action.status,
          payload: action.payload,
          created_at: action.created_at,
        },
        error: null,
      });
    }

    // ── POST ─────────────────────────────────────────────────────────────────────
    const { project_id, track_ids, format, quality } = req.body || {};

    // Validate required fields.
    if (!project_id) {
      return res.status(400).json({ data: null, error: 'project_id is required' });
    }
    if (!format) {
      return res.status(400).json({ data: null, error: 'format is required' });
    }
    if (!VALID_FORMATS.includes(format)) {
      return res.status(400).json({
        data: null,
        error: `format must be one of: ${VALID_FORMATS.join(', ')}`,
      });
    }

    // Proxy to the rezonate-export edge function.
    const response = await fetchFn(edgeFunctionUrl('rezonate-export'), {
      method: 'POST',
      headers: edgeFunctionHeaders(),
      body: JSON.stringify({ project_id, track_ids, format, quality }),
    });

    const json = await response.json();

    // Relay the edge function's status and body directly.
    return res.status(response.status).json(json);

  } catch (err) {
    console.error('[Rezonate/Export] Unhandled error:', err);
    return res.status(500).json({ data: null, error: err.message || 'Internal server error' });
  }
}

module.exports = handler;
