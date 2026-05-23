-- Add publish fields to rezonate_projects
ALTER TABLE rezonate_projects
  ADD COLUMN IF NOT EXISTS is_published  boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS public_slug   text UNIQUE,
  ADD COLUMN IF NOT EXISTS price_cents   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS license_type  text NOT NULL DEFAULT 'non_exclusive'
    CHECK (license_type IN ('exclusive','non_exclusive','free'));

CREATE INDEX IF NOT EXISTS idx_rezonate_projects_published
  ON rezonate_projects(is_published) WHERE is_published = true;

CREATE INDEX IF NOT EXISTS idx_rezonate_projects_slug
  ON rezonate_projects(public_slug) WHERE public_slug IS NOT NULL;
