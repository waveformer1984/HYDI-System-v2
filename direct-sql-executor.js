// Direct SQL executor for Supabase
const { createClient } = require('@supabase/supabase-js');

async function executeSQL(sql) {
  console.log('🔧 DIRECT SQL EXECUTOR');
  console.log('=====================');
  
  const supabase = createClient(
    'https://akbnfovjdcobifeupvbn.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  try {
    // Create a temporary function to execute our SQL
    const tempFunctionName = 'temp_exec_' + Date.now();
    
    const createFunctionSQL = `
create or replace function public.${tempFunctionName}()
returns text
language plpgsql
security definer
as $$
begin
${sql.split('\n').map(line => '  ' + line).join('\n')}
  return 'SQL executed successfully';
end;
$$;`;
    
    console.log('📋 Creating temporary function...');
    
    // First, create the temp function
    const { error: createError } = await supabase
      .rpc('exec_sql', { sql_query: createFunctionSQL });
    
    if (createError) {
      console.error('❌ Could not create temp function:', createError.message);
      return null;
    }
    
    console.log('✅ Temp function created, executing...');
    
    // Execute the temp function
    const { data: execResult, error: execError } = await supabase
      .rpc(tempFunctionName);
    
    if (execError) {
      console.error('❌ Execution failed:', execError.message);
    } else {
      console.log('✅ SQL executed:', execResult);
    }
    
    // Clean up the temp function
    console.log('📋 Cleaning up temp function...');
    await supabase
      .rpc('exec_sql', { sql_query: `drop function if exists public.${tempFunctionName}();` });
    
    return execResult;
    
  } catch (error) {
    console.error('❌ Direct execution failed:', error.message);
    return null;
  }
}

// Execute the anchor function fix
const fixSQL = `
create or replace function public.keeper_compute_anchor(p_sink text default 'local_db')
returns jsonb
language plpgsql
security definer
set search_path = public, extensions
as \$\$
declare
  v_max_id bigint;
  v_chain_head text;
  v_prev_anchor text;
  v_payload text;
  v_anchor text;
  v_id bigint;
  v_row_count bigint;
begin
  select l.id, l.row_hash
    into v_max_id, v_chain_head
  from public.keeper_audit_log l
  order by l.id desc
  limit 1;

  select count(*)::bigint
    into v_row_count
  from public.keeper_audit_log;

  select a.anchor_hash
    into v_prev_anchor
  from public.keeper_audit_anchors a
  order by a.id desc
  limit 1;

  -- CRITICAL FIX: Ensure chain_tip_hash is never NULL
  if v_chain_head is null then
    v_chain_head := 'EMPTY_' || extract(epoch from now())::text;
  end if;

  v_payload := coalesce(v_prev_anchor, 'GENESIS') || '|' || coalesce(v_max_id::text, '0') || '|' || v_chain_head || '|' || now()::text;
  v_anchor := encode(digest(v_payload, 'sha256'), 'hex');

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
    v_chain_head,
    v_anchor,
    p_sink
  )
  returning id into v_id;

  return jsonb_build_object(
    'ok', true,
    'anchor_id', v_id,
    'audit_log_max_id', v_max_id,
    'chain_head_hash', v_chain_head,
    'anchor_hash', v_anchor,
    'row_count', v_row_count
  );
end;
\$\$;`;

executeSQL(fixSQL).then(result => {
  if (result) {
    console.log('\n🎯 TESTING FIXED FUNCTION...');
    
    const { createClient } = require('@supabase/supabase-js');
    const supabase = createClient(
      'https://akbnfovjdcobifeupvbn.supabase.co',
      process.env.SUPABASE_SERVICE_ROLE_KEY
    );
    
    supabase.rpc('keeper_compute_anchor', { p_sink: 'local_db' })
      .then(({ data, error }) => {
        if (error) {
          console.error('❌ Still failing:', error.message);
        } else {
          console.log('✅ SUCCESS! Anchor created:', data.anchor_id);
        }
      });
  }
});
