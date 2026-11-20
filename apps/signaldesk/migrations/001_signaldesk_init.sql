-- SignalDesk core schema (Stage 1 foundation). All tenant tables carry workspace_id.
-- Run via: npm run db:migrate

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TYPE membership_role AS ENUM ('owner', 'admin', 'member');
CREATE TYPE subscription_status AS ENUM (
  'trialing', 'active', 'past_due', 'canceled', 'incomplete', 'incomplete_expired', 'unpaid', 'paused'
);
CREATE TYPE lead_stage AS ENUM (
  'new', 'reviewing', 'qualified', 'contacted', 'replied', 'meeting', 'won', 'lost'
);
CREATE TYPE research_job_status AS ENUM ('queued', 'running', 'completed', 'failed', 'canceled', 'unavailable');
CREATE TYPE outreach_approval AS ENUM ('draft', 'pending_review', 'approved', 'rejected', 'sent_manual');

-- ---------- Auth (NextAuth / Auth.js) ----------
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT,
  email TEXT NOT NULL UNIQUE,
  email_verified TIMESTAMPTZ,
  image TEXT,
  password_hash TEXT,
  timezone TEXT DEFAULT 'America/Chicago',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at INTEGER,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT,
  UNIQUE (provider, provider_account_id)
);

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_token TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires TIMESTAMPTZ NOT NULL
);

CREATE TABLE verification_tokens (
  identifier TEXT NOT NULL,
  token TEXT NOT NULL UNIQUE,
  expires TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- ---------- Plans (central config; Stripe price IDs in env) ----------
CREATE TABLE plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  monthly_cents INTEGER NOT NULL,
  seat_limit INTEGER NOT NULL,
  research_credits_per_period INTEGER NOT NULL,
  stripe_price_id_env_key TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO plans (id, name, monthly_cents, seat_limit, research_credits_per_period, stripe_price_id_env_key) VALUES
  ('starter', 'Starter', 4900, 1, 100, 'STRIPE_PRICE_STARTER'),
  ('studio', 'Studio', 12900, 3, 400, 'STRIPE_PRICE_STUDIO'),
  ('agency', 'Agency', 29900, 10, 1200, 'STRIPE_PRICE_AGENCY');

-- ---------- Workspaces ----------
CREATE TABLE workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  website_url TEXT,
  demo_mode BOOLEAN NOT NULL DEFAULT false,
  onboarding_completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role membership_role NOT NULL DEFAULT 'member',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, user_id)
);

CREATE INDEX memberships_user_id_idx ON memberships(user_id);
CREATE INDEX memberships_workspace_id_idx ON memberships(workspace_id);

CREATE TABLE invitations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role membership_role NOT NULL DEFAULT 'member',
  token_hash TEXT NOT NULL UNIQUE,
  invited_by_user_id UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE workspace_profiles (
  workspace_id UUID PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
  agency_name TEXT,
  services_offered JSONB DEFAULT '[]'::jsonb,
  target_industries JSONB DEFAULT '[]'::jsonb,
  target_locations JSONB DEFAULT '[]'::jsonb,
  ideal_business_notes TEXT,
  sender_display_name TEXT,
  sender_reply_email TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------- Billing (Stage 3 wiring; schema now) ----------
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL UNIQUE REFERENCES workspaces(id) ON DELETE CASCADE,
  plan_id TEXT NOT NULL REFERENCES plans(id),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT UNIQUE,
  status subscription_status NOT NULL DEFAULT 'incomplete',
  current_period_start TIMESTAMPTZ,
  current_period_end TIMESTAMPTZ,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE billing_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  stripe_event_id TEXT NOT NULL UNIQUE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  processed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE usage_periods (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  period_start TIMESTAMPTZ NOT NULL,
  period_end TIMESTAMPTZ NOT NULL,
  credits_allowance INTEGER NOT NULL,
  credits_used INTEGER NOT NULL DEFAULT 0,
  UNIQUE (workspace_id, period_start)
);

CREATE TABLE usage_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  usage_period_id UUID NOT NULL REFERENCES usage_periods(id) ON DELETE CASCADE,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  research_job_id UUID,
  idempotency_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE research_credit_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  usage_period_id UUID NOT NULL REFERENCES usage_periods(id) ON DELETE CASCADE,
  research_job_id UUID NOT NULL,
  credits INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'held',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  released_at TIMESTAMPTZ,
  UNIQUE (research_job_id)
);

