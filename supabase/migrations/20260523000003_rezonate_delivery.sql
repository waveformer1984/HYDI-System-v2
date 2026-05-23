ALTER TABLE rezonate_projects
  ADD COLUMN IF NOT EXISTS audio_export_url text,
  ADD COLUMN IF NOT EXISTS export_uploaded_at timestamptz;

-- Track deliveries
CREATE TABLE IF NOT EXISTS rezonate_deliveries (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    uuid NOT NULL REFERENCES rezonate_projects(id) ON DELETE CASCADE,
  buyer_email   text NOT NULL,
  download_url  text NOT NULL,
  stripe_session_id text,
  delivered_at  timestamptz NOT NULL DEFAULT now(),
  download_count integer NOT NULL DEFAULT 0
);

CREATE INDEX idx_rezonate_deliveries_project ON rezonate_deliveries(project_id);
ALTER TABLE rezonate_deliveries ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service role only" ON rezonate_deliveries USING (false);
