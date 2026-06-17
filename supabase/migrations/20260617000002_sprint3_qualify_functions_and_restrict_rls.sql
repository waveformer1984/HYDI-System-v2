-- Sprint 3: qualify table names in 4 deferred SECURITY DEFINER functions and
-- restrict blanket RLS policies on internal heidi-memory tables.
--
-- Context: Sprint 1 (20260617000001) patched 17 functions with ALTER FUNCTION.
-- Four functions were deferred because they used unqualified table names that
-- would stop resolving if search_path were emptied. This migration rewrites
-- those bodies to use schema-qualified names, then pins the search_path.
--
-- The heidi-memory RLS fix removes six policies that lacked a TO role clause,
-- which caused them to apply to the anonymous role as well.

-- ════════════════════════════════════════════════════════════════════════════
-- PART 1: SECURITY DEFINER functions — pin search_path
-- ════════════════════════════════════════════════════════════════════════════

-- 1a. keeper_auto_escalate already uses public.<table> throughout;
--     tighten from (public, extensions) to a fully explicit list.
ALTER FUNCTION public.keeper_auto_escalate()
  SET search_path = 'public', 'extensions', 'pg_catalog';

-- 1b. calibrate_protoforge_decisions already uses public.<table> throughout.
ALTER FUNCTION public.calibrate_protoforge_decisions(INT, INT)
  SET search_path = 'public', 'extensions', 'pg_catalog';

-- 1c. get_hydi_context — replace unqualified `memory_entities` with
--     `public.memory_entities` throughout the body, then pin search_path.
CREATE OR REPLACE FUNCTION public.get_hydi_context(
  p_user_id         UUID,
  p_query_embedding VECTOR(1536),
  p_scope           TEXT  DEFAULT NULL,
  p_top_k           INT   DEFAULT 5,
  p_min_similarity  FLOAT DEFAULT 0.70
)
RETURNS TABLE (
  id           UUID,
  summary      TEXT,
  content      TEXT,
  scope        TEXT,
  similarity   FLOAT,
  access_count INT
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions', 'pg_catalog'
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
    FROM public.memory_entities me
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

  UPDATE public.memory_entities
  SET
    access_count  = access_count + 1,
    last_accessed = now()
  WHERE id IN (
    SELECT me.id
    FROM public.memory_entities me
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

-- 1d. expire_stale_memories — replace unqualified `memory_entities` with
--     `public.memory_entities`, fix the unreachable RETURNING clause.
CREATE OR REPLACE FUNCTION public.expire_stale_memories()
RETURNS INT
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public', 'extensions', 'pg_catalog'
AS $$
DECLARE
  deleted_count INT;
BEGIN
  DELETE FROM public.memory_entities
  WHERE expires_at IS NOT NULL AND expires_at <= now();

  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- PART 2: Restrict permissive RLS policies on heidi-memory internal tables
-- ════════════════════════════════════════════════════════════════════════════
-- Six policies created by 20260429150000_heidi_memory_layer.sql omitted the
-- TO role clause, making them apply to the anonymous role as well as
-- authenticated users. Drop and replace with scoped policies.

DROP POLICY IF EXISTS "Allow all operations on theme_predictions" ON public.theme_predictions;
DROP POLICY IF EXISTS "Allow all operations on theme_outcomes" ON public.theme_outcomes;
DROP POLICY IF EXISTS "Allow all operations on theme_accuracy" ON public.theme_accuracy;
DROP POLICY IF EXISTS "Allow all operations on overconfidence_events" ON public.overconfidence_events;
DROP POLICY IF EXISTS "Allow all operations on heidi_reflections" ON public.heidi_reflections;
DROP POLICY IF EXISTS "Allow all operations on system_misalignment_events" ON public.system_misalignment_events;

-- Also fix infrastructure_health: policy name suggested service_role intent
-- but TO clause was missing, exposing the table to all roles.
DROP POLICY IF EXISTS "service_role_write" ON public.infrastructure_health;

-- Recreate with explicit TO clauses.
CREATE POLICY theme_predictions_service_role_all
  ON public.theme_predictions FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY theme_predictions_authenticated_read
  ON public.theme_predictions FOR SELECT TO authenticated USING (true);

CREATE POLICY theme_outcomes_service_role_all
  ON public.theme_outcomes FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY theme_outcomes_authenticated_read
  ON public.theme_outcomes FOR SELECT TO authenticated USING (true);

CREATE POLICY theme_accuracy_service_role_all
  ON public.theme_accuracy FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY theme_accuracy_authenticated_read
  ON public.theme_accuracy FOR SELECT TO authenticated USING (true);

CREATE POLICY overconfidence_events_service_role_all
  ON public.overconfidence_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY overconfidence_events_authenticated_read
  ON public.overconfidence_events FOR SELECT TO authenticated USING (true);

CREATE POLICY heidi_reflections_service_role_all
  ON public.heidi_reflections FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY heidi_reflections_authenticated_read
  ON public.heidi_reflections FOR SELECT TO authenticated USING (true);

CREATE POLICY system_misalignment_events_service_role_all
  ON public.system_misalignment_events FOR ALL TO service_role USING (true) WITH CHECK (true);
CREATE POLICY system_misalignment_events_authenticated_read
  ON public.system_misalignment_events FOR SELECT TO authenticated USING (true);

CREATE POLICY infrastructure_health_service_role_write
  ON public.infrastructure_health
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
