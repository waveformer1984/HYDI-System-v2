-- Fix UUID generation issue
-- Ensure the extension is properly enabled in the schema

-- Create the extension if it doesn't exist
CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA public;

-- Set search path to include public for UUID functions
SET search_path = public, extensions;

-- Test UUID generation
SELECT uuid_generate_v4() as test_uuid;
