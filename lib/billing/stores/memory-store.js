'use strict';

/**
 * In-memory billing store. Used by the hermetic unit suite and local demos.
 *
 * It emulates the Postgres schema closely enough that the same acceptance
 * scenarios run against both stores (tests/unit/billing/*): defaults, unique
 * constraints (error code 23505), the published-price immutability trigger,
 * the append-only audit trigger, and the four atomic SQL functions. The
 * atomic functions run to completion without yielding (no `await` inside),
 * which is what makes them atomic in a single-threaded runtime.
 */

const { TABLES, assertTable } = require('./schema');

function clone(v) {
  if (v === null || v === undefined) return v;
  if (v instanceof Date) return new Date(v.getTime());
  if (Array.isArray(v)) return v.map(clone);
  if (typeof v === 'object') {
    const out = {};
    for (const k of Object.keys(v)) out[k] = clone(v[k]);
    return out;
  }
  return v;
}

function cmp(a, b) {
  const va = a instanceof Date ? a.getTime() : a;
  const vb = b instanceof Date ? b.getTime() : b;
  if (va === vb) return 0;
  if (va === null || va === undefined) return -1;
  if (vb === null || vb === undefined) return 1;
  return va < vb ? -1 : 1;
}

function matches(row, where = {}) {
  for (const [col, cond] of Object.entries(where)) {
    const v = row[col];
    if (cond !== null && typeof cond === 'object' && !(cond instanceof Date)) {
      if ('in' in cond && !cond.in.some((x) => cmp(v, x) === 0)) return false;
      if ('ne' in cond && cmp(v, cond.ne) === 0) return false;
      if ('gte' in cond && (v === null || v === undefined || cmp(v, cond.gte) < 0)) return false;
      if ('gt' in cond && (v === null || v === undefined || cmp(v, cond.gt) <= 0)) return false;
      if ('lt' in cond && (v === null || v === undefined || cmp(v, cond.lt) >= 0)) return false;
      if ('lte' in cond && (v === null || v === undefined || cmp(v, cond.lte) > 0)) return false;
    } else if (cond === null) {
      if (v !== null && v !== undefined) return false;
    } else if (cmp(v, cond) !== 0) {
      return false;
    }
  }
  return true;
}

function uniqueViolation(table, cols) {
  const err = new Error(`duplicate key value violates unique constraint on ${table}(${cols.join(', ')})`);
  err.code = '23505';
  return err;
}

const IMMUTABLE_PRICE_COLS = ['currency', 'unit_amount_minor', 'billing_interval', 'interval_count', 'trial_days', 'plan_id', 'version', 'provider_price_id'];

class MemoryBillingStore {
  constructor() {
    this.kind = 'memory';
    this.tables = {};
    for (const t of Object.keys(TABLES)) this.tables[t] = [];
    for (const [stream_key, name] of [
      ['hydi_platform', 'Hydi(ai) platform subscriptions'], ['galactic_bytes', 'Galactic Bytes'],
      ['detailer_bot', 'Detailer Bot'], ['lipi_v2', 'LIPI v2'], ['protogrance_aromatics', 'ProtoGrance Aromatics'],
      ['rezonate', 'Rezonate'], ['waveformer_studio', 'Waveformer Studio'],
    ]) this.tables.billing_revenue_streams.push({ stream_key, name, status: 'active', created_at: new Date() });
  }

  _checkUnique(table, row, ignoreRow) {
    const spec = TABLES[table];
    const keys = [[spec.pk], ...spec.unique];
    for (const cols of keys) {
      // Postgres semantics: a NULL in any unique column never conflicts.
      if (cols.some((c) => row[c] === null || row[c] === undefined)) continue;
      const clash = this.tables[table].find((r) => r !== ignoreRow && cols.every((c) => cmp(r[c], row[c]) === 0));
      if (clash) return cols;
    }
    return null;
  }

  async insert(table, row, opts = {}) {
    const spec = assertTable(table);
    const full = {};
    for (const [col, fn] of Object.entries(spec.defaults)) full[col] = fn();
    for (const [k, v] of Object.entries(row)) if (v !== undefined) full[k] = clone(v);
    const clash = this._checkUnique(table, full, null);
    if (clash) {
      if (opts.ignoreConflict) return null;
      throw uniqueViolation(table, clash);
    }
    if (table === 'billing_revenue_streams' || table === 'billing_products') {
      // FK emulation for the one reference tests exercise directly.
      if (table === 'billing_products' && !this.tables.billing_revenue_streams.some((s) => s.stream_key === full.revenue_stream)) {
        const err = new Error('insert violates foreign key constraint on revenue_stream');
        err.code = '23503';
        throw err;
      }
    }
    this.tables[table].push(full);
    return clone(full);
  }

  async update(table, where, patch) {
    assertTable(table);
    if (table === 'billing_audit_events') {
      const err = new Error('billing_audit_events is append-only');
      err.code = '42501';
      throw err;
    }
    const rows = this.tables[table].filter((r) => matches(r, where));
    for (const r of rows) {
      const next = { ...r, ...clone(patch) };
      if (table === 'billing_price_versions' && r.status !== 'draft') {
        if (IMMUTABLE_PRICE_COLS.some((c) => c in patch && cmp(next[c], r[c]) !== 0) || next.status === 'draft') {
          const err = new Error(`billing_price_versions: published price version ${r.price_version_id} is immutable; create a new version`);
          err.code = '23514';
          throw err;
        }
      }
      const clash = this._checkUnique(table, next, r);
      if (clash) throw uniqueViolation(table, clash);
    }
    for (const r of rows) Object.assign(r, clone(patch));
    return rows.map(clone);
  }

