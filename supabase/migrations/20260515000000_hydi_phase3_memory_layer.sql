-- HYDI Phase 3.0: Metacontextual Memory Layer
-- Three-tier memory: Hot (Redis) -> Warm (pgvector) -> Cold (graph)
-- This migration covers the Warm and Cold tiers stored in Postgres.

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ============================================================
-- WARM TIER: memory_entities
-- Semantic memories with pgvector embeddings for cosine search
-- ============================================================
CREATE TABLE IF NOT EXISTS memory_entities (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID        REFERENCES auth.users(id) ON DELETE CASCADE,
  session_id    TEXT,
  scope         TEXT        NOT NULL CHECK (scope IN ('user', 'project', 'task', 'preference', 'business_rule')),
  content       TEXT        NOT NULL,
  summary       TEXT,
  embedding     VECTOR(1536),
  access_count  INT         NOT NULL DEFAULT 0,
  last_accessed TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at    TIMESTAMPTZ
);

-- ANN index: ivfflat with 100 lists for sub-ms retrieval at scale
CREATE INDEX IF NOT EXISTS memory_entities_embedding_idx
  ON memory_entities
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- Composite index for tenant-scoped lookups
CREATE INDEX IF NOT EXISTS memory_entities_user_scope_idx
  ON memory_entities (user_id, scope);

-- ============================================================
-- COLD TIER: memory_relations
-- Typed weighted graph edges connecting entities
-- ============================================================
CREATE TABLE IF NOT EXISTS memory_relations (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  from_entity  UUID        NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
  to_entity    UUID        NOT NULL REFERENCES memory_entities(id) ON DELETE CASCADE,
  relation_type TEXT       NOT NULL,
  weight       NUMERIC     NOT NULL DEFAULT 1.0 CHECK (weight >= 0 AND weight <= 10.0),
  metadata     JSONB       NOT NULL DEFAULT '{}',
  last_updated TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT no_self_loop CHECK (from_entity <> to_entity)
);

CREATE INDEX IF NOT EXISTS memory_relations_from_idx ON memory_relations (from_entity);
CREATE INDEX IF NOT EXISTS memory_relations_to_idx   ON memory_relations (to_entity);
CREATE INDEX IF NOT EXISTS memory_relations_type_idx ON memory_relations (relation_type);

-- ============================================================
-- ROW LEVEL SECURITY
-- ============================================================
ALTER TABLE memory_entities  ENABLE ROW LEVEL SECURITY;
ALTER TABLE memory_relations ENABLE ROW LEVEL SECURITY;

-- memory_entities: service role has full access; users own their rows
CREATE POLICY "service_role_full_access_memory_entities"
  ON memory_entities FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "users_own_memory_entities"
  ON memory_entities FOR ALL
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- memory_relations: service role has full access; users see relations for entities they own
CREATE POLICY "service_role_full_access_memory_relations"
  ON memory_relations FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "users_own_memory_relations"
  ON memory_relations FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM memory_entities me
      WHERE me.id = from_entity AND me.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM memory_entities me
      WHERE me.id = from_entity AND me.user_id = auth.uid()
    )
  );

-- ============================================================
-- RPC: get_hydi_context
-- Cosine-similarity semantic search returning top-K context
-- Increments access_count and updates last_accessed on retrieval
-- ============================================================
CREATE OR REPLACE FUNCTION get_hydi_context(
  p_user_id       UUID,
  p_query_embedding VECTOR(1536),
  p_scope         TEXT    DEFAULT NULL,
  p_top_k         INT     DEFAULT 5,
  p_min_similarity FLOAT  DEFAULT 0.70
)
RETURNS TABLE (
  id          UUID,
  summary     TEXT,
  content     TEXT,
  scope       TEXT,
  similarity  FLOAT,
  access_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  WITH ranked AS (
    SELECT
      me.id,
      me.summary,
      me.content,
      me.scope,
      1 - (me.embedding <=> p_query_embedding) AS similarity,
      me.access_count
    FROM memory_entities me
    WHERE
      me.user_id = p_user_id
      AND me.embedding IS NOT NULL
      AND (p_scope IS NULL OR me.scope = p_scope)
      AND (me.expires_at IS NULL OR me.expires_at > now())
      AND 1 - (me.embedding <=> p_query_embedding) >= p_min_similarity
    ORDER BY me.embedding <=> p_query_embedding
    LIMIT p_top_k
  )
  SELECT r.id, r.summary, r.content, r.scope, r.similarity, r.access_count
  FROM ranked r;

  -- Update access telemetry for retrieved entities
  UPDATE memory_entities
  SET
    access_count  = access_count + 1,
    last_accessed = now()
  WHERE id IN (
    SELECT me.id
    FROM memory_entities me
    WHERE
      me.user_id = p_user_id
      AND me.embedding IS NOT NULL
      AND (p_scope IS NULL OR me.scope = p_scope)
      AND (me.expires_at IS NULL OR me.expires_at > now())
      AND 1 - (me.embedding <=> p_query_embedding) >= p_min_similarity
    ORDER BY me.embedding <=> p_query_embedding
    LIMIT p_top_k
  );
END;
$$;

-- Grant execute to authenticated role via service role intermediary
GRANT EXECUTE ON FUNCTION get_hydi_context(UUID, VECTOR(1536), TEXT, INT, FLOAT) TO service_role;

-- ============================================================
-- HELPER: expire_stale_memories
-- pg_cron job target: runs nightly, soft-deletes expired entities
-- ============================================================
CREATE OR REPLACE FUNCTION expire_stale_memories()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM memory_entities
  WHERE expires_at IS NOT NULL AND expires_at <= now()
  RETURNING id INTO deleted_count;

  -- Return count of expired rows cleaned up
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

GRANT EXECUTE ON FUNCTION expire_stale_memories() TO service_role;

-- ============================================================
-- COMMENT: document tables for Supabase Studio / pg_dump
-- ============================================================
COMMENT ON TABLE memory_entities IS
  'HYDI Phase 3.0 – Warm-tier semantic memory. Each row is a contextual fragment with a 1536-dim pgvector embedding for cosine retrieval via get_hydi_context().';

COMMENT ON TABLE memory_relations IS
  'HYDI Phase 3.0 – Cold-tier graph edges between memory_entities. Typed + weighted for traversal-based context reconstruction.';

COMMENT ON FUNCTION get_hydi_context IS
  'Top-K cosine-similarity semantic search over memory_entities. Increments access_count on every hit for LRU-style eviction scoring.';
