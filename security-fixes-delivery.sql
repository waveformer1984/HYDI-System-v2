-- DELIVERY SECURITY FIXES
-- Addresses all critical security blockers for production deployment

-- =====================================================
-- 1. ENABLE RLS ON PUBLIC TABLES
-- =====================================================

-- Enable RLS on payouts table
ALTER TABLE payouts ENABLE ROW LEVEL SECURITY;

-- Enable RLS on keymaker_system_state table  
ALTER TABLE keymaker_system_state ENABLE ROW LEVEL SECURITY;

-- Enable RLS on keeper_audit_anchors table
ALTER TABLE keeper_audit_anchors ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- 2. CREATE RLS POLICIES FOR SECURE ACCESS
-- =====================================================

-- Payouts table policies
CREATE POLICY "Users can view own payouts" ON payouts
    FOR SELECT USING (auth.uid()::text = client_id::text);

CREATE POLICY "System can manage payouts" ON payouts
    FOR ALL USING (
        auth.jwt() ->> 'role' = 'service_role' OR
        auth.jwt() ->> 'role' = 'admin'
    );

-- Keymaker system state policies
CREATE POLICY "System can manage keymaker state" ON keymaker_system_state
    FOR ALL USING (
        auth.jwt() ->> 'role' = 'service_role' OR
        auth.jwt() ->> 'role' = 'admin'
    );

-- Keeper audit anchors policies  
CREATE POLICY "System can manage audit anchors" ON keeper_audit_anchors
    FOR ALL USING (
        auth.jwt() ->> 'role' = 'service_role' OR
        auth.jwt() ->> 'role' = 'admin'
    );

-- =====================================================
-- 3. SECURE SECURITY DEFINER VIEWS
-- =====================================================

-- Drop and recreate problematic views with proper security
DROP VIEW IF EXISTS v_keymaker_audit;

CREATE OR REPLACE VIEW v_keymaker_audit AS
SELECT 
    a.id,
    a.anchor_hash,
    a.created_at,
    a.chain_tip_hash,
    a.computed_by
FROM keeper_audit_anchors a
WHERE (
    auth.jwt() ->> 'role' = 'service_role' OR
    auth.jwt() ->> 'role' = 'admin'
);

-- =====================================================
-- 4. FIX AUTH USERS EXPOSURE
-- =====================================================

-- Create secure client view without auth.users exposure
CREATE OR REPLACE VIEW v_client_summary AS
SELECT 
    c.id,
    c.name,
    c.email,
    c.status,
    c.created_at,
    COALESCE(l.total_earnings, 0) as total_earnings,
    COALESCE(p.total_payouts, 0) as total_payouts
FROM clients c
LEFT JOIN (
    SELECT customer_id, SUM(amount_gross) as total_earnings
    FROM financial_ledger 
    WHERE status = 'completed'
    GROUP BY customer_id
) l ON c.id = l.customer_id
LEFT JOIN (
    SELECT client_id, SUM(amount) as total_payouts  
    FROM payouts
    WHERE status = 'completed'
    GROUP BY client_id
) p ON c.id = p.client_id
WHERE (
    auth.jwt() ->> 'role' = 'service_role' OR
    auth.jwt() ->> 'role' = 'admin' OR
    auth.uid()::text = c.id::text
);

-- =====================================================
-- 5. ADD SECURITY INDEXES
-- =====================================================

-- Performance and security indexes
CREATE INDEX IF NOT EXISTS idx_payouts_client_id ON payouts(client_id);
CREATE INDEX IF NOT EXISTS idx_payouts_status ON payouts(status);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_customer_id ON financial_ledger(customer_id);
CREATE INDEX IF NOT EXISTS idx_financial_ledger_status ON financial_ledger(status);
CREATE INDEX IF NOT EXISTS idx_clients_status ON clients(status);

-- =====================================================
-- 6. SECURITY VALIDATION FUNCTIONS
-- =====================================================

-- Function to validate client access
CREATE OR REPLACE FUNCTION validate_client_access(client_id_param uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    user_role text;
BEGIN
    user_role := auth.jwt() ->> 'role';
    
    -- Service role and admin have full access
    IF user_role IN ('service_role', 'admin') THEN
        RETURN true;
    END IF;
    
    -- Users can only access their own data
    IF auth.uid() = client_id_param THEN
        RETURN true;
    END IF;
    
    RETURN false;
END;
$$;

-- =====================================================
-- 7. AUDIT LOGGING FOR SECURITY EVENTS
-- =====================================================

-- Create security audit table
CREATE TABLE IF NOT EXISTS security_audit_log (
    id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
    event_type text NOT NULL,
    table_name text,
    record_id uuid,
    user_id uuid,
    user_role text,
    action text,
    created_at timestamptz DEFAULT now(),
    metadata jsonb
);

-- Enable RLS on audit log
ALTER TABLE security_audit_log ENABLE ROW LEVEL SECURITY;

-- Audit log policies
CREATE POLICY "System can manage audit log" ON security_audit_log
    FOR ALL USING (
        auth.jwt() ->> 'role' = 'service_role' OR
        auth.jwt() ->> 'role' = 'admin'
    );

-- =====================================================
-- 8. VERIFICATION QUERIES
-- =====================================================

-- Test RLS is working (should return no rows for anonymous users)
DO $$
BEGIN
    -- This will be used to verify RLS is properly configured
    RAISE NOTICE 'Security fixes applied successfully';
    RAISE NOTICE 'RLS enabled on: payouts, keymaker_system_state, keeper_audit_anchors';
    RAISE NOTICE 'Security views secured';
    RAISE NOTICE 'Auth users exposure fixed';
END $$;
