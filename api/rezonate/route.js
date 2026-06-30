/**
 * Rezonate API Route — Vercel Serverless Function
 *
 * Handles Rezonate DAW Node operations: project management, track management,
 * task dispatch, and node manifest retrieval.
 *
 * Pattern: CJS module.exports handler (internal service route, no auth middleware).
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');
const { verifyServiceToken } = require('../../lib/auth/verifyServiceToken');

// Initialise Supabase client using service-role key (server-side only).
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Path to the static Rezonate node configuration file.
const CONFIG_PATH = path.resolve(__dirname, '../../agents/rezonate_node/config.json');

/**
 * Load and parse the Rezonate node config from disk.
 * Returns the parsed object, or throws if the file cannot be read.
 */
function loadNodeConfig() {
  const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
  return JSON.parse(raw);
}

/**
 * Main handler — dispatches POST / GET requests to the appropriate action.
 *
 * POST body: { action: string, payload?: object }
 * GET query:  action=<name>&...payload fields
 *
 * Response shape: { data, error } with appropriate HTTP status codes.
 */
async function handler(req, res) {
  // ── CORS ───────────────────────────────────────────────────────────────────────
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token');

  // Handle preflight requests
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  // ── service token guard ───────────────────────────────────────────────────────
  const tokenResult = verifyServiceToken(req.headers['x-hydi-service-token']);
  if (!tokenResult.valid) {
    return res.status(401).json({ data: null, error: 'Unauthorized', reason: tokenResult.reason });
  }

  // ── method gate ──────────────────────────────────────────────────────────────
  if (req.method !== 'POST' && req.method !== 'GET') {
    return res.status(405).json({ data: null, error: 'Method not allowed' });
  }

  // ── parse action + payload ────────────────────────────────────────────────────
  let action, payload;
  if (req.method === 'POST') {
    action = req.body && req.body.action;
    payload = (req.body && req.body.payload) || {};
  } else {
    // GET: action and flat payload fields come from query string.
    const { action: qAction, ...rest } = req.query || {};
    action = qAction;
    payload = rest;
  }

  if (!action) {
    return res.status(400).json({ data: null, error: 'action is required' });
  }

  // ── identify the requesting service (verified identity from token) ───────────
  const userId = tokenResult.service;

  try {
    switch (action) {
      // ── list_projects ────────────────────────────────────────────────────────
      case 'list_projects': {
        let query = supabase.from('rezonate_projects').select('*');
        if (userId) {
          query = query.eq('user_id', userId);
        }
        const { data, error } = await query;
        if (error) {
          console.error('[Rezonate] list_projects error:', error);
          return res.status(500).json({ data: null, error: error.message });
        }
        return res.status(200).json({ data, error: null });
      }

      // ── create_project ───────────────────────────────────────────────────────
      case 'create_project': {
        const { name, tempo, time_signature, key_signature } = payload;
        if (!name) {
          return res.status(400).json({ data: null, error: 'payload.name is required' });
        }
        const record = {
          name,
          tempo: tempo || null,
          time_signature: time_signature || null,
          key_signature: key_signature || null,
          user_id: userId || null,
          created_at: new Date().toISOString(),
        };
        const { data, error } = await supabase
          .from('rezonate_projects')
          .insert(record)
          .select()
          .single();
        if (error) {
          console.error('[Rezonate] create_project error:', error);
          return res.status(500).json({ data: null, error: error.message });
        }
        return res.status(201).json({ data, error: null });
      }

      // ── get_project ──────────────────────────────────────────────────────────
      case 'get_project': {
        const { project_id } = payload;
        if (!project_id) {
          return res.status(400).json({ data: null, error: 'payload.project_id is required' });
        }
        const { data, error } = await supabase
          .from('rezonate_projects')
          .select('*')
          .eq('id', project_id)
          .single();
        if (error) {
          console.error('[Rezonate] get_project error:', error);
          return res.status(500).json({ data: null, error: error.message });
        }
        return res.status(200).json({ data, error: null });
      }

      // ── list_tracks ──────────────────────────────────────────────────────────
      case 'list_tracks': {
        const { project_id } = payload;
        if (!project_id) {
          return res.status(400).json({ data: null, error: 'payload.project_id is required' });
        }
        const { data, error } = await supabase
          .from('rezonate_tracks')
          .select('*')
          .eq('project_id', project_id);
        if (error) {
          console.error('[Rezonate] list_tracks error:', error);
          return res.status(500).json({ data: null, error: error.message });
        }
        return res.status(200).json({ data, error: null });
      }

      // ── add_track ────────────────────────────────────────────────────────────
      case 'add_track': {
        const { project_id, name: trackName, type } = payload;
        if (!project_id || !trackName) {
          return res
            .status(400)
            .json({ data: null, error: 'payload.project_id and payload.name are required' });
        }
        const record = {
          project_id,
          name: trackName,
          type: type || null,
          created_at: new Date().toISOString(),
        };
        const { data, error } = await supabase
          .from('rezonate_tracks')
          .insert(record)
          .select()
          .single();
        if (error) {
          console.error('[Rezonate] add_track error:', error);
          return res.status(500).json({ data: null, error: error.message });
        }
        return res.status(201).json({ data, error: null });
      }

      // ── dispatch_task ────────────────────────────────────────────────────────
      case 'dispatch_task': {
        const { task_type, project_id } = payload;
        if (!task_type) {
          return res.status(400).json({ data: null, error: 'payload.task_type is required' });
        }

        // Validate task_type against the accepted list from the node config.
        const config = loadNodeConfig();
        const acceptedTaskTypes = config.accepted_task_types || [];
        if (!acceptedTaskTypes.includes(task_type)) {
          return res.status(400).json({
            data: null,
            error: `Invalid task_type '${task_type}'. Accepted: ${acceptedTaskTypes.join(', ')}`,
          });
        }

        const job = {
          type: 'rezonate_task',
          task_type,
          project_id: project_id || null,
          status: 'pending',
          payload: payload,
          created_at: new Date().toISOString(),
        };
        const { data, error } = await supabase
          .from('actions')
          .insert(job)
          .select()
          .single();
        if (error) {
          console.error('[Rezonate] dispatch_task error:', error);
          return res.status(500).json({ data: null, error: error.message });
        }
        return res.status(201).json({ data, error: null });
      }

      // ── node_manifest ────────────────────────────────────────────────────────
      case 'node_manifest': {
        const config = loadNodeConfig();
        return res.status(200).json({ data: config, error: null });
      }

      // ── unknown action ───────────────────────────────────────────────────────
      default:
        return res.status(400).json({ data: null, error: `Unknown action: ${action}` });
    }
  } catch (err) {
    console.error('[Rezonate] Unhandled error:', err);
    return res.status(500).json({ data: null, error: 'Internal server error' });
  }
}

module.exports = handler;
