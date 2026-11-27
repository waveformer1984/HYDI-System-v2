'use strict';

const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');

let sharedPool;

function pgConfig() {
  if (process.env.DATABASE_URL) return { connectionString: process.env.DATABASE_URL };
  return {
    host: process.env.PG_HOST || '127.0.0.1',
    port: Number(process.env.PG_PORT || 54322),
    database: process.env.PG_DATABASE || 'postgres',
    user: process.env.PG_USER || 'postgres',
    password: process.env.PG_PASSWORD || 'postgres',
  };
}

function getPool(override) {
  if (override) return override;
  if (!sharedPool) sharedPool = new Pool(pgConfig());
  return sharedPool;
}

async function listPacks(pool = getPool()) {
  const { rows } = await pool.query(
    `SELECT id, niche, city, radius, requested_count, lead_count, delivery_status, created_at
     FROM lf_packs ORDER BY created_at DESC LIMIT 200`,
  );
  return rows;
}

async function getPack(pool, packId) {
  const { rows } = await pool.query('SELECT * FROM lf_packs WHERE id = $1', [packId]);
  return rows[0] || null;
}

async function getPackLeads(pool, packId) {
  const { rows } = await pool.query(
    `SELECT * FROM lf_leads WHERE pack_id = $1 ORDER BY fit_score DESC NULLS LAST, business_name ASC`,
    [packId],
  );
  return rows;
}

async function getLead(pool, leadId) {
  const { rows } = await pool.query('SELECT * FROM lf_leads WHERE id = $1', [leadId]);
  return rows[0] || null;
}

async function getActivitiesForLeads(pool, leadIds) {
  if (!leadIds.length) return [];
  const { rows } = await pool.query(
    `SELECT * FROM lf_activities WHERE lead_id = ANY($1::uuid[]) ORDER BY created_at ASC`,
    [leadIds],
  );
  return rows;
}

async function updateLead(pool, leadId, fields) {
  const allowed = ['status', 'notes', 'next_follow_up', 'email_1', 'email_2', 'email_3'];
  const sets = [];
  const params = [leadId];
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(fields, key)) {
      params.push(fields[key]);
      sets.push(`${key} = $${params.length}`);
    }
  }
  if (!sets.length) return getLead(pool, leadId);
  sets.push('updated_at = now()');
  const { rows } = await pool.query(
    `UPDATE lf_leads SET ${sets.join(', ')} WHERE id = $1::uuid RETURNING *`,
    params,
  );
  return rows[0] || null;
}

async function insertActivity(pool, leadId, kind, body) {
  const { rows } = await pool.query(
    `INSERT INTO lf_activities (lead_id, kind, body) VALUES ($1::uuid, $2, $3) RETURNING *`,
    [leadId, kind, body],
  );
  return rows[0];
}

function suppressionPath() {
  return path.join(__dirname, '..', '..', 'lead-forge', 'suppression.csv');
}

function appendSuppression({ domain, phone, businessName }) {
  const file = suppressionPath();
  const header = fs.existsSync(file)
    ? fs.readFileSync(file, 'utf8').split('\n')[0]
    : 'domain,phone,business_name';
  if (!fs.existsSync(file)) fs.writeFileSync(file, `${header}\n`, 'utf8');
  const line = [
    domain || '',
    phone || '',
    businessName || '',
  ].map((v) => (String(v).includes(',') ? `"${String(v).replace(/"/g, '""')}"` : String(v))).join(',');
  fs.appendFileSync(file, `${line}\n`, 'utf8');
}

function packCsvPath(packId) {
  return path.join(__dirname, '..', '..', 'lead-forge', 'packs', packId, 'leads.csv');
}

module.exports = {
  appendSuppression,
  getActivitiesForLeads,
  getLead,
  getPack,
  getPackLeads,
  getPool,
  insertActivity,
  listPacks,
  packCsvPath,
  pgConfig,
  suppressionPath,
  updateLead,
};