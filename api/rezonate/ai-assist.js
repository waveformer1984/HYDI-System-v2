/**
 * api/rezonate/ai-assist.js — Vercel Serverless Function (CJS)
 *
 * AI production assist proxy for Rezonate.
 *
 * POST body: { project_id, request_type, context? }
 *   Validates that `request_type` is one of the known types listed below.
 *   Proxies the request to the `rezonate-ai-assist` Supabase Edge Function.
 *   Returns the suggestion result from the edge function.
 *
 * GET (no params required)
 *   Returns { available_request_types: [...] } listing all valid request types.
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

// Supabase client is available for future local DB operations if needed.
// Currently all logic is proxied to the edge function.
const supabase = createClient( // eslint-disable-line no-unused-vars
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/** All request types supported by the rezonate-ai-assist edge function. */
const AVAILABLE_REQUEST_TYPES = [
  'tighten_timing',
  'remove_noise',
  'find_key',
  'suggest_bassline',
  'detect_clipping',
  'generate_drum_layer',
];

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
    // ── GET: return available request types ─────────────────────────────────────
    if (req.method === 'GET') {
      return res.status(200).json({
        data: { available_request_types: AVAILABLE_REQUEST_TYPES },
        error: null,
      });
    }

    // ── POST ─────────────────────────────────────────────────────────────────────
    const { project_id, request_type, context } = req.body || {};

    // Validate required fields.
    if (!project_id) {
      return res.status(400).json({ data: null, error: 'project_id is required' });
    }
    if (!request_type) {
      return res.status(400).json({ data: null, error: 'request_type is required' });
    }
    if (!AVAILABLE_REQUEST_TYPES.includes(request_type)) {
      return res.status(400).json({
        data: null,
        error: `request_type must be one of: ${AVAILABLE_REQUEST_TYPES.join(', ')}`,
      });
    }

    // Proxy to the rezonate-ai-assist edge function.
    const response = await fetchFn(edgeFunctionUrl('rezonate-ai-assist'), {
      method: 'POST',
      headers: edgeFunctionHeaders(),
      body: JSON.stringify({ project_id, request_type, context }),
    });

    const json = await response.json();

    // Relay the edge function's status and body directly.
    return res.status(response.status).json(json);

  } catch (err) {
    console.error('[Rezonate/AI-Assist] Unhandled error:', err);
    return res.status(500).json({ data: null, error: err.message || 'Internal server error' });
  }
}

module.exports = handler;
