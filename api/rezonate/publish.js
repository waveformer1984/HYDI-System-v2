/**
 * api/rezonate/publish.js
 * Publish / unpublish a beat and set pricing.
 *
 * POST { action:'publish', project_id, price_cents?, license_type? }
 *   → sets is_published=true, generates public_slug if missing
 * POST { action:'unpublish', project_id }
 *   → sets is_published=false
 * GET  ?slug=<slug>  → fetch project by public_slug (for public beat page SSR)
 */
import { createClient } from '@supabase/supabase-js';

const db = () => createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60)
    + '-' + Math.random().toString(36).slice(2, 7);
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  if (req.method === 'OPTIONS') return res.status(200).end();

  const supabase = db();

  // ── GET: fetch by slug (public, no auth) ─────────────────────────────────
  if (req.method === 'GET') {
    const { slug } = req.query;
    if (!slug) return res.status(400).json({ error: 'slug required' });
    const { data, error } = await supabase
      .from('rezonate_projects')
      .select('id, name, description, bpm, is_published, public_slug, price_cents, license_type, created_at')
      .eq('public_slug', slug)
      .eq('is_published', true)
      .single();
    if (error || !data) return res.status(404).json({ error: 'Beat not found' });
    return res.status(200).json({ data });
  }

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const body = req.body || {};
  const { action, project_id } = body;
  if (!project_id) return res.status(400).json({ error: 'project_id required' });

  if (action === 'publish') {
    const { price_cents = 0, license_type = 'non_exclusive' } = body;
    // Fetch current project to generate slug from name
    const { data: proj } = await supabase
      .from('rezonate_projects')
      .select('name, public_slug')
      .eq('id', project_id)
      .single();
    const slug = proj?.public_slug || slugify(proj?.name || 'beat');
    const { data, error } = await supabase
      .from('rezonate_projects')
      .update({ is_published: true, public_slug: slug, price_cents, license_type })
      .eq('id', project_id)
      .select('id, public_slug, price_cents, license_type')
      .single();
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ data, share_url: `/rezonate/beat/${slug}` });
  }

  if (action === 'unpublish') {
    const { error } = await supabase
      .from('rezonate_projects')
      .update({ is_published: false })
      .eq('id', project_id);
    if (error) return res.status(500).json({ error: error.message });
    return res.status(200).json({ unpublished: true });
  }

  return res.status(400).json({ error: `unknown action: ${action}` });
}
