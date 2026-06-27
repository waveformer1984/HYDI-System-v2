-- HYDI Memory Engine Tables
-- =======================

-- Procedural Workflows (learned patterns)
CREATE TABLE IF NOT EXISTS procedural_workflows (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR NOT NULL,
  description TEXT,

  -- Task definition
  task_type VARCHAR NOT NULL,  -- 'revenue/grant-search', 'business/proposal', etc
  inputs JSONB DEFAULT '{}',
  outputs JSONB DEFAULT '{}',

  -- Execution statistics
  success_count INT DEFAULT 0,
  failure_count INT DEFAULT 0,
  avg_duration_ms FLOAT DEFAULT 0,
  total_executions_ms BIGINT DEFAULT 0,

  -- Confidence scoring
  confidence FLOAT DEFAULT 0.0,  -- 0.0 to 1.0
  last_success TIMESTAMP,
  last_failure TIMESTAMP,

  -- Optimization hints
  optimizations JSONB DEFAULT '[]',
  dependencies JSONB DEFAULT '[]',

  -- Source tracking
  source_agent VARCHAR,
  source_context JSONB DEFAULT '{}',

  -- Permissions
  autonomous_ready BOOLEAN DEFAULT FALSE,
  user_approved BOOLEAN DEFAULT FALSE,
  approval_note TEXT,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Search optimization
  indexed BOOLEAN DEFAULT TRUE
);

CREATE INDEX idx_procedural_confidence ON procedural_workflows(confidence DESC);
CREATE INDEX idx_procedural_task_type ON procedural_workflows(task_type);
CREATE INDEX idx_procedural_autonomous ON procedural_workflows(autonomous_ready) WHERE autonomous_ready = TRUE;

-- Knowledge Documents (docs, code, architecture)
CREATE TABLE IF NOT EXISTS knowledge_documents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title VARCHAR NOT NULL,
  content TEXT NOT NULL,
  content_type VARCHAR,  -- 'code', 'doc', 'architecture', 'decision', 'runbook'

  -- Source
  source_path VARCHAR,
  source_url VARCHAR,

  -- Vector embedding for semantic search (pgvector)
  embedding vector(768),  -- nomic-embed-text dimension

  -- Metadata
  tags TEXT[] DEFAULT '{}',
  author VARCHAR,
  version VARCHAR,

  -- Tracking
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  indexed BOOLEAN DEFAULT TRUE,
  retrieval_count INT DEFAULT 0
);

CREATE INDEX idx_knowledge_type ON knowledge_documents(content_type);
CREATE INDEX idx_knowledge_tags ON knowledge_documents USING GIN (tags);
CREATE INDEX idx_knowledge_embedding ON knowledge_documents USING ivfflat (embedding vector_cosine_ops);

-- Semantic Search Index (chunked documents for better retrieval)
CREATE TABLE IF NOT EXISTS semantic_chunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id UUID REFERENCES knowledge_documents(id) ON DELETE CASCADE,
  chunk_index INT,
  chunk_text TEXT NOT NULL,

  embedding vector(768),

  -- Metadata
  relevance_score FLOAT DEFAULT 0.5,
  retrieval_count INT DEFAULT 0,

  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_chunks_document ON semantic_chunks(document_id);
CREATE INDEX idx_chunks_embedding ON semantic_chunks USING ivfflat (embedding vector_cosine_ops);

-- Short-term Interactions (conversations, task progress)
CREATE TABLE IF NOT EXISTS interactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  type VARCHAR NOT NULL,  -- 'conversation', 'task', 'decision'
  content JSONB,

  -- Context
  user_id VARCHAR,
  agent_id VARCHAR,

  -- Lifetime
  created_at TIMESTAMP DEFAULT NOW(),
  expires_at TIMESTAMP DEFAULT (NOW() + INTERVAL '24 hours'),

  CHECK (expires_at > created_at)
);

CREATE INDEX idx_interactions_type ON interactions(type);
CREATE INDEX idx_interactions_expires ON interactions(expires_at) WHERE expires_at > NOW();

-- Vector search helper function
CREATE OR REPLACE FUNCTION search_documents(
  query_embedding vector(768),
  similarity_threshold FLOAT DEFAULT 0.5,
  match_count INT DEFAULT 10
)
RETURNS TABLE (
  id UUID,
  title VARCHAR,
  content TEXT,
  content_type VARCHAR,
  similarity FLOAT
) AS $$
  SELECT
    kd.id,
    kd.title,
    kd.content,
    kd.content_type,
    1 - (kd.embedding <=> query_embedding) as similarity
  FROM knowledge_documents kd
  WHERE kd.embedding IS NOT NULL
    AND 1 - (kd.embedding <=> query_embedding) > similarity_threshold
  ORDER BY kd.embedding <=> query_embedding
  LIMIT match_count;
$$ LANGUAGE SQL STABLE;

-- Row-level security (optional, but recommended)
ALTER TABLE procedural_workflows ENABLE ROW LEVEL SECURITY;
ALTER TABLE knowledge_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE interactions ENABLE ROW LEVEL SECURITY;

-- Allow all authenticated users to read (system-wide, no privacy boundaries)
CREATE POLICY "procedural_workflows_read" ON procedural_workflows
  FOR SELECT USING (TRUE);

CREATE POLICY "knowledge_documents_read" ON knowledge_documents
  FOR SELECT USING (TRUE);

CREATE POLICY "interactions_read" ON interactions
  FOR SELECT USING (TRUE);

-- Allow service role to write (from memory-engine)
CREATE POLICY "procedural_workflows_write" ON procedural_workflows
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "knowledge_documents_write" ON knowledge_documents
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

CREATE POLICY "interactions_write" ON interactions
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');