-- ---------- Discovery & leads ----------
CREATE TABLE businesses (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  legal_name TEXT,
  display_name TEXT NOT NULL,
  normalized_domain TEXT,
  location_city TEXT,
  location_region TEXT,
  location_country TEXT DEFAULT 'US',
  provider TEXT,
  provider_record_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX businesses_workspace_domain_uidx
  ON businesses (workspace_id, normalized_domain)
  WHERE normalized_domain IS NOT NULL;

CREATE TABLE leads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  business_id UUID REFERENCES businesses(id) ON DELETE SET NULL,
  stage lead_stage NOT NULL DEFAULT 'new',
  owner_user_id UUID REFERENCES users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  archived_at TIMESTAMPTZ,
  deleted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX leads_workspace_stage_idx ON leads(workspace_id, stage);

CREATE TABLE contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  full_name TEXT,
  email TEXT,
  phone TEXT,
  verification_status TEXT NOT NULL DEFAULT 'unknown',
  verification_method TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE source_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  business_id UUID REFERENCES businesses(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  source_url TEXT,
  provider_record_id TEXT,
  raw_payload JSONB,
  retrieved_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  retention_notes TEXT
);

CREATE TABLE observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  observation_type TEXT NOT NULL,
  evidence_excerpt TEXT,
  source_url TEXT,
  pages_checked JSONB,
  limitations TEXT,
  confidence TEXT NOT NULL DEFAULT 'low',
  observed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE research_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  business_id UUID NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  status research_job_status NOT NULL DEFAULT 'queued',
  idempotency_key TEXT NOT NULL,
  created_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ,
  UNIQUE (workspace_id, idempotency_key)
);

CREATE TABLE job_attempts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  research_job_id UUID NOT NULL REFERENCES research_jobs(id) ON DELETE CASCADE,
  attempt_number INTEGER NOT NULL,
  outcome TEXT NOT NULL,
  error_message TEXT,
  started_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at TIMESTAMPTZ
);

CREATE TABLE opportunity_briefs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  research_job_id UUID REFERENCES research_jobs(id),
  model_id TEXT,
  prompt_version TEXT,
  content JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE outreach_drafts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  subject TEXT,
  body TEXT,
  approval_status outreach_approval NOT NULL DEFAULT 'draft',
  evidence_ids JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE suppression_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, email)
);

CREATE TABLE activities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  actor_user_id UUID REFERENCES users(id),
  kind TEXT NOT NULL,
  body JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,
  assignee_user_id UUID REFERENCES users(id),
  title TEXT NOT NULL,
  due_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE tags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  UNIQUE (workspace_id, name)
);

CREATE TABLE lead_tags (
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  tag_id UUID NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY (lead_id, tag_id)
);

CREATE TABLE integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  config_encrypted BYTEA,
  enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (workspace_id, provider)
);

CREATE TABLE audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID REFERENCES workspaces(id) ON DELETE SET NULL,
  actor_user_id UUID REFERENCES users(id),
  action TEXT NOT NULL,
  target_type TEXT,
  target_id UUID,
  metadata JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE privacy_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  request_type TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  requested_by_user_id UUID REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  completed_at TIMESTAMPTZ
);

-- ---------- RLS (defense in depth; app sets app.current_workspace_id per request) ----------
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE businesses ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY workspaces_member_select ON workspaces
  FOR SELECT USING (
    id IN (
      SELECT workspace_id FROM memberships
      WHERE user_id::text = current_setting('app.current_user_id', true)
    )
  );

CREATE POLICY memberships_self ON memberships
  FOR ALL USING (user_id::text = current_setting('app.current_user_id', true));

CREATE POLICY businesses_workspace ON businesses
  FOR ALL USING (workspace_id::text = current_setting('app.current_workspace_id', true));

CREATE POLICY leads_workspace ON leads
  FOR ALL USING (workspace_id::text = current_setting('app.current_workspace_id', true));