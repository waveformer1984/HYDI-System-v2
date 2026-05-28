import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  try {
    if (req.method === 'GET') {
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
      const { id } = req.query;
      if (!id) return res.status(400).json({ ok: false, error: 'id is required' });

      const { error } = await supabase.from('actions').delete().eq('id', id);
      if (error) throw error;

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  } catch (err) {
    console.error('[song-composer/songs]', err);
    return res.status(500).json({ ok: false, error: err.message });
  }
}
