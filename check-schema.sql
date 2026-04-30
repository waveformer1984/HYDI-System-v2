-- Check keeper_circuit_state schema
SELECT 
    column_name,
    data_type,
    is_nullable,
    column_default
FROM information_schema.columns 
WHERE table_name = 'keeper_circuit_state' 
AND table_schema = 'public'
ORDER BY ordinal_position;
