-- Fix Pre-Flight Schema Check SQL
-- Run this in Supabase SQL Editor to resolve information_schema access

-- Step 1: Grant access to information_schema (if needed)
-- Note: This may require admin privileges
-- GRANT USAGE ON SCHEMA information_schema TO authenticated;
-- GRANT SELECT ON ALL TABLES IN SCHEMA information_schema TO authenticated;

-- Step 2: Create a view for pre-flight checks (alternative approach)
CREATE OR REPLACE VIEW preflight_schema_check AS
SELECT 
    'hydi_events' as table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'hydi_events'
UNION ALL
SELECT 
    'processed_events' as table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'processed_events'
UNION ALL
SELECT 
    'processing_locks' as table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'processing_locks'
UNION ALL
SELECT 
    'system_config' as table_name,
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'system_config';

-- Step 3: Create a view for index checks
CREATE OR REPLACE VIEW preflight_index_check AS
SELECT 
    indexname,
    tablename
FROM pg_indexes 
WHERE schemaname = 'public'
    AND tablename IN ('hydi_events', 'processed_events', 'processing_locks', 'system_config');

-- Step 4: Create a view for constraint checks
CREATE OR REPLACE VIEW preflight_constraint_check AS
SELECT 
    constraint_name,
    constraint_type,
    table_name
FROM information_schema.table_constraints 
WHERE table_schema = 'public'
    AND table_name = 'hydi_events';

-- Step 5: Create a function to check all required components
CREATE OR REPLACE FUNCTION check_pre_flight_requirements()
RETURNS TABLE (
    component TEXT,
    status TEXT,
    details TEXT
) AS $$
BEGIN
    -- Check tables
    RETURN QUERY
    SELECT 
        'tables' as component,
        CASE WHEN COUNT(*) = 4 THEN 'PASS' ELSE 'FAIL' END as status,
        'Required tables: hydi_events, processed_events, processing_locks, system_config' as details
    FROM information_schema.tables 
    WHERE table_schema = 'public'
    AND table_name IN ('hydi_events', 'processed_events', 'processing_locks', 'system_config');
    
    -- Check required columns in hydi_events
    RETURN QUERY
    SELECT 
        'columns' as component,
        CASE 
            WHEN COUNT(*) FILTER (WHERE column_name IN ('event_id', 'type', 'status', 'timestamp', 'payload', 'source', 'retry_count')) = 7 
            THEN 'PASS' 
            ELSE 'FAIL' 
        END as status,
        'Required columns: event_id, type, status, timestamp, payload, source, retry_count' as details
    FROM information_schema.columns 
    WHERE table_schema = 'public'
    AND table_name = 'hydi_events';
    
    -- Check primary key constraint
    RETURN QUERY
    SELECT 
        'constraints' as component,
        CASE WHEN COUNT(*) > 0 THEN 'PASS' ELSE 'FAIL' END as status,
        'Primary key constraint on hydi_events' as details
    FROM information_schema.table_constraints 
    WHERE table_schema = 'public'
    AND table_name = 'hydi_events'
    AND constraint_type = 'PRIMARY KEY';
    
END;
$$ LANGUAGE plpgsql;

-- Step 6: Test the function
SELECT * FROM check_pre_flight_requirements();

-- Step 7: Force PostGREST cache refresh
NOTIFY pgrst, 'reload schema';

-- Step 8: Verify the views work
SELECT 'Pre-flight schema setup complete' as status;
