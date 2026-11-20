import { createClient } from '@supabase/supabase-js';
import { rateLimit } from '../../../lib/rate-limit';
import {
  loadConfig,
  publicConfig,
  chatReply,
  computeEstimate,
  normalizeSubmission,
  buildRowsWithConfig,
  newRequestId,
  sendOwnerEmail,
} from '../../../lib/makeready-bot';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key);
}

function routeName(segment) {
  return `makeready-bot:${segment || 'root'}`;
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  const parts = req.query.slug;
  const segment = Array.isArray(parts) ? parts[0] : parts || 'health';

  const limits = {
    config: { windowMs: 60_000, max: 60 },
    chat: { windowMs: 60_000, max: 20 },
    estimate: { windowMs: 60_000, max: 40 },
    submit: { windowMs: 60_000, max: 10 },
    health: { windowMs: 60_000, max: 30 },
  };
  const lim = limits[segment] || limits.health;
  if (!rateLimit(req, res, { name: routeName(segment), ...lim })) return;

  const companySlug = (req.query.slug || req.body?.slug || '').toString().trim()
    || (segment === 'health' ? 'demo-makeready-co' : '');

  try {
    if (segment === 'health' && req.method === 'GET') {
      const slug = (req.query.company || companySlug || 'demo-makeready-co').toString();
      let configOk = false;
      try {
        loadConfig(slug);
        configOk = true;
      } catch {
        configOk = false;
      }
      const sb = getSupabase();
      let requests7d = null;
      if (sb && configOk) {
        const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
        const { count, error } = await sb
          .from('makeready_requests')
          .select('*', { count: 'exact', head: true })
          .eq('company_slug', slug)
          .gte('created_at', since);
        requests7d = error ? null : count;
      }
      return res.status(200).json({
        ok: true,
        service: 'makeready-bot',
        slug,
        config_loaded: configOk,
        requests_last_7d: requests7d,
        ts: new Date().toISOString(),
      });
    }

    if (segment === 'config' && req.method === 'GET') {
      const slug = (req.query.company || req.query.slug || '').toString();
      if (!slug) return res.status(400).json({ error: 'company slug required' });
      const config = loadConfig(slug);
      return res.status(200).json({ ok: true, config: publicConfig(config) });
    }

    if (segment === 'estimate' && req.method === 'POST') {
      const slug = (req.body?.company || req.body?.slug || '').toString();
      if (!slug) return res.status(400).json({ error: 'company slug required' });
      const config = loadConfig(slug);
      const est = computeEstimate(config, req.body || {});
      if (!est.ok) return res.status(400).json(est);
      return res.status(200).json(est);
    }

    if (segment === 'chat' && req.method === 'POST') {
      const slug = (req.body?.company || req.body?.slug || '').toString();
      const message = req.body?.message;
      if (!slug) return res.status(400).json({ error: 'company slug required' });
      if (!message || typeof message !== 'string') return res.status(400).json({ error: 'message required' });
      const config = loadConfig(slug);
      const out = await chatReply(config, message);
      return res.status(200).json({ ok: true, ...out });
    }

    if (segment === 'submit' && req.method === 'POST') {
      const slug = (req.body?.company || req.body?.slug || '').toString();
      if (!slug) return res.status(400).json({ error: 'company slug required' });
      const config = loadConfig(slug);

      const requiredShared = ['builder_company', 'contact_name', 'phone', 'email', 'community'];
      const missing = requiredShared.filter((k) => !req.body?.[k] || String(req.body[k]).trim() === '');
      if (missing.length) return res.status(400).json({ error: 'missing_fields', fields: missing });

      const { shared, lots } = normalizeSubmission(req.body);
      const requestId = newRequestId();
      const built = buildRowsWithConfig(slug, config, shared, lots, requestId);
      if (!built.ok) return res.status(400).json(built);

      const sb = getSupabase();
      if (!sb) {
        return res.status(503).json({ error: 'persistence_unavailable' });
      }

      const { data, error } = await sb.from('makeready_requests').insert(built.rows).select('id');
      if (error) {
        return res.status(500).json({ error: 'insert_failed' });
      }

      let email = { sent: false };
      try {
        email = await sendOwnerEmail(config, requestId, built.rows);
      } catch {
        email = { sent: false, reason: 'send_failed' };
      }

      const accessNote = built.access_redacted ? 'send access info by phone' : null;
      return res.status(201).json({
        ok: true,
        request_id: requestId,
        lots_saved: data?.length || built.rows.length,
        estimate_label: 'estimate, final quote confirmed by owner',
        access_note: accessNote,
        owner_email: email,
      });
    }

    res.setHeader('Allow', ['GET', 'POST', 'OPTIONS']);
    return res.status(404).json({ error: 'not_found' });
  } catch (e) {
    const code = e.code || 'error';
    if (code === 'NOT_FOUND') return res.status(404).json({ error: 'config_not_found' });
    if (code === 'INVALID_SLUG' || code === 'CONFIG_INVALID') return res.status(400).json({ error: code });
    return res.status(500).json({ error: 'server_error' });
  }
}