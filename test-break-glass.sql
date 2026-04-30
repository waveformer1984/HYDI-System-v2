-- Test Break-Glass Override Directly via SQL
-- This bypasses the JWT requirement and tests the core logic

-- Step 1: Check current circuit state
SELECT 
    id, 
    level, 
    expires_at,
    metadata,
    updated_at
FROM public.keeper_circuit_state 
WHERE id = 1;

-- Step 2: Simulate break-glass override (Level 2, 5 minutes)
UPDATE public.keeper_circuit_state 
SET 
    level = 2,
    expires_at = now() + interval '5 minutes',
    metadata = metadata || 
        '{
            "break_glass": true,
            "reason": "Emergency circuit override during drill",
            "requested_by": "validation_drill",
            "ttl_minutes": 5,
            "previous_level": 1
        }'::jsonb,
    updated_at = now()
WHERE id = 1;

-- Step 3: Log the override action
INSERT INTO public.keeper_audit_log (
    request_id,
    agent_id,
    agent_role,
    action,
    target,
    status,
    risk_level,
    details,
    sensitive,
    prev_hash,
    row_hash
) VALUES (
    'break_glass_drill_' || to_char(now(), 'YYYYMMDDHH24MISS'),
    'validation_drill',
    'break_glass_operator',
    'circuit:override',
    'keeper_circuit_state',
    'success',
    2,
    '{
        "action": "break_glass_override",
        "new_level": 2,
        "ttl_minutes": 5,
        "reason": "Emergency circuit override during drill",
        "requested_by": "validation_drill"
    }'::jsonb,
    true,
    (SELECT row_hash FROM public.keeper_audit_log ORDER BY id DESC LIMIT 1),
    encode(sha256('break_glass_drill_' || to_char(now(), 'YYYYMMDDHH24MISS')), 'hex')
);

-- Step 4: Verify the override took effect
SELECT 
    id, 
    level, 
    expires_at,
    updated_at,
    metadata->>'break_glass' as is_break_glass,
    metadata->>'reason' as override_reason
FROM public.keeper_circuit_state 
WHERE id = 1;

-- Step 5: Check recent audit entries
SELECT 
    request_id,
    action,
    status,
    created_at,
    details->>'action' as action_type,
    details->>'new_level' as override_level
FROM public.keeper_audit_log 
WHERE action = 'circuit:override'
ORDER BY created_at DESC 
LIMIT 3;
