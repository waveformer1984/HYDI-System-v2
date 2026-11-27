'use strict';

const fs = require('fs');
const path = require('path');

const DEFAULT_PACK_ROOT = path.join(__dirname, '..', 'lead-forge', 'packs');

function parseCsvLine(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { fields.push(value); value = ''; }
    else value += char;
  }
  fields.push(value);
  return fields;
}

function splitListField(text) {
  const raw = String(text || '').trim();
  if (!raw) return [];
  return raw.split(';').map((part) => part.trim()).filter(Boolean);
}

function parseNumberField(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function parseLeadsCsv(content) {
  const lines = String(content).replace(/\r\n/g, '\n').split('\n').filter((line) => line.trim());
  if (lines.length < 2) return [];
  const headers = parseCsvLine(lines[0]);
  const headerIndex = new Map(headers.map((name, index) => [name.trim(), index]));
  const get = (row, name) => {
    const index = headerIndex.get(name);
    if (index === undefined) return '';
    const value = row[index];
    return value === undefined || value === null ? '' : value;
  };
  const rows = [];
  for (let i = 1; i < lines.length; i += 1) {
    const fields = parseCsvLine(lines[i]);
    if (!fields.length) continue;
    const businessName = get(fields, 'business_name').trim();
    if (!businessName) continue;
    rows.push({
      business_name: businessName,
      category: get(fields, 'category').trim() || null,
      address: get(fields, 'address').trim() || null,
      phone: get(fields, 'phone').trim() || null,
      website: get(fields, 'website').trim() || null,
      email: get(fields, 'public_business_email').trim() || null,
      rating: parseNumberField(get(fields, 'rating')),
      review_count: parseNumberField(get(fields, 'review_count')),
      signals: splitListField(get(fields, 'signals_found')),
      fit_score: parseNumberField(get(fields, 'fit_score')),
      fit_reasons: splitListField(get(fields, 'fit_reasons')),
      email_1: get(fields, 'email_1_draft').trim() || null,
      email_2: get(fields, 'email_2_draft').trim() || null,
      email_3: get(fields, 'email_3_draft').trim() || null,
    });
  }
  return rows;
}

function readPackFiles(packId, packRoot = DEFAULT_PACK_ROOT) {
  if (!/^[a-zA-Z0-9-]{1,100}$/.test(String(packId || ''))) throw new Error('invalid pack id');
  const packDir = path.join(packRoot, packId);
  const manifestPath = path.join(packDir, 'manifest.json');
  const csvPath = path.join(packDir, 'leads.csv');
  if (!fs.existsSync(manifestPath)) throw new Error(`manifest not found for pack ${packId}`);
  if (!fs.existsSync(csvPath)) throw new Error(`leads.csv not found for pack ${packId}`);
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const leads = parseLeadsCsv(fs.readFileSync(csvPath, 'utf8'));
  return { packDir, manifest, leads, manifestPath, csvPath };
}

/**
 * Import lead-forge/packs/<id>/ into lf_packs + lf_leads (service_role client).
 * Idempotent on pack id: upserts pack row and replaces lead rows for that pack.
 */
async function importPack(packId, options = {}) {
  const pool = options.pool;
  if (!pool || typeof pool.connect !== 'function') throw new Error('pool is required');
  const { manifest, leads } = readPackFiles(packId, options.packRoot);
  const request = manifest.request || {};
  const niche = request.niche || manifest.niche;
  const city = request.city || manifest.city;
  const radius = Number(request.radius ?? manifest.radius);
  const requestedCount = Number(request.count ?? manifest.requested_count ?? manifest.requestedCount);
  if (!niche || !city) throw new Error('pack manifest missing niche or city');
  if (!Number.isFinite(radius) || radius <= 0) throw new Error('pack manifest missing valid radius');
  if (!Number.isSafeInteger(requestedCount) || requestedCount < 1) {
    throw new Error('pack manifest missing valid requested count');
  }
  const sourceErrors = Array.isArray(manifest.source_errors) ? manifest.source_errors : [];
  const deliveryStatus = manifest.delivery_status || 'awaiting_jordan_approval';
  const createdAt = manifest.created_at || null;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const packParams = [
      packId,
      niche,
      city,
      Math.round(radius),
      requestedCount,
      leads.length,
      JSON.stringify(sourceErrors),
      deliveryStatus,
      createdAt,
    ];
    const packSql = createdAt
      ? `INSERT INTO lf_packs (
          id, niche, city, radius, requested_count, lead_count, source_errors, delivery_status, created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9::timestamptz)
        ON CONFLICT (id) DO UPDATE SET
          niche = EXCLUDED.niche,
          city = EXCLUDED.city,
          radius = EXCLUDED.radius,
          requested_count = EXCLUDED.requested_count,
          lead_count = EXCLUDED.lead_count,
          source_errors = EXCLUDED.source_errors,
          delivery_status = EXCLUDED.delivery_status
        RETURNING id`
      : `INSERT INTO lf_packs (
          id, niche, city, radius, requested_count, lead_count, source_errors, delivery_status
        ) VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
        ON CONFLICT (id) DO UPDATE SET
          niche = EXCLUDED.niche,
          city = EXCLUDED.city,
          radius = EXCLUDED.radius,
          requested_count = EXCLUDED.requested_count,
          lead_count = EXCLUDED.lead_count,
          source_errors = EXCLUDED.source_errors,
          delivery_status = EXCLUDED.delivery_status
        RETURNING id`;
    await client.query(packSql, createdAt ? packParams : packParams.slice(0, -1));

    await client.query('DELETE FROM lf_leads WHERE pack_id = $1', [packId]);

    for (const lead of leads) {
      await client.query(
        `INSERT INTO lf_leads (
          pack_id, business_name, category, address, phone, website, email,
          rating, review_count, signals, fit_score, fit_reasons,
          email_1, email_2, email_3, status
        ) VALUES (
          $1, $2, $3, $4, $5, $6, $7,
          $8, $9, $10::text[], $11, $12::text[],
          $13, $14, $15, 'new'
        )`,
        [
          packId,
          lead.business_name,
          lead.category,
          lead.address,
          lead.phone,
          lead.website,
          lead.email,
          lead.rating,
          lead.review_count,
          lead.signals,
          lead.fit_score,
          lead.fit_reasons,
          lead.email_1,
          lead.email_2,
          lead.email_3,
        ],
      );
    }

    await client.query('COMMIT');
    return { packId, leadCount: leads.length, replaced: true };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

module.exports = {
  DEFAULT_PACK_ROOT,
  importPack,
  parseLeadsCsv,
  readPackFiles,
};