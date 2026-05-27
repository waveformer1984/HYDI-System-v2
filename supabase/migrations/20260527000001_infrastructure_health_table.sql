-- Infrastructure Health Table
-- Stores the latest snapshot from ProtoForge Digital Twin / 48V microgrid
-- Written by the Express server every 30 seconds via health_update event

CREATE TABLE IF NOT EXISTS infrastructure_health (
  id              TEXT PRIMARY KEY DEFAULT 'singleton',
  overall         TEXT NOT NULL DEFAULT 'unknown',
  power           JSONB NOT NULL DEFAULT '{}',
  thermal         JSONB NOT NULL DEFAULT '{}',
  scaffold        JSONB NOT NULL DEFAULT '{}',
  revenue         JSONB NOT NULL DEFAULT '{}',
  efficiency      NUMERIC(5,2) NOT NULL DEFAULT 100,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one row ever exists (upserted by Express server)
-- RLS: service role can write; anon can read (Ursula dashboard)
ALTER TABLE infrastructure_health ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_write" ON infrastructure_health
  FOR ALL USING (true) WITH CHECK (true);

-- Seed the singleton row so reads never 404
INSERT INTO infrastructure_health (id, overall, updated_at)
VALUES ('singleton', 'initializing', now())
ON CONFLICT (id) DO NOTHING;
