-- HYDI Production-Grade Validation SQL
-- Run these queries in sequence to test the system

-- 1. Prove the Gate Can Fail
-- Insert a failure condition
INSERT INTO public.chaos_run_verdict (
    run_id, name, status, total_instances, done_instances, error_instances,
    dead_letter_instances, duplicate_effect_pairs, replay_mismatches,
    started_at, finished_at, verdict, details
) VALUES (
    gen_random_uuid(),
    'Gate Failure Test',
    'failed',
    100,
    95,
    5,
    0,
    1,
    0,
    now() - interval '1 hour',
    now() - interval '55 minutes',
    'FAIL',
    '{}'::jsonb
) ON CONFLICT DO NOTHING;

-- Check if gate detects failure
SELECT gate_passed, failure_reason 
FROM public.chaos_gate_check();

-- Expected: gate_passed = false, failure_reason = 'Critical failures detected...'

-- 2. Force Alerts Into Existence
-- Create alert condition
INSERT INTO public.chaos_run_verdict (
    run_id, name, status, total_instances, done_instances, error_instances,
    dead_letter_instances, duplicate_effect_pairs, replay_mismatches,
    started_at, finished_at, verdict, details
) VALUES (
    gen_random_uuid(),
    'Alert Test',
    'completed',
    100,
    70,
    30,
    2,
    3,
    1,
    now() - interval '30 minutes',
    now() - interval '25 minutes',
    'PARTIAL',
    '{}'::jsonb
) ON CONFLICT DO NOTHING;

-- Check if alerts are generated
SELECT run_id, failure_reason, severity, requires_action 
FROM public.chaos_alerts;

-- Expected: Should show alerts for duplicate_side_effects, instance_errors, dead_letters_present

-- 3. Validate Signal Quality
-- Check signal breakdown
SELECT * FROM public.active_chaos_alerts_count();

-- Expected: Should show counts by severity, not just total

-- 4. Test Alert Deduplication
-- Insert 5 similar failures
DO $$
BEGIN
  FOR i IN 1..5 LOOP
    INSERT INTO public.chaos_run_verdict (
        run_id, name, status, total_instances, done_instances, error_instances,
        dead_letter_instances, duplicate_effect_pairs, replay_mismatches,
        started_at, finished_at, verdict, details
    ) VALUES (
        gen_random_uuid(),
        format('Dup Test %s', i),
        'failed',
        100,
        80,
        20,
        0,
        0,
        0,
        now() - format('%s minutes', i)::interval,
        now() - format('%s minutes', i-1)::interval,
        'FAIL',
        '{}'::jsonb
    ) ON CONFLICT DO NOTHING;
  END LOOP;
END $$;

-- Check alert count
SELECT COUNT(*) as alert_count FROM public.chaos_alerts;

-- Expected: Should be reasonable (< 10), not 50+

-- 5. Final Assessment
-- Clean up test data
DELETE FROM public.chaos_run_verdict 
WHERE name IN ('Gate Failure Test', 'Alert Test', 'Dup Test 1', 'Dup Test 2', 'Dup Test 3', 'Dup Test 4', 'Dup Test 5');

-- Check final state
SELECT gate_passed, failure_reason FROM public.chaos_gate_check();
SELECT * FROM public.active_chaos_alerts_count();

-- Expected: gate_passed = true, all counts = 0
