-- ========================================
-- FIX RLS FOR system_control_flags
-- Addresses lint: RLS Disabled in Public Entity
-- ========================================

-- Step 1: Enable RLS on the table
ALTER TABLE public.system_control_flags ENABLE ROW LEVEL SECURITY;

-- Step 2: Create policy for service_role (Edge Functions, pg_cron, etc.)
-- This allows server-side operations to manage control flags
CREATE POLICY "Service role full access to system_control_flags"
    ON public.system_control_flags
    FOR ALL
    TO service_role
    USING (true)
    WITH CHECK (true);

-- Step 3: Create policy for authenticated users (read-only)
-- Adjust based on your needs - this allows read access to authenticated users
CREATE POLICY "Authenticated users can read system_control_flags"
    ON public.system_control_flags
    FOR SELECT
    TO authenticated
    USING (true);

-- Step 4: Explicitly deny anonymous access
-- (Optional but recommended for internal config tables)
-- No policy for anon = denied by default when RLS is enabled

-- Verification
SELECT 
    tablename,
    rowsecurity as rls_enabled,
    (SELECT COUNT(*) FROM pg_policies WHERE tablename = 'system_control_flags') as policy_count
FROM pg_tables
WHERE tablename = 'system_control_flags';

-- Show created policies
SELECT 
    policyname,
    permissive,
    roles,
    cmd,
    qual as using_expression
FROM pg_policies
WHERE tablename = 'system_control_flags';

SELECT 'RLS enabled and policies created for system_control_flags' as result;
