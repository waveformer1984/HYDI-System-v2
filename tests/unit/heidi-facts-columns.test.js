'use strict';

// hydi_facts has no `source` column — a write path that includes it fails the
// whole upsert with "Could not find the 'source' column of 'hydi_facts' in the
// schema cache" (seen in heidi-core logs). This test pins the insert payload
// to the real column set so the regression cannot return.

process.env.SUPABASE_URL = process.env.SUPABASE_URL || 'http://localhost:54321';
process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || 'test-key';

const mockUpserts = [];
// heidi-core has its own nested node_modules, so server.js resolves a
// different @supabase/supabase-js copy than the repo root — mock that path.
jest.mock('../../heidi-core/node_modules/@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table) => ({
      upsert: (rows, opts) => {
        mockUpserts.push({ table, rows, opts });
        return Promise.resolve({ data: rows, error: null });
      },
      select: () => ({
        eq: () => ({ single: async () => ({ data: null, error: null }) }),
      }),
    }),
    rpc: async () => ({ data: [], error: null }),
  }),
}));

const HeidiCore = require('../../heidi-core/server.js');

// Columns that actually exist on hydi_facts (see
// supabase/migrations/20260626120000_pgvector_semantic_retrieval.sql and later
// feedback-loop migrations).
const REAL_COLUMNS = new Set([
  'id', 'content', 'confidence', 'division', 'content_key',
  'embedding', 'created_at', 'updated_at', 'updates_count', 'last_feedback_at',
]);

test('extractAndStoreFacts upserts only real hydi_facts columns', async () => {
  const heidi = new HeidiCore({ brain: {} });
  heidi.generateEmbedding = async () => [0.1, 0.2, 0.3];
  heidi.memory = { storeFactWithEmbedding: async () => {} };

  await heidi.extractAndStoreFacts(
    'budget: $5000 for the Rezonate launch',
    'Approved — the budget is granted.'
  );

  const factUpserts = mockUpserts.filter((u) => u.table === 'hydi_facts');
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
