/**
 * api/rezonate/library.js
 * Sample Library REST API.
 * GET  ?category=drum&limit=20&offset=0  — search/list
 * POST { action:'add_sample', name, category, audio_url, tags, bpm, key, is_user_sample, user_id } — insert
 * POST { action:'delete_sample', id } — delete (owner only via RLS)
 */
import { createClient } from '@supabase/supabase-js';

const supabase = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

const ALLOWED_CATEGORIES = ['drum','melody','bass','vocal','fx','loop','full_track'];

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const db = supabase();

  // ── GET: search/list ──────────────────────────────────────────────────────
  if (req.method === 'GET') {
    const { category, is_user_sample, bpm_min, bpm_max, key, limit = '50', offset = '0' } = req.query;
    let q = db.from('rezonate_sample_library').select('*').order('created_at', { ascending: false })
      .range(parseInt(offset), parseInt(offset) + parseInt(limit) - 1);
    if (category) q = q.eq('category', category);
    if (is_user_sample !== undefined) q = q.eq('is_user_sample', is_user_sample === 'true');
    if (bpm_min) q = q.gte('bpm', parseFloat(bpm_min));
    if (bpm_max) q = q.lte('bpm', parseFloat(bpm_max));
    if (key) q = q.eq('key', key);
    const { data, error } = await q;
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ data });
  }

  // ── POST ──────────────────────────────────────────────────────────────────
  if (req.method === 'POST') {
    const body = req.body || {};
    const { action } = body;

    if (action === 'add_sample') {
      const { name, category, audio_url, tags = [], bpm, key, duration_ms, is_user_sample = false, user_id } = body;
      if (!name || !category || !audio_url) return res.status(400).json({ error: 'name, category, audio_url required' });
      if (!ALLOWED_CATEGORIES.includes(category)) return res.status(400).json({ error: `category must be one of: ${ALLOWED_CATEGORIES.join(', ')}` });
      const { data, error } = await db.from('rezonate_sample_library').insert({
        name, category, audio_url, tags, bpm: bpm || null, key: key || null,
        duration_ms: duration_ms || null, is_user_sample, user_id: user_id || null
      }).select().single();
      if (error) return res.status(500).json({ error: error.message });
      return res.status(201).json({ data });
    }

    if (action === 'delete_sample') {
      const { id } = body;
      if (!id) return res.status(400).json({ error: 'id required' });
      const { error } = await db.from('rezonate_sample_library').delete().eq('id', id);
      if (error) return res.status(500).json({ error: error.message });
      return res.status(200).json({ deleted: true });
    }

    return res.status(400).json({ error: `unknown action: ${action}` });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
