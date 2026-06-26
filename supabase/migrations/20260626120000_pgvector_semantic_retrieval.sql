-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- Create hydi_facts table if it doesn't exist
CREATE TABLE IF NOT EXISTS hydi_facts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  content TEXT NOT NULL,
  confidence FLOAT DEFAULT 0.5,
  division TEXT,
  content_key TEXT UNIQUE,
  embedding vector(1536),
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- Ensure embedding column exists
ALTER TABLE hydi_facts ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create index on embedding for fast cosine similarity search
CREATE INDEX IF NOT EXISTS hydi_facts_embedding_idx
  ON hydi_facts
  USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 100);

-- RPC function for semantic similarity search
-- Returns facts ordered by cosine similarity to the query embedding
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
$$ LANGUAGE plpgsql IMMUTABLE;

-- Grant execute permission on the RPC function
GRANT EXECUTE ON FUNCTION retrieve_similar_facts TO anon, authenticated, service_role;
