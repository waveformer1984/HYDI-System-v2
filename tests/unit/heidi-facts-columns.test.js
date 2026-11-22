'use strict';

// hydi_facts has no `source` column — a write path that includes it fails the
// whole upsert with "Could not find the 'source' column of 'hydi_facts' in the
// schema cache" (seen in heidi-core logs). This test pins the insert payload
// to the real column set so the regression cannot return.
//
// No module mock: heidi-core has a nested node_modules on some machines and
// not others, so the supabase-js specifier resolves differently per machine.
// Instead we inject a fake client on the instance (server.js now prefers
// this.supabase over the module-level client in extractAndStoreFacts).

const HeidiCore = require('../../heidi-core/server.js');

// Columns that actually exist on hydi_facts (see
// supabase/migrations/20260626120000_pgvector_semantic_retrieval.sql and later
// feedback-loop migrations).
const REAL_COLUMNS = new Set([
  'id', 'content', 'confidence', 'division', 'content_key',
  'embedding', 'created_at', 'updated_at', 'updates_count', 'last_feedback_at',
]);

test('extractAndStoreFacts upserts only real hydi_facts columns', async () => {
  const upserts = [];
  const heidi = Object.create(HeidiCore.prototype);
  heidi.supabase = {
    from: (table) => ({
      upsert: (rows, opts) => {
        upserts.push({ table, rows, opts });
        return Promise.resolve({ data: rows, error: null });
      },
    }),
  };
  heidi.generateEmbedding = async () => [0.1, 0.2, 0.3];
  heidi.memory = { storeFactWithEmbedding: async () => {} };

  await heidi.extractAndStoreFacts(
    'budget: $5000 for the Rezonate launch',
    'Approved — the budget is granted.'
  );

  const factUpserts = upserts.filter((u) => u.table === 'hydi_facts');
  expect(factUpserts.length).toBeGreaterThan(0);

  for (const upsert of factUpserts) {
    for (const row of upsert.rows) {
      for (const key of Object.keys(row)) {
        expect(REAL_COLUMNS.has(key)).toBe(true);
      }
      expect(row).not.toHaveProperty('source');
    }
  }
});
