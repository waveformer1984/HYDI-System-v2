import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../../lib/auth/requireAuth.js';

let _supabase = null;
function getSupabase() {
  if (!_supabase) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
      throw new Error('Supabase env vars not configured (SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY)');
    }
    _supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
  }
  return _supabase;
}
const supabase = new Proxy({}, { get: (_, prop) => getSupabase()[prop] });

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', process.env.MOBILE_CHAT_ORIGIN || '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
      const auth = await requireAuth(req, res, supabase, { permission: 'song_composer:view', routeName: 'song-composer-songs-get' });
      if (!auth.ok) return;

      const { limit = '20', offset = '0' } = req.query;

      const { data, error, count } = await supabase
        .from('actions')
        .select('*', { count: 'exact' })
        .eq('task_name', 'song_composition')
        .order('created_at', { ascending: false })
        .range(Number(offset), Number(offset) + Number(limit) - 1);

      if (error) throw error;

      const songs = (data || []).map((row) => ({
        id: row.id,
        created_at: row.created_at,
        description: row.payload?.description || '',
        song: row.payload?.song || null,
      }));

      return res.status(200).json({ ok: true, songs, total: count });
    }

    if (req.method === 'DELETE') {
      const auth = await requireAuth(req, res, supabase, { permission: 'song_composer:manage', routeName: 'song-composer-songs-delete' });
      if (!auth.ok) return;

      const { id } = req.query;
      if (!id) return res.status(400).json({ ok: false, error: 'id is required' });

      // Scope to task_name='song_composition' so this route can only ever
      // delete rows it owns, never arbitrary rows in the shared 'actions'
      // table (e.g. agent-manager tasks).
      const { error, count } = await supabase
        .from('actions')
        .delete({ count: 'exact' })
        .eq('id', id)
        .eq('task_name', 'song_composition');
      if (error) throw error;
      if (!count) return res.status(404).json({ ok: false, error: 'song not found' });

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[song-composer/songs]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
