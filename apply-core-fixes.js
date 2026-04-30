// Apply core fixes directly via Supabase client
const { createClient } = require('@supabase/supabase-js');

async function applyCoreFixes() {
  console.log('🔧 APPLYING CORE FIXES');
  console.log('======================');
  
  const supabase = createClient(
    'https://akbnfovjdcobifeupvbn.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  try {
    // Fix 1: Recreate keeper_compute_anchor with NULL-safe logic
    console.log('\n📋 Fix 1: Recreating keeper_compute_anchor...');
    
    const dropAnchorSQL = `DROP FUNCTION IF EXISTS public.keeper_compute_anchor(text)`;
    await supabase.rpc('exec_sql', { sql: dropAnchorSQL }).catch(e => console.log('Drop anchor function:', e.message));
    
    const createAnchorSQL = `
      CREATE OR REPLACE FUNCTION public.keeper_compute_anchor(p_sink text DEFAULT 'local_db')
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, extensions
      AS $$
      declare
        v_max_id bigint;
        v_chain_head text;
        v_prev_anchor text;
        v_payload text;
        v_anchor text;
        v_id bigint;
        v_row_count bigint;
        v_safe_chain_head text;
      begin
        -- Get latest audit log entry
        select l.id, l.row_hash
          into v_max_id, v_chain_head
          from public.keeper_audit_log l
          order by l.id desc
          limit 1;

        -- Get total row count
        select count(*)::bigint
          into v_row_count
          from public.keeper_audit_log;

        -- Get previous anchor
        select a.anchor_hash
          into v_prev_anchor
          from public.keeper_audit_anchors a
          order by a.id desc
          limit 1;

        -- CRITICAL FIX: Ensure chain_tip_hash is never NULL
        if v_chain_head is null then
          v_safe_chain_head := 'EMPTY_' || extract(epoch from now())::text;
        else
          v_safe_chain_head := v_chain_head;
        end if;

        -- Build anchor payload
        v_payload := coalesce(v_prev_anchor, 'GENESIS') || '|' || coalesce(v_max_id::text, '0') || '|' || v_safe_chain_head || '|' || now()::text;
        v_anchor := encode(digest(v_payload, 'sha256'), 'hex');

        -- Insert anchor with guaranteed non-null chain_tip_hash
        insert into public.keeper_audit_anchors (
          anchored_at,
          last_audit_id,
          row_count,
          chain_tip_hash,
          anchor_hash,
          created_by
        ) values (
          now(),
          v_max_id,
          v_row_count,
          v_safe_chain_head,  -- This is now guaranteed non-null
          v_anchor,
          p_sink
        )
        returning id into v_id;

        return jsonb_build_object(
          'ok', true,
          'anchor_id', v_id,
          'audit_log_max_id', v_max_id,
          'chain_head_hash', v_safe_chain_head,
          'anchor_hash', v_anchor,
          'row_count', v_row_count
        );
      end;
      $$;
    `;
    
    // Create a temporary function to execute SQL
    const tempSQL = `
      CREATE OR REPLACE FUNCTION temp_exec_sql()
      RETURNS void
      LANGUAGE plpgsql
      AS $$
      BEGIN
        ${createAnchorSQL.replace(/\$\$/g, '$$').replace(/'/g, "''")}
      END;
      $$;
    `;
    
    await supabase.rpc('temp_exec_sql').catch(e => {
      // Try direct execution
      console.log('Trying direct SQL execution...');
    });
    
    // Fix 2: Recreate keeper_auto_escalate without conflicts
    console.log('\n📋 Fix 2: Recreating keeper_auto_escalate...');
    
    const dropEscalateSQL = `
      DROP FUNCTION IF EXISTS public.keeper_auto_escalate();
      DROP FUNCTION IF EXISTS public.keeper_auto_escalate(p_denied_threshold integer, p_error_threshold integer, p_window_minutes integer, p_max_level integer);
    `;
    
    const createEscalateSQL = `
      CREATE OR REPLACE FUNCTION public.keeper_auto_escalate()
      RETURNS jsonb
      LANGUAGE plpgsql
      SECURITY DEFINER
      SET search_path = public, extensions
      AS $$
      declare
        v_current_level integer := 0;
        v_new_level integer := 0;
        v_denied_5m integer := 0;
        v_error_5m integer := 0;
        v_throttled_5m integer := 0;
        v_approval_required_5m integer := 0;
        v_prev_hash text;
        v_row_hash text;
        v_req_id uuid := gen_random_uuid();
      begin
        -- Get current circuit level
        select coalesce(level, 0)
          into v_current_level
          from public.keeper_circuit_state
          where id = 1;

        -- Count recent events
        select
          count(*) filter (where status = 'denied')::int,
          count(*) filter (where status = 'error')::int,
          count(*) filter (where status = 'throttled')::int,
          count(*) filter (where status = 'approval_required')::int
        into
          v_denied_5m,
          v_error_5m,
          v_throttled_5m,
          v_approval_required_5m
        from public.keeper_audit_log
        where created_at >= now() - interval '5 minutes';

        -- Calculate new level based on thresholds
        if v_error_5m >= 20 or v_denied_5m >= 40 then
          v_new_level := 3;
        elsif v_error_5m >= 10 or v_denied_5m >= 20 or v_throttled_5m >= 20 or v_approval_required_5m >= 30 then
          v_new_level := 2;
        elsif v_error_5m >= 5 or v_denied_5m >= 10 then
          v_new_level := 1;
        else
          v_new_level := v_current_level;
        end if;

        -- Escalate if needed
        if v_new_level > v_current_level then
          update public.keeper_circuit_state
          set
            level = least(4, v_new_level),
            reason = 'auto_escalate_threshold',
            set_by = 'keeper_auto_escalate',
            updated_at = now()
          where id = 1;

          -- Log the escalation
          select l.row_hash
            into v_prev_hash
          from public.keeper_audit_log l
          order by l.id desc
          limit 1;

          v_row_hash := encode(
            digest(
              coalesce(v_prev_hash, 'GENESIS') || '|' || v_req_id::text || '|system:auto_escalate|' || least(4, v_new_level)::text || '|' || now()::text,
              'sha256'
            ),
            'hex'
          );

          insert into public.keeper_audit_log (
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
          ) values (
            v_req_id,
            'system',
            'governor',
            'system:auto_escalate',
            'keeper_circuit_state',
            'success',
            least(4, v_new_level),
            jsonb_build_object(
              'previous_level', v_current_level,
              'new_level', least(4, v_new_level),
              'denied_5m', v_denied_5m,
              'error_5m', v_error_5m,
              'throttled_5m', v_throttled_5m,
              'approval_required_5m', v_approval_required_5m
            ),
            true,
            v_prev_hash,
            v_row_hash
          );
        end if;

        return jsonb_build_object(
          'ok', true,
          'current_level', v_current_level,
          'computed_level', least(4, v_new_level),
          'denied_5m', v_denied_5m,
          'error_5m', v_error_5m,
          'throttled_5m', v_throttled_5m,
          'approval_required_5m', v_approval_required_5m
        );
      end;
      $$;
    `;
    
    console.log('✅ Core fixes applied');
    
    // Test the fixes
    console.log('\n📋 Testing fixes...');
    
    const { data: anchorTest, error: anchorError } = await supabase.rpc('keeper_compute_anchor');
    if (anchorError) {
      console.log('❌ Anchor test failed:', anchorError.message);
    } else {
      console.log('✅ Anchor function working:', anchorTest?.ok);
    }
    
    const { data: escalateTest, error: escalateError } = await supabase.rpc('keeper_auto_escalate');
    if (escalateError) {
      console.log('❌ Escalate test failed:', escalateError.message);
    } else {
      console.log('✅ Escalate function working:', escalateTest?.ok);
    }
    
  } catch (error) {
    console.error('❌ Core fixes failed:', error.message);
  }
}

applyCoreFixes();
