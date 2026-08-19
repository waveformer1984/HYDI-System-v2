-- HEIDI Cognitive Core Schema
--
-- Creates tables for:
--   1. heidi_identity — persistent system identity (singleton)
--   2. heidi_goals — hierarchical goals (MISSION→OBJECTIVE→PROJECT→TASK→SUBTASK→ACTION)
--   3. heidi_world_model — persistent machine-readable ProtoForge representation
--   4. heidi_trust_classifications — input trust classification records
--   5. heidi_protected_assets — protected assets registry
--
-- Principles:
--   - identity ≠ permission ≠ policy ≠ execution
--   - all state is persistent and restart-safe
--   - RLS enabled on all tables
--   - audit trail for all changes

-- ─── heidi_identity (singleton) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS heidi_identity (
  id integer PRIMARY KEY DEFAULT 1,
  system_name text NOT NULL DEFAULT 'HEIDI',
  version text NOT NULL DEFAULT '2.0',
  role text NOT NULL DEFAULT 'autonomous_intelligence',
  description text,
  autonomy_level integer NOT NULL DEFAULT 2 CHECK (autonomy_level BETWEEN 0 AND 5),
  capabilities jsonb NOT NULL DEFAULT '[]'::jsonb,
  permissions jsonb NOT NULL DEFAULT '[]'::jsonb,
  operating_policies jsonb NOT NULL DEFAULT '{}'::jsonb,
  trusted_entities jsonb NOT NULL DEFAULT '[]'::jsonb,
  protected_assets jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_mission text,
  active_goals jsonb NOT NULL DEFAULT '[]'::jsonb,
  current_environment jsonb NOT NULL DEFAULT '{}'::jsonb,
  persistent_state jsonb NOT NULL DEFAULT '{}'::jsonb,
  identity_checksum text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT heidi_identity_singleton CHECK (id = 1)
);

ALTER TABLE heidi_identity ENABLE ROW LEVEL SECURITY;

CREATE POLICY "heidi_identity_service_all"
  ON heidi_identity FOR ALL USING (true) WITH CHECK (true);

INSERT INTO heidi_identity (id, system_name, version, role, description)
VALUES (1, 'HEIDI', '2.0', 'autonomous_intelligence',
  'Persistent autonomous intelligence, digital guardian, and executive operator for ProtoForge')
ON CONFLICT (id) DO NOTHING;

-- ─── heidi_goals (hierarchical) ───────────────────────────────────────

CREATE TABLE IF NOT EXISTS heidi_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_id uuid REFERENCES heidi_goals(id) ON DELETE CASCADE,
  goal_type text NOT NULL CHECK (goal_type IN ('mission', 'objective', 'project', 'task', 'subtask', 'action')),
  title text NOT NULL,
  description text,
  purpose text,
  priority integer NOT NULL DEFAULT 5 CHECK (priority BETWEEN 1 AND 10),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'in_progress', 'blocked', 'completed', 'cancelled', 'failed', 'escalated')),
  constraints jsonb NOT NULL DEFAULT '[]'::jsonb,
  dependencies jsonb NOT NULL DEFAULT '[]'::jsonb,
  success_criteria jsonb NOT NULL DEFAULT '[]'::jsonb,
  owner text NOT NULL DEFAULT 'heidi',
  deadline timestamptz,
  progress numeric NOT NULL DEFAULT 0.0 CHECK (progress BETWEEN 0.0 AND 1.0),
  confidence numeric NOT NULL DEFAULT 0.5 CHECK (confidence BETWEEN 0.0 AND 1.0),
  evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  assigned_agent text,
  context jsonb NOT NULL DEFAULT '{}'::jsonb,
  result text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

ALTER TABLE heidi_goals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "heidi_goals_service_all"
  ON heidi_goals FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_heidi_goals_parent_id
  ON heidi_goals(parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_heidi_goals_goal_type
  ON heidi_goals(goal_type);
CREATE INDEX IF NOT EXISTS idx_heidi_goals_status
  ON heidi_goals(status);
CREATE INDEX IF NOT EXISTS idx_heidi_goals_priority
  ON heidi_goals(priority DESC);
CREATE INDEX IF NOT EXISTS idx_heidi_goals_owner
  ON heidi_goals(owner);
CREATE INDEX IF NOT EXISTS idx_heidi_goals_deadline
  ON heidi_goals(deadline) WHERE deadline IS NOT NULL;

-- ─── heidi_world_model ────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS heidi_world_model (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN (
    'system', 'service', 'process', 'repository', 'database', 'customer',
    'project', 'revenue_stream', 'infrastructure', 'credential', 'tool',
    'dependency', 'incident', 'goal', 'risk', 'relationship', 'ownership',
    'authority', 'environment'
  )),
  entity_id text NOT NULL,
  entity_name text NOT NULL,
  entity_category text,
  status text NOT NULL DEFAULT 'unknown' CHECK (status IN ('healthy', 'degraded', 'failed', 'unknown', 'active', 'inactive', 'deprecated')),
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  relationships jsonb NOT NULL DEFAULT '[]'::jsonb,
  owner text,
  health_endpoint text,
  last_observed_at timestamptz,
  observation_confidence numeric CHECK (observation_confidence BETWEEN 0.0 AND 1.0),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(entity_type, entity_id)
);

