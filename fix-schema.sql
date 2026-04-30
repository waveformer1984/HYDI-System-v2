-- Fix schema issue: add missing name column to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS name TEXT;

-- Update existing leads to have names based on email
UPDATE leads SET name = SPLIT_PART(email, '@', 1) WHERE name IS NULL;

-- Add more test leads to scale the system
INSERT INTO leads (email, name, source, metadata, welcome_sent)
VALUES 
  ('customer1@demo.local', 'Demo Customer 1', 'heidi_broadcast', '{"interests": ["SEO Content Generator", "Blog Post Generator"], "tier": "starter"}', false),
  ('customer2@demo.local', 'Demo Customer 2', 'heidi_broadcast', '{"interests": ["Data Pipeline Builder", "Analytics Dashboard"], "tier": "pro"}', false),
  ('customer3@demo.local', 'Demo Customer 3', 'heidi_broadcast', '{"interests": ["Email Campaign Writer", "Social Media Manager"], "tier": "starter"}', false)
ON CONFLICT (email) DO NOTHING;
