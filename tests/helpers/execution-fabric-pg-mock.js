'use strict';

/**
 * Minimal Supabase-shaped mock for execution_fabric_tasks integration tests.
 */
function createExecutionFabricPgMock() {
  /** @type {Map<string, object>} */
  const rows = new Map();

  function from(table) {
    if (table === 'execution_fabric_observations') {
      return {
        insert: async () => ({ error: null }),
      };
    }
    if (table !== 'execution_fabric_tasks') {
      throw new Error(`unexpected table ${table}`);
    }

    const state = { filters: [], single: false, maybeSingle: false, limitN: null, orderCol: null };

    const builder = {
      insert(row) {
        const payload = Array.isArray(row) ? row[0] : row;
        if (payload.idempotency_key) {
          for (const r of rows.values()) {
            if (r.idempotency_key === payload.idempotency_key && r.idempotency_scope === payload.idempotency_scope) {
              return {
                select: () => ({
                  single: async () => ({ data: null, error: { code: '23505', message: 'duplicate' } }),
                }),
              };
            }
          }
        }
        rows.set(payload.id, { ...payload });
        return {
          select: () => ({
            single: async () => ({ data: rows.get(payload.id), error: null }),
          }),
        };
      },
      select() {
        return builder;
      },
      eq(col, val) {
        state.filters.push({ col, op: 'eq', val });
        return builder;
      },
      in(col, vals) {
        state.filters.push({ col, op: 'in', val: vals });
        return builder;
      },
      lte(col, val) {
        state.filters.push({ col, op: 'lte', val });
        return builder;
      },
      order(col) {
        state.orderCol = col;
        return builder;
      },
      limit(n) {
        state.limitN = n;
        return builder;
      },
      maybeSingle: async () => {
        const match = applyFilters([...rows.values()], state.filters);
        return { data: match[0] || null, error: null };
      },
      single: async () => {
        const match = applyFilters([...rows.values()], state.filters);
        return { data: match[0] || null, error: null };
      },
      update(patch) {
        const chain = {
          eq(col, val) {
            state.filters.push({ col, op: 'eq', val });
            return chain;
          },
          select() {
            return chain;
          },
          maybeSingle: async () => {
            const idFilter = state.filters.find((f) => f.col === 'id');
            const verFilter = state.filters.find((f) => f.col === 'version');
            const row = idFilter ? rows.get(idFilter.val) : null;
            if (!row) return { data: null, error: null };
            if (verFilter && row.version !== verFilter.val) return { data: null, error: null };
            Object.assign(row, patch);
            rows.set(row.id, row);
            return { data: { ...row }, error: null };
          },
        };
        return chain;
      },
    };
    return builder;
  }

  return { from, rows };
}

function applyFilters(list, filters) {
  let out = list;
  for (const f of filters) {
    if (f.op === 'eq') out = out.filter((r) => r[f.col] === f.val);
    if (f.op === 'in') out = out.filter((r) => f.val.includes(r[f.col]));
    if (f.op === 'lte') out = out.filter((r) => r[f.col] && r[f.col] <= f.val);
  }
  if (filters.some((f) => f.col === 'updated_at')) {
    out.sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }
  return out;
}

module.exports = { createExecutionFabricPgMock };
