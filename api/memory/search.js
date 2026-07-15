// Mobile memory view (Phase 6) — search / tag filter / importance filter
// over the existing `memories` table (pgvector-backed, centralized through
// lib/heidi-memory.ts per HYDI_KERNEL_ARCHITECTURE_ROADMAP.md's explicit
// non-goal: "No new memory store — extend memories/sessions, don't add a
// fourth"). This route does NOT reimplement semantic search — that stays
// lib/heidi-memory.ts's retrieveMemory()/search_memories RPC, used
// internally by the chat orchestrator. This is a plain filtered read (free
// text via ILIKE, tags, importance, kind) for the mobile "browse my
// memories" screen, which doesn't need an embedding round-trip.

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
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-hydi-service-token, x-hydi-device-token');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const auth = await requireAuth(req, res, supabase, { permission: 'memory:search', routeName: 'memory-search' });
  if (!auth.ok) return;

  const { q, tags, min_importance: minImportance, kind, limit } = req.query || {};

  let query = supabase.from('memories').select('id, content, kind, tags, importance_score, expires_at, created_at');

  if (q) query = query.ilike('content', `%${q}%`);
  if (kind) query = query.eq('kind', kind);
  if (minImportance) query = query.gte('importance_score', parseFloat(minImportance));
  if (tags) query = query.overlaps('tags', String(tags).split(',').map((t) => t.trim()).filter(Boolean));

  query = query.order('importance_score', { ascending: false }).order('created_at', { ascending: false }).limit(Math.min(parseInt(limit, 10) || 25, 100));

  const { data, error } = await query;
  if (error) return res.status(500).json({ error: error.message });

  await supabase.from('memory_audit_log').insert({
    action: 'search',
    actor: auth.deviceId || auth.role,
    detail: { q: q || null, tags: tags || null, min_importance: minImportance || null, kind: kind || null, result_count: (data || []).length },
  }).catch(() => {});

  return res.status(200).json({ memories: data || [] });
}
