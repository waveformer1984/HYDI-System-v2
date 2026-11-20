import { createClient } from '@supabase/supabase-js';
import {
  clearSessionCookieHeader,
  createSession,
  requireCrewSession,
  sessionCookieHeader,
  verifyPin,
} from '../../../lib/makeready-crew/auth';
import { canTransition } from '../../../lib/makeready-crew/status';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function companySlug() {
  return (process.env.MAKEREADY_CREW_COMPANY_SLUG || '').trim() || null;
}

async function applyAction(sb, row, action, payload) {
  const check = canTransition(row.crew_status, action);
  if (!check.ok) {
    return { ok: false, error: check.error };
  }
  const patch = { status_updated_at: new Date().toISOString() };

  if (action === 'schedule' || action === 'accept') {
    patch.crew_status = 'scheduled';
    if (payload.scheduled_at) patch.scheduled_at = payload.scheduled_at;
    if (payload.crew_label) patch.crew_label = String(payload.crew_label).slice(0, 120);
  } else if (action === 'start') {
    patch.crew_status = 'in_progress';
  } else if (action === 'complete') {
    patch.crew_status = 'done';
    patch.completed_at = new Date().toISOString();
    if (Array.isArray(payload.photos) && payload.photos.length) {
      const safe = payload.photos
        .filter((p) => typeof p === 'string' && p.startsWith('data:image/'))
        .slice(0, 6);
      patch.completion_photos = [...(row.completion_photos || []), ...safe];
    }
  }

  if (payload.note && typeof payload.note === 'string') {
    const line = payload.note.trim().slice(0, 2000);
    if (line) {
      const stamp = new Date().toISOString();
      patch.crew_notes = [row.crew_notes, `[${stamp}] ${line}`].filter(Boolean).join('\n');
    }
  }

  const { data, error } = await sb
    .from('makeready_requests')
    .update(patch)
    .eq('id', row.id)
    .select()
    .single();

  if (error) return { ok: false, error: 'db_error' };
  return { ok: true, job: data };
}

export default async function handler(req, res) {
  const parts = req.query.slug;
  const segment = Array.isArray(parts) ? parts[0] : parts || 'health';

  if (segment === 'health') {
    res.status(200).json({ ok: true, service: 'makeready-crew', auth: 'required' });
    return;
  }

  if (segment === 'manifest' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/manifest+json');
    res.status(200).json({
      name: 'MakeReady Crew',
      short_name: 'Crew',
      start_url: '/makeready-crew',
      display: 'standalone',
      background_color: '#0f172a',
      theme_color: '#0f766e',
    });
    return;
  }

  if (segment === 'login' && req.method === 'POST') {
    const pin = req.body?.pin;
    const slug = companySlug();
    if (!verifyPin(pin)) {
      res.status(401).json({ ok: false, error: 'invalid_pin' });
      return;
    }
    if (!slug) {
      res.status(503).json({ ok: false, error: 'crew_slug_unconfigured' });
      return;
    }
    const token = createSession(slug);
    if (!token) {
      res.status(503).json({ ok: false, error: 'session_secret_missing' });
      return;
    }
    res.setHeader('Set-Cookie', sessionCookieHeader(token));
    res.status(200).json({ ok: true, company_slug: slug });
    return;
  }

  if (segment === 'logout' && req.method === 'POST') {
    res.setHeader('Set-Cookie', clearSessionCookieHeader());
    res.status(200).json({ ok: true });
    return;
  }

  let session;
  try {
    session = requireCrewSession(req);
  } catch {
    res.status(401).json({ ok: false, error: 'unauthorized' });
    return;
  }

  const slug = session.company_slug || companySlug();
  const sb = getSupabase();
  if (!sb) {
    res.status(503).json({ ok: false, error: 'supabase_unconfigured' });
    return;
  }

  if (segment === 'jobs' && req.method === 'GET') {
    const { data, error } = await sb
      .from('makeready_requests')
      .select(
        'id,request_id,builder_company,contact_name,phone,lot_number,address,community,phases,sq_ft,stories,target_date,closing_date,notes,estimate_cents,crew_status,scheduled_at,crew_label,crew_notes,completion_photos,completed_at,created_at',
      )
      .eq('company_slug', slug)
      .order('created_at', { ascending: false })
      .limit(200);
    if (error) {
      res.status(500).json({ ok: false, error: 'db_error' });
      return;
    }
    res.status(200).json({ ok: true, jobs: data || [] });
    return;
  }

  if (segment === 'action' && req.method === 'POST') {
    const { requestId, action, payload } = req.body || {};
    if (!requestId || !action) {
      res.status(400).json({ ok: false, error: 'bad_request' });
      return;
    }
    const { data: row, error } = await sb
      .from('makeready_requests')
      .select('*')
      .eq('id', requestId)
      .eq('company_slug', slug)
      .single();
    if (error || !row) {
      res.status(404).json({ ok: false, error: 'not_found' });
      return;
    }
    const result = await applyAction(sb, row, action, payload || {});
    res.status(result.ok ? 200 : 409).json(result);
    return;
  }

  if (segment === 'sync' && req.method === 'POST') {
    const queue = Array.isArray(req.body?.queue) ? req.body.queue : [];
    const results = [];
    for (const item of queue) {
      const { data: row } = await sb
        .from('makeready_requests')
        .select('*')
        .eq('id', item.requestId)
        .eq('company_slug', slug)
        .maybeSingle();
      if (!row) {
        results.push({ clientId: item.clientId, ok: false, error: 'not_found' });
        continue;
      }
      const result = await applyAction(sb, row, item.action, item.payload || {});
      results.push({
        clientId: item.clientId,
        ok: result.ok,
        error: result.error,
        job: result.job,
      });
    }
    res.status(200).json({ ok: true, results });
    return;
  }

  res.status(404).json({ ok: false, error: 'not_found' });
}