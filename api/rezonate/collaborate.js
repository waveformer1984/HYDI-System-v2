/**
 * api/rezonate/collaborate.js — Vercel Serverless Function (CJS)
 *
 * Thin proxy to the `rezonate-collab` Supabase Edge Function, plus local
 * split-config management stored in the `rezonate_revenue_splits` table.
 *
 * POST body: { action, ...params }
 *   Proxied actions (forwarded to rezonate-collab edge function):
 *     create_session  — start a new collab session
 *     join_session    — add a participant to an existing session
 *     leave_session   — remove a participant from a session
 *     log_event       — append an event to the session log
 *     get_session     — retrieve session state
 *   Local actions (handled here):
 *     set_split — { session_id, split_config: Array<{ user_id, percentage, ... }> }
 *                 Validate percentages sum ≤ 100, upsert into rezonate_revenue_splits.
 *     get_split — { session_id } → read split config for a session.
 *
 * GET ?session_id=xxx → proxy GET to rezonate-collab edge function.
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
 * Forward a POST body to the rezonate-collab edge function and relay the response.
 *
 * @param {object} body - Request body to forward.
 * @returns {Promise<{ status: number, json: object }>}
 */
async function proxyPostToCollab(body) {
  const response = await fetchFn(edgeFunctionUrl('rezonate-collab'), {
    method: 'POST',
    headers: edgeFunctionHeaders(),
    body: JSON.stringify(body),
  });
  const json = await response.json();
  return { status: response.status, json };
}

/**
 * Forward a GET request (with query params) to the rezonate-collab edge function.
 *
 * @param {object} query - Query parameters to append.
 * @returns {Promise<{ status: number, json: object }>}
 */
async function proxyGetToCollab(query) {
  const params = new URLSearchParams(query);
  const url = `${edgeFunctionUrl('rezonate-collab')}?${params.toString()}`;
  const response = await fetchFn(url, {
    method: 'GET',
    headers: edgeFunctionHeaders(),
  });
  const json = await response.json();
  return { status: response.status, json };
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
    // ── GET: proxy to edge function ─────────────────────────────────────────────
    if (req.method === 'GET') {
      const { session_id } = req.query || {};
      if (!session_id) {
        return res.status(400).json({ data: null, error: 'session_id query param is required' });
      }
      const { status, json } = await proxyGetToCollab({ session_id });
      return res.status(status).json(json);
    }

    // ── POST: dispatch on action ─────────────────────────────────────────────────
    const body = req.body || {};
    const { action } = body;

    if (!action) {
      return res.status(400).json({ data: null, error: 'action is required' });
    }

    // Actions forwarded directly to the rezonate-collab edge function.
    const PROXIED_ACTIONS = [
      'create_session',
      'join_session',
      'leave_session',
      'log_event',
      'get_session',
    ];

    if (PROXIED_ACTIONS.includes(action)) {
      const { status, json } = await proxyPostToCollab(body);
      return res.status(status).json(json);
    }

    // ── set_split ──────────────────────────────────────────────────────────────
    if (action === 'set_split') {
      const { session_id, split_config } = body;

      if (!session_id) {
        return res.status(400).json({ data: null, error: 'session_id is required' });
      }
      if (!Array.isArray(split_config) || split_config.length === 0) {
        return res.status(400).json({ data: null, error: 'split_config must be a non-empty array' });
      }

      // Validate that all percentages are numbers and sum to ≤ 100.
      const total = split_config.reduce((sum, entry) => {
        if (typeof entry.percentage !== 'number') {
          throw new TypeError(`Each split entry must have a numeric 'percentage' field`);
        }
        return sum + entry.percentage;
      }, 0);

      if (total > 100) {
        return res.status(400).json({
          data: null,
          error: `Split percentages sum to ${total}, which exceeds 100`,
        });
      }

      // Upsert the split config, keyed by session_id.
      const { data, error } = await supabase
        .from('rezonate_revenue_splits')
        .upsert(
          { session_id, split_config, updated_at: new Date().toISOString() },
          { onConflict: 'session_id' }
        )
        .select()
        .single();

      if (error) {
        console.error('[Rezonate/Collaborate] set_split error:', error);
        return res.status(500).json({ data: null, error: error.message });
      }
      return res.status(200).json({ data, error: null });
    }

    // ── get_split ──────────────────────────────────────────────────────────────
    if (action === 'get_split') {
      const { session_id } = body;

      if (!session_id) {
        return res.status(400).json({ data: null, error: 'session_id is required' });
      }

      const { data, error } = await supabase
        .from('rezonate_revenue_splits')
        .select('*')
        .eq('session_id', session_id)
        .single();

      if (error) {
        console.error('[Rezonate/Collaborate] get_split error:', error);
        return res.status(500).json({ data: null, error: error.message });
      }
      return res.status(200).json({ data, error: null });
    }

    // ── close_session ─────────────────────────────────────────────────────────
    if (action === 'close_session') {
      const { session_id } = body;

      if (!session_id) {
        return res.status(400).json({ data: null, error: 'session_id is required' });
      }

      // Proxy to the rezonate-collab edge function which owns the close logic.
      const { status, json } = await proxyPostToCollab({ action: 'close_session', session_id });
      return res.status(status).json(json);
    }

    // ── unknown action ───────────────────────────────────────────────────────
    return res.status(400).json({ data: null, error: `Unknown action: ${action}` });

  } catch (err) {
    console.error('[Rezonate/Collaborate] Unhandled error:', err);
    return res.status(500).json({ data: null, error: err.message || 'Internal server error' });
  }
}

module.exports = handler;