  async findOne(table, where) {
    assertTable(table);
    const row = this.tables[table].find((r) => matches(r, where));
    return row ? clone(row) : null;
  }

  async findMany(table, where = {}, opts = {}) {
    assertTable(table);
    let rows = this.tables[table].filter((r) => matches(r, where));
    if (opts.orderBy) {
      const [col, dir] = opts.orderBy;
      rows = rows.slice().sort((a, b) => (dir === 'desc' ? -cmp(a[col], b[col]) : cmp(a[col], b[col])));
    }
    if (opts.limit) rows = rows.slice(0, opts.limit);
    return rows.map(clone);
  }

  // ---- atomic operations (mirror the SQL functions exactly) -------------

  async reserveUsage({ tenantId, featureKey, units, idempotencyKey, now, ttlSeconds }) {
    if (!Number.isSafeInteger(units) || units <= 0) throw new Error('units must be positive');
    const ents = this.tables.billing_entitlements
      .filter((e) => e.tenant_id === tenantId && e.feature_key === featureKey && e.status === 'active'
        && e.access_until && e.access_until.getTime() > now.getTime())
      .sort((a, b) => {
        if (a.limit_units === null) return -1;
        if (b.limit_units === null) return 1;
        return b.limit_units - a.limit_units;
      });
    const ent = ents[0] || null;
    const row = this.tables.billing_usage_events.find((u) => u.tenant_id === tenantId && u.idempotency_key === idempotencyKey) || null;

    if (row && row.status !== 'released' && !(row.status === 'reserved' && row.expires_at.getTime() <= now.getTime())) {
      return { outcome: 'duplicate', usage_id: row.usage_id, usage_status: row.status, limit_units: ent ? ent.limit_units : null, used_units: null };
    }
    if (!ent) return { outcome: 'not_entitled', usage_id: row ? row.usage_id : null, usage_status: row ? row.status : null, limit_units: null, used_units: null };

    const used = this.tables.billing_usage_events
      .filter((u) => u.entitlement_id === ent.entitlement_id && u.period_start.getTime() === ent.period_start.getTime()
        && (u.status === 'committed' || (u.status === 'reserved' && u.expires_at.getTime() > now.getTime())))
      .reduce((s, u) => s + (u.status === 'committed' ? u.units_committed : u.units_reserved), 0);

    if (ent.limit_units !== null && used + units > ent.limit_units) {
      return { outcome: 'quota_exceeded', usage_id: row ? row.usage_id : null, usage_status: row ? row.status : null, limit_units: ent.limit_units, used_units: used };
    }
    const expires = new Date(now.getTime() + ttlSeconds * 1000);
    if (row) {
      Object.assign(row, {
        status: 'reserved', units_reserved: units, units_committed: 0, entitlement_id: ent.entitlement_id,
        period_start: ent.period_start, reserved_at: now, expires_at: expires, finalized_at: null, attempts: row.attempts + 1,
      });
      return { outcome: 'reserved', usage_id: row.usage_id, usage_status: 'reserved', limit_units: ent.limit_units, used_units: used + units };
    }
    const spec = TABLES.billing_usage_events;
    const created = {
      usage_id: spec.defaults.usage_id(), tenant_id: tenantId, entitlement_id: ent.entitlement_id, feature_key: featureKey,
      idempotency_key: idempotencyKey, units_reserved: units, units_committed: 0, status: 'reserved',
      period_start: ent.period_start, reserved_at: now, expires_at: expires, finalized_at: null, attempts: 1,
    };
    this.tables.billing_usage_events.push(created);
    return { outcome: 'reserved', usage_id: created.usage_id, usage_status: 'reserved', limit_units: ent.limit_units, used_units: used + units };
  }

  async finalizeUsage(usageId, units, now) {
    const row = this.tables.billing_usage_events.find((u) => u.usage_id === usageId);
    if (!row) return 'not_found';
    if (row.status === 'committed') return 'duplicate';
    if (row.status === 'released') return 'released';
    const actual = units === null || units === undefined ? row.units_reserved : units;
    Object.assign(row, { status: 'committed', units_committed: Math.min(Math.max(actual, 0), row.units_reserved), finalized_at: now });
    return 'committed';
  }

  async releaseUsage(usageId, now) {
    const row = this.tables.billing_usage_events.find((u) => u.usage_id === usageId);
    if (!row) return 'not_found';
    if (row.status === 'committed') return 'committed';
    if (row.status === 'released') return 'duplicate';
    Object.assign(row, { status: 'released', units_committed: 0, finalized_at: now });
    return 'released';
  }

  async claimWebhookEvent(eventRowId, now, lockSeconds) {
    const row = this.tables.billing_webhook_events.find((e) => e.event_row_id === eventRowId);
    if (!row) return false;
    const claimable = row.status === 'received' || row.status === 'failed'
      || (row.status === 'processing' && row.locked_until && row.locked_until.getTime() < now.getTime());
    if (!claimable) return false;
    Object.assign(row, { status: 'processing', attempts: row.attempts + 1, locked_until: new Date(now.getTime() + lockSeconds * 1000) });
    return true;
  }

  async close() {}
}

module.exports = { MemoryBillingStore };
