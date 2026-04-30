// Check database version and UUID functions
const { createClient } = require('@supabase/supabase-js');

async function checkDBVersion() {
  console.log('🔍 CHECKING DATABASE VERSION AND UUID FUNCTIONS');
  console.log('==============================================');
  
  const supabase = createClient(
    'https://akbnfovjdcobifeupvbn.supabase.co',
    process.env.SUPABASE_SERVICE_ROLE_KEY
  );
  
  try {
    // Check Postgres version
    const { data: version, error: versionError } = await supabase
      .rpc('exec_sql', { sql: 'SELECT version()' });
    
    if (versionError && !versionError.message.includes('does not exist')) {
      console.log('❌ Version check failed:', versionError.message);
    } else {
      console.log('✅ Database accessible');
    }
    
    // Test gen_random_uuid
    const { data: uuidTest, error: uuidError } = await supabase
      .rpc('exec_sql', { sql: 'SELECT gen_random_uuid() as test_uuid' });
    
    if (uuidError) {
      console.log('❌ gen_random_uuid failed:', uuidError.message);
    } else {
      console.log('✅ gen_random_uuid working');
    }
    
    // Test uuid_generate_v4
    const { data: uuid4Test, error: uuid4Error } = await supabase
      .rpc('exec_sql', { sql: 'SELECT uuid_generate_v4() as test_uuid4' });
    
    if (uuid4Error) {
      console.log('❌ uuid_generate_v4 failed:', uuid4Error.message);
    } else {
      console.log('✅ uuid_generate_v4 working');
    }
    
  } catch (error) {
    console.error('❌ Check failed:', error.message);
  }
}

checkDBVersion();
