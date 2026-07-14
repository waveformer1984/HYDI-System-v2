-- Fix retrieve_similar_facts() volatility.
--
-- 20260626120000_pgvector_semantic_retrieval.sql declared this function
-- IMMUTABLE, but it queries hydi_facts -- a table whose contents change as
-- facts are added/updated. IMMUTABLE tells the planner the result depends
-- only on the arguments and can be constant-folded/cached across calls,
-- which risks returning stale matches once the table changes after the
-- first call. STABLE (same as the sibling search_documents() and
-- match_procedural_lessons() functions already in this codebase) is the
-- correct declaration for a read-only function whose result can change
-- between calls in the same statement as the underlying data changes.

CREATE OR REPLACE FUNCTION retrieve_similar_facts(
  query_embedding vector,
  similarity_threshold float DEFAULT 0.6,
  limit_results int DEFAULT 5
)
RETURNS TABLE (
  id uuid,
  content text,
  confidence float,
  division text,
  similarity float
) AS $$
BEGIN
  RETURN QUERY
  SELECT
    hydi_facts.id,
    hydi_facts.content,
    hydi_facts.confidence,
    hydi_facts.division,
    (1 - (hydi_facts.embedding <=> query_embedding))::float AS similarity
  FROM hydi_facts
  WHERE hydi_facts.embedding IS NOT NULL
    AND (1 - (hydi_facts.embedding <=> query_embedding)) > similarity_threshold
  ORDER BY similarity DESC, confidence DESC
  LIMIT limit_results;
END;
$$ LANGUAGE plpgsql STABLE;

GRANT EXECUTE ON FUNCTION retrieve_similar_facts TO anon, authenticated, service_role;
