'use strict';

/**
 * Postgres billing store (production). Talks to the billing_* tables and the
 * atomic SQL functions from
 * supabase/migrations/20261011120000_billing_revenue_streams_module.sql.
 *
 * Connection: BILLING_DATABASE_URL, else the repo-wide PG_HOST/PG_PORT/
 * PG_DATABASE/PG_USER/PG_PASSWORD convention (lib/revenue/RevenueDatabase.ts),
 * which defaults to the local Supabase Postgres on :54322.
 *
 * Identifiers are whitelisted against lib/billing/stores/schema.js; values
 * are always parameterized.
 */

const { types: pgTypes } = require('pg');
const { assertTable, assertIdent } = require('./schema');
const { toSafeInt } = require('../money');

const INT8_OID = 20;

/** int8 → JS number, refusing values outside the safe-integer range. */
const typeOverrides = {
  getTypeParser(oid, format) {
    if (oid === INT8_OID) return (v) => (v === null ? null : toSafeInt(v));
    return pgTypes.getTypeParser(oid, format);
  },
};

function encode(v) {
  if (v === undefined) return null;
  if (v === null || v instanceof Date || Buffer.isBuffer(v)) return v;
  if (Array.isArray(v) || typeof v === 'object') return JSON.stringify(v);
  return v;
}

function buildWhere(where, params) {
  const clauses = [];
  for (const [col, cond] of Object.entries(where || {})) {
    const c = `"${assertIdent(col)}"`;
    if (cond === null) { clauses.push(`${c} IS NULL`); continue; }
    if (typeof cond === 'object' && !(cond instanceof Date)) {
      for (const [op, val] of Object.entries(cond)) {
        if (op === 'in') {
          if (!Array.isArray(val) || val.length === 0) { clauses.push('false'); continue; }
          params.push(val.map(encode));
          clauses.push(`${c} = ANY($${params.length})`);
          continue;
        }
        const sqlOp = { ne: 'IS DISTINCT FROM', gte: '>=', gt: '>', lt: '<', lte: '<=' }[op];
        if (!sqlOp) throw new Error(`unsupported operator: ${op}`);
        params.push(encode(val));
        clauses.push(`${c} ${sqlOp} $${params.length}`);
      }
      continue;
    }
    params.push(encode(cond));
    clauses.push(`${c} = $${params.length}`);
  }
  return clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
}

class PgBillingStore {
  /** @param {{ pool?: any, connectionString?: string }} [opts] */
  constructor(opts = {}) {
    this.kind = 'postgres';
    if (opts.pool) {
      this.pool = opts.pool;
      this.ownsPool = false;
    } else {
      const { Pool } = require('pg');
      const connectionString = opts.connectionString || process.env.BILLING_DATABASE_URL;
      this.pool = new Pool(connectionString
        ? { connectionString, max: 10, types: typeOverrides }
        : {
          host: process.env.PG_HOST || '127.0.0.1',
          port: parseInt(process.env.PG_PORT || '54322', 10),
          database: process.env.PG_DATABASE || 'postgres',
          user: process.env.PG_USER || 'postgres',
          password: process.env.PG_PASSWORD || 'postgres',
          max: 10,
          types: typeOverrides,
        });
      this.ownsPool = true;
    }
  }

  async query(text, params) {
    const res = await this.pool.query({ text, values: params, types: typeOverrides });
    return res.rows;
  }

  async insert(table, row, opts = {}) {
    assertTable(table);
    const cols = Object.keys(row).filter((k) => row[k] !== undefined).map(assertIdent);
    const params = cols.map((c) => encode(row[c]));
    const placeholders = cols.map((_, i) => `$${i + 1}`);
    const conflict = opts.ignoreConflict ? ' ON CONFLICT DO NOTHING' : '';
    const sql = `INSERT INTO public.${table} (${cols.map((c) => `"${c}"`).join(', ')}) VALUES (${placeholders.join(', ')})${conflict} RETURNING *`;
    const rows = await this.query(sql, params);
    return rows[0] || null;
  }

  async update(table, where, patch) {
    assertTable(table);
    const params = [];
    const sets = Object.keys(patch).map((k) => {
      params.push(encode(patch[k]));
      return `"${assertIdent(k)}" = $${params.length}`;
    });
    if (!sets.length) return [];
    const sql = `UPDATE public.${table} SET ${sets.join(', ')}${buildWhere(where, params)} RETURNING *`;
    return this.query(sql, params);
  }

  async findOne(table, where) {
    const rows = await this.findMany(table, where, { limit: 1 });
    return rows[0] || null;
  }

  async findMany(table, where = {}, opts = {}) {
    assertTable(table);
    const params = [];
    let sql = `SELECT * FROM public.${table}${buildWhere(where, params)}`;
    if (opts.orderBy) {
      const [col, dir] = opts.orderBy;
      sql += ` ORDER BY "${assertIdent(col)}" ${dir === 'desc' ? 'DESC' : 'ASC'}`;
    }
    if (opts.limit) {
      params.push(Number(opts.limit));
      sql += ` LIMIT $${params.length}`;
    }
    return this.query(sql, params);
  }

  async reserveUsage({ tenantId, featureKey, units, idempotencyKey, now, ttlSeconds }) {
    const rows = await this.query(
      'SELECT * FROM public.billing_reserve_usage($1, $2, $3, $4, $5, $6)',
      [tenantId, featureKey, units, idempotencyKey, now, ttlSeconds],
    );
    return rows[0];
  }

  async finalizeUsage(usageId, units, now) {
    const rows = await this.query('SELECT public.billing_finalize_usage($1, $2, $3) AS outcome', [usageId, units, now]);
    return rows[0].outcome;
  }

  async releaseUsage(usageId, now) {
    const rows = await this.query('SELECT public.billing_release_usage($1, $2) AS outcome', [usageId, now]);
    return rows[0].outcome;
  }

  async claimWebhookEvent(eventRowId, now, lockSeconds) {
    const rows = await this.query('SELECT public.billing_claim_webhook_event($1, $2, $3) AS claimed', [eventRowId, now, lockSeconds]);
    return rows[0].claimed === true;
  }

  async close() {
    if (this.ownsPool) await this.pool.end();
  }
}

module.exports = { PgBillingStore };
