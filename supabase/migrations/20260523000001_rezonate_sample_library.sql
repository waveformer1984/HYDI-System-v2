-- rezonate_sample_library: curated + user-uploaded audio samples
CREATE TABLE IF NOT EXISTS rezonate_sample_library (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name          text NOT NULL,
  category      text NOT NULL CHECK (category IN ('drum','melody','bass','vocal','fx','loop','full_track')),
  tags          text[] NOT NULL DEFAULT '{}',
  audio_url     text NOT NULL,
  duration_ms   integer,
  bpm           numeric(6,2),
  key           text,
  is_user_sample boolean NOT NULL DEFAULT false,
  user_id       uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rezonate_sample_library_category ON rezonate_sample_library(category);
CREATE INDEX idx_rezonate_sample_library_user_id  ON rezonate_sample_library(user_id);

ALTER TABLE rezonate_sample_library ENABLE ROW LEVEL SECURITY;

-- Public curated samples: readable by everyone
CREATE POLICY "public samples readable" ON rezonate_sample_library
  FOR SELECT USING (is_user_sample = false);

-- User samples: only owner can read/write
CREATE POLICY "user owns own samples" ON rezonate_sample_library
  FOR ALL USING (auth.uid() = user_id);

-- Service role insert for seeding curated samples
CREATE POLICY "service role insert" ON rezonate_sample_library
  FOR INSERT WITH CHECK (true);

-- Add stem_type column to rezonate_audio_files if it doesn't exist
ALTER TABLE rezonate_audio_files
  ADD COLUMN IF NOT EXISTS stem_type text CHECK (stem_type IN ('vocals','drums','bass','other','full'));
