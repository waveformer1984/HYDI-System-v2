-- Emergency Stripe Key Rotation Protocol
-- Execute IMMEDIATELY after key compromise

-- Step 1: Mark all current versions as compromised
UPDATE public.keeper_secret_versions 
SET status = 'compromised', 
    valid_to = now(),
    metadata = metadata || '{"compromise_reason":"exposed_key","rotation":"immediate"}'::jsonb
WHERE secret_ref = 'stripe/live_key';

-- Step 2: Create emergency new version (NO overlap window)
INSERT INTO public.keeper_secret_versions (
    secret_ref,
    provider,
    version,
    slot,
    status,
    valid_from,
    metadata
) VALUES (
    'stripe/live_key',
    'stripe',
    'stripe_live_emergency_' || to_char(now(), 'YYYY_MM_DD_HH24_MI_SS'),
    'primary',
    'active',
    now(),
    '{"env_var":"STRIPE_SECRET_KEY_PRIMARY","rotation":"emergency_no_overlap","compromise_response":true}'::jsonb
) ON CONFLICT (secret_ref, slot) DO UPDATE SET
    version = EXCLUDED.version,
    status = EXCLUDED.status,
    valid_from = EXCLUDED.valid_from,
    valid_to = null,
    metadata = EXCLUDED.metadata;

-- Step 3: Force circuit level to 2 (approval required) during rotation
UPDATE public.keeper_circuit_state 
SET level = 2, 
    metadata = metadata || '{"reason":"emergency_key_rotation","auto_escalation":true}'::jsonb
WHERE id = 1;

-- Step 4: Log emergency action
INSERT INTO public.keeper_audit_log (
    request_id,
    action,
    status,
    details,
    sensitive,
    row_hash
) VALUES (
    'emergency_rotation_' || to_char(now(), 'YYYYMMDDHH24MISS'),
    'emergency_key_rotation',
    'success',
    '{"trigger":"key_exposure","action":"immediate_rotation","circuit_level":2}'::jsonb,
    true,
    encode(sha256('emergency_rotation_' || to_char(now(), 'YYYYMMDDHH24MISS')), 'hex')
);

-- Step 5: Verify no secondary slot exists (NO overlap)
DELETE FROM public.keeper_secret_versions 
WHERE secret_ref = 'stripe/live_key' 
AND slot = 'secondary';

-- EMERGENCY CHECKLIST:
-- 1. Revoke old key in Stripe Dashboard NOW
-- 2. Set STRIPE_SECRET_KEY_PRIMARY to new key
-- 3. DO NOT set secondary key
-- 4. Monitor for abuse
-- 5. Lower circuit level after 1 hour if stable
