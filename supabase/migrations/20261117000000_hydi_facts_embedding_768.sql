-- Migrate hydi_facts.embedding from vector(1536) to vector(768).
--
-- Rationale: the configured Ollama model is nomic-embed-text, which emits
-- 768-dimensional vectors. The existing vector(1536) column cannot accept
-- them, so semantic recall has been effectively paused.
--
-- pgvector does not support ALTER COLUMN ... TYPE for a dimension change,
-- so the column and its index are dropped and recreated. ALL existing
-- embeddings are discarded by this migration — hydi_facts rows MUST be
-- re-embedded afterwards via:
--   node scripts/backfill-embeddings.js --apply
-- (local Ollama, $0; requires SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).

DROP INDEX IF EXISTS hydi_facts_embedding_idx;

ALTER TABLE hydi_facts DROP COLUMN IF EXISTS embedding;
ALTER TABLE hydi_facts ADD COLUMN embedding vector(768);

-- HNSW is used instead of ivfflat: it supports incremental inserts, so the
-- index stays valid while backfill-embeddings.js --apply repopulates rows.
-- (ivfflat would need a REINDEX after the backfill anyway.)
CREATE INDEX IF NOT EXISTS hydi_facts_embedding_idx
  ON hydi_facts
  USING hnsw (embedding vector_cosine_ops);
