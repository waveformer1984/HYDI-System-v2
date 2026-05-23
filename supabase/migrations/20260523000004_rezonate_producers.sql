-- Producer profiles (one per auth user)
CREATE TABLE IF NOT EXISTS rezonate_producers (
  id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username     text UNIQUE NOT NULL,
  display_name text NOT NULL,
  bio          text,
  avatar_url   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rezonate_producers_username ON rezonate_producers(username);
ALTER TABLE rezonate_producers ENABLE ROW LEVEL SECURITY;

-- Anyone can read public profiles
CREATE POLICY "public profiles readable" ON rezonate_producers FOR SELECT USING (true);
-- Users can update own profile
CREATE POLICY "user owns profile" ON rezonate_producers FOR ALL USING (auth.uid() = id);

-- Link projects to producers (nullable — existing projects are unowned)
ALTER TABLE rezonate_projects
  ADD COLUMN IF NOT EXISTS producer_id uuid REFERENCES rezonate_producers(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_rezonate_projects_producer ON rezonate_projects(producer_id);