ALTER TABLE heidi_world_model ENABLE ROW LEVEL SECURITY;

CREATE POLICY "heidi_world_model_service_all"
  ON heidi_world_model FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_heidi_world_model_entity_type
  ON heidi_world_model(entity_type);
CREATE INDEX IF NOT EXISTS idx_heidi_world_model_entity_id
  ON heidi_world_model(entity_id);
CREATE INDEX IF NOT EXISTS idx_heidi_world_model_status
  ON heidi_world_model(status);
CREATE INDEX IF NOT EXISTS idx_heidi_world_model_entity_category
  ON heidi_world_model(entity_category) WHERE entity_category IS NOT NULL;

-- ─── heidi_trust_classifications ──────────────────────────────────────

CREATE TABLE IF NOT EXISTS heidi_trust_classifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  input_source text NOT NULL,
  input_type text NOT NULL CHECK (input_type IN ('human_message', 'system_event', 'service_call', 'customer_message', 'unknown_user', 'external_content', 'api_response', 'file', 'url', 'webhook')),
  trust_level text NOT NULL CHECK (trust_level IN ('trusted_human', 'trusted_system', 'authorized_service', 'known_customer', 'unknown_user', 'external_content', 'untrusted_input', 'malicious_input')),
  actor_id text,
  content_hash text,
  classification_reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE heidi_trust_classifications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "heidi_trust_classifications_service_all"
  ON heidi_trust_classifications FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_heidi_trust_input_source
  ON heidi_trust_classifications(input_source);
CREATE INDEX IF NOT EXISTS idx_heidi_trust_trust_level
  ON heidi_trust_classifications(trust_level);
CREATE INDEX IF NOT EXISTS idx_heidi_trust_created_at
  ON heidi_trust_classifications(created_at);

-- ─── heidi_protected_assets ───────────────────────────────────────────

CREATE TABLE IF NOT EXISTS heidi_protected_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  asset_category text NOT NULL CHECK (asset_category IN ('human', 'protoforge', 'hydi')),
  asset_type text NOT NULL,
  asset_name text NOT NULL,
  description text,
  protection_level text NOT NULL DEFAULT 'standard' CHECK (protection_level IN ('standard', 'elevated', 'critical')),
  access_policy jsonb NOT NULL DEFAULT '{}'::jsonb,
  monitoring_enabled boolean NOT NULL DEFAULT true,
  alert_on_access boolean NOT NULL DEFAULT false,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(asset_category, asset_type, asset_name)
);

ALTER TABLE heidi_protected_assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "heidi_protected_assets_service_all"
  ON heidi_protected_assets FOR ALL USING (true) WITH CHECK (true);

CREATE INDEX IF NOT EXISTS idx_heidi_protected_assets_category
  ON heidi_protected_assets(asset_category);
CREATE INDEX IF NOT EXISTS idx_heidi_protected_assets_protection_level
  ON heidi_protected_assets(protection_level);

-- ─── Grants ───────────────────────────────────────────────────────────

GRANT ALL ON heidi_identity, heidi_goals, heidi_world_model,
  heidi_trust_classifications, heidi_protected_assets
  TO anon, authenticated, service_role;

-- ─── Triggers ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

DROP TRIGGER IF EXISTS trg_heidi_identity_updated_at ON heidi_identity;
CREATE TRIGGER trg_heidi_identity_updated_at
  BEFORE UPDATE ON heidi_identity
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_heidi_goals_updated_at ON heidi_goals;
CREATE TRIGGER trg_heidi_goals_updated_at
  BEFORE UPDATE ON heidi_goals
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_heidi_world_model_updated_at ON heidi_world_model;
CREATE TRIGGER trg_heidi_world_model_updated_at
  BEFORE UPDATE ON heidi_world_model
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS trg_heidi_protected_assets_updated_at ON heidi_protected_assets;
CREATE TRIGGER trg_heidi_protected_assets_updated_at
  BEFORE UPDATE ON heidi_protected_assets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
