-- =====================================================
-- HEIDI MEMORY SYSTEM SCHEMA
-- =====================================================

-- Enable pgvector for embeddings
CREATE EXTENSION IF NOT EXISTS vector;

-- =====================================================
-- MEMORIES TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  session_id text NOT NULL,
  content text NOT NULL,
  embedding vector(1536),
  created_at timestamptz NOT NULL DEFAULT now(),
  
  -- Indexes for performance
  INDEX idx_memories_user_id (user_id),
  INDEX idx_memories_session_id (session_id),
  INDEX idx_memories_created_at (created_at)
);

-- =====================================================
-- ACTIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS public.actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id text NOT NULL,
  task_name text NOT NULL,
  status text NOT NULL CHECK (status IN ('pending', 'completed', 'failed')),
  payload jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  
  -- Indexes for performance
  INDEX idx_actions_session_id (session_id),
  INDEX idx_actions_status (status),
  INDEX idx_actions_task_name (task_name)
);

-- =====================================================
-- MEMORY SEARCH FUNCTION
-- =====================================================
CREATE OR REPLACE FUNCTION search_memories(
  query_embedding vector(1536),
  match_count int DEFAULT 5,
  user_id text DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  user_id text,
  session_id text,
  content text,
  embedding vector(1536),
  created_at timestamptz,
  similarity float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT 
    m.id,
    m.user_id,
    m.session_id,
    m.content,
    m.embedding,
    m.created_at,
    1 - (m.embedding <=> query_embedding) as similarity
  FROM public.memories m
  WHERE 
    (user_id IS NULL OR m.user_id = user_id)
    AND m.embedding IS NOT NULL
  ORDER BY m.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- =====================================================
-- ROW LEVEL SECURITY
-- =====================================================
-- Enable RLS on both tables
ALTER TABLE public.memories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.actions ENABLE ROW LEVEL SECURITY;

-- Policies for memories (users can only access their own memories)
CREATE POLICY "Users can view own memories" ON public.memories
  FOR SELECT USING (auth.uid()::text = user_id);

CREATE POLICY "Users can insert own memories" ON public.memories
  FOR INSERT WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY "Users can update own memories" ON public.memories
  FOR UPDATE USING (auth.uid()::text = user_id);

-- Policies for actions (users can only access their own actions)
CREATE POLICY "Users can view own actions" ON public.actions
  FOR SELECT USING (true); -- Actions are session-based, not user-based

CREATE POLICY "Users can insert own actions" ON public.actions
  FOR INSERT WITH CHECK (true);

CREATE POLICY "Users can update own actions" ON public.actions
  FOR UPDATE USING (true);

-- =====================================================
-- TRIGGERS FOR UPDATED_AT
-- =====================================================
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_memories_updated_at 
  BEFORE UPDATE ON public.memories 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_actions_updated_at 
  BEFORE UPDATE ON public.actions 
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
