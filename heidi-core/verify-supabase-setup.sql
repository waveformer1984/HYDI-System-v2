-- HYDI Supabase Verification Script
-- Run these queries to verify the alignment system is working

-- 1. Test external alignment evaluation
SELECT public.evaluate_external_alignment('7 days');

-- 2. Test alignment caps application  
SELECT public.apply_alignment_caps(0.15, 0.30);

-- 3. Check recent calibration audits
SELECT * FROM public.hydi_calibration_audits 
ORDER BY id DESC 
LIMIT 5;

-- 4. Check reality gap snapshots
SELECT * FROM public.hydi_reality_gap_snapshots 
ORDER BY id DESC 
LIMIT 5;

-- 5. Check recalibration events
SELECT * FROM public.hydi_recalibration_events 
ORDER BY id DESC 
LIMIT 5;

-- 6. Verify edge function can access tables
SELECT 'hydi_external_outcomes table exists' as status
WHERE EXISTS (
   SELECT FROM information_schema.tables 
   WHERE table_schema = 'public' 
   AND table_name = 'hydi_external_outcomes'
);

-- 7. Test outcome ingest structure
SELECT 'Testing outcome insert structure...' as status;

-- This would be tested via the edge function, not SQL
