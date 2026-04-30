const { createClient } = require('@supabase/supabase-js');

async function testSupabaseConnection() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );

  console.log('Testing Supabase connection...');
  
  try {
    // Check if we can read from memories table
    const { data, error } = await supabase
      .from('memories')
      .select('*')
      .eq('session_id', 'memory-test-001')
      .limit(5);

    if (error) {
      console.error('Supabase error:', error);
      return;
    }

    console.log('Memories found:', data?.length || 0);
    console.log('Sample data:', data);

    // Check actions table too
    const { data: actions, error: actionsError } = await supabase
      .from('actions')
      .select('*')
      .eq('session_id', 'memory-test-001')
      .limit(5);

    if (actionsError) {
      console.error('Actions error:', actionsError);
    } else {
      console.log('Actions found:', actions?.length || 0);
      console.log('Sample actions:', actions);
    }

  } catch (err) {
    console.error('Connection failed:', err);
  }
}

testSupabaseConnection();
