-- Create a dedicated API key for dashboard/external services
-- This will be used instead of service_role for non-backend operations

-- Note: This migration creates a placeholder for the actual key generation
-- The actual anon key should be generated from Supabase dashboard
-- and stored in environment variables as SUPABASE_ANON_KEY

-- For now, we'll use the existing anon key from the project
-- but document the security requirement here
